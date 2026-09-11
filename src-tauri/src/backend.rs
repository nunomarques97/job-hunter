//! Supervising the local Python backend.
//!
//! The desktop shell owns the backend process: it starts it on launch, waits
//! until it answers, and kills it on exit so closing the window never leaves an
//! orphan listening on the port.
//!
//! The backend binds to the loopback interface only. It is not a server on the
//! network, and nothing outside this machine can reach it.

use std::fmt;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::logging;

/// The port the backend listens on, and the one the renderer talks to.
pub const DEFAULT_PORT: u16 = 8756;

/// How long to wait for the backend to answer before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);

/// The one instruction that fixes a missing Python environment.
const SETUP_REMEDY: &str = "Run scripts/setup.ps1 once.";

/// The value `/api/health` returns under `service`, and nothing else does.
///
/// This is a handshake, not a guess. A bare TCP connect proves only that a
/// socket exists, and a 200 proves only that something speaks HTTP; neither
/// distinguishes this backend from an unrelated development server that
/// happens to hold the port. One agreed constant on both sides does.
const SERVICE_IDENTITY: &str = "job-hunter";

/// How long to wait for a connection before deciding nothing is listening.
///
/// This is a loopback connection. It either completes in microseconds or the
/// kernel refuses it immediately; the timeout only covers a socket whose
/// backlog is full.
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(400);

/// How long to wait for an answer once connected.
///
/// This is the bound that matters. A socket that accepts a connection and then
/// says nothing used to look exactly like a healthy backend, because a
/// successful connect was the whole test. `/api/health` also asks the model
/// runtime whether it is there, so the bound has to leave room for that.
const PROBE_READ_TIMEOUT: Duration = Duration::from_millis(2000);

/// Enough of a response to decide on. A health payload is a few hundred bytes.
const PROBE_MAX_BYTES: usize = 64 * 1024;

/// How many ports to try before giving up.
const PORT_SEARCH_SPAN: u16 = 20;

/// Why the backend is not running.
///
/// This is a typed value rather than a message so the interface can tell the
/// cases apart: a missing Python environment is fixed by running one script,
/// while a backend that started and never answered is a different problem with
/// a different remedy. Each case carries what was tried, so the diagnostic does
/// not have to guess.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StartError {
    /// The backend package itself is not on disk where the shell looked.
    BackendMissing { probed: Vec<String> },
    /// No Python interpreter was found. The environment has never been set up,
    /// or `backend/.venv` has been deleted.
    NoPythonEnvironment { probed: Vec<String> },
    /// An interpreter exists but the process would not start.
    SpawnFailed { python: String, detail: String },
    /// Every candidate port is held by something that is not this backend.
    ///
    /// This is separate from `NoAnswer` because the remedy is different: there
    /// is nothing wrong with the backend, and nothing a restart fixes. Some
    /// other program has the port, and it has to be closed.
    PortUnavailable {
        port: u16,
        last: u16,
        probed: Vec<String>,
    },
    /// The process started and never answered on its port.
    NoAnswer { port: u16, waited_seconds: u64 },
    /// The backend was answering and then the process ended.
    Stopped { detail: String },
}

/// A failure flattened into the fields an interface needs.
///
/// The renderer shows what the shell decided rather than composing its own
/// wording, so the same failure reads the same way in the window and in the
/// log.
#[derive(Debug, Clone, Serialize)]
pub struct StartFailure {
    /// Which case this is, for a screen that wants to branch on it.
    pub kind: &'static str,
    pub summary: String,
    pub remedy: String,
    pub probed: Vec<String>,
}

impl StartError {
    /// The presentation form handed to the renderer.
    pub fn present(&self) -> StartFailure {
        StartFailure {
            kind: self.kind(),
            summary: self.summary(),
            remedy: self.remedy(),
            probed: self.probed().to_vec(),
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            StartError::BackendMissing { .. } => "backend_missing",
            StartError::NoPythonEnvironment { .. } => "no_python_environment",
            StartError::SpawnFailed { .. } => "spawn_failed",
            StartError::PortUnavailable { .. } => "port_unavailable",
            StartError::NoAnswer { .. } => "no_answer",
            StartError::Stopped { .. } => "stopped",
        }
    }

    /// One sentence naming what is wrong.
    pub fn summary(&self) -> String {
        match self {
            StartError::BackendMissing { .. } => {
                "The backend package was not found next to the application.".to_string()
            }
            StartError::NoPythonEnvironment { .. } => {
                "The local service has no Python environment.".to_string()
            }
            StartError::SpawnFailed { python, detail } => {
                format!("The Python interpreter at {python} could not be started: {detail}")
            }
            StartError::PortUnavailable { port, last, .. } => format!(
                "Port {port} is held by a program that is not Job Hunter, and no port \
                 between {port} and {last} was free."
            ),
            StartError::NoAnswer {
                port,
                waited_seconds,
            } => format!(
                "The backend started but did not answer on port {port} within {waited_seconds} seconds."
            ),
            StartError::Stopped { detail } => {
                format!("The local service stopped running: {detail}")
            }
        }
    }

    /// What the person in front of the window should do about it.
    pub fn remedy(&self) -> String {
        match self {
            StartError::BackendMissing { .. } => {
                "Run the application from a checkout of the repository.".to_string()
            }
            StartError::NoPythonEnvironment { .. } | StartError::SpawnFailed { .. } => {
                SETUP_REMEDY.to_string()
            }
            StartError::PortUnavailable { port, .. } => format!(
                "Close whatever is listening on port {port}, then start Job Hunter again."
            ),
            StartError::NoAnswer { .. } | StartError::Stopped { .. } => {
                "Check the backend log, then restart Job Hunter.".to_string()
            }
        }
    }

    /// The paths that were looked at, for a diagnostic that shows its working.
    pub fn probed(&self) -> &[String] {
        match self {
            StartError::BackendMissing { probed }
            | StartError::NoPythonEnvironment { probed }
            | StartError::PortUnavailable { probed, .. } => probed,
            _ => &[],
        }
    }
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.summary(), self.remedy())?;
        let probed = self.probed();
        if !probed.is_empty() {
            write!(f, " Looked at: {}", probed.join(", "))?;
        }
        Ok(())
    }
}

impl std::error::Error for StartError {}

/// Where the backend process came from.
///
/// This is not a detail. A backend this shell started is a child it owns: it
/// dies with the window, supervision can restart it, and its stdout is piped
/// into the shell's log file. A backend that was already listening when the
/// window opened is none of those things — there is no child handle, so it
/// outlives the window, cannot be restarted, and writes to whatever terminal
/// started it rather than to the log. The diagnostic panel has to tell the two
/// apart, because otherwise it shows a healthy backend beside a silent log and
/// sends the user to debug a problem that does not exist.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    /// Not settled yet. The port decision or the spawn is still in flight.
    Pending,
    /// This shell started the process and holds its handle.
    Spawned,
    /// A Job Hunter backend was already serving on the port and was attached
    /// to. It belongs to whoever started it.
    Adopted,
}

/// The pair the shell resolved, and whether it is the pair actually running.
#[derive(Debug, Clone, Serialize)]
pub struct Resolved {
    /// The Python interpreter.
    pub interpreter: String,
    /// The backend package it was found beside.
    pub package: String,
    /// False when the backend was adopted: the pair is what this shell *would*
    /// have used, not what is running. Saying so is the difference between a
    /// useful path and a misleading one.
    pub in_use: bool,
}

/// What the shell can report about the backend right now.
///
/// The window is on screen before any of this is decided, so the renderer asks
/// for it rather than being told once. `Starting` is a real answer: it is what
/// separates "still working on it" from "it failed", and the startup screen
/// shows a different state for each.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BackendStatus {
    Starting {
        port: u16,
        provenance: Provenance,
        logs_captured: bool,
        resolved: Option<Resolved>,
    },
    Ready {
        port: u16,
        provenance: Provenance,
        logs_captured: bool,
        resolved: Option<Resolved>,
    },
    Failed {
        port: u16,
        provenance: Provenance,
        logs_captured: bool,
        resolved: Option<Resolved>,
        failure: StartFailure,
    },
}

#[derive(Debug, Clone)]
enum Phase {
    Starting,
    Ready,
    Failed(StartError),
}

/// The shell's view of the backend.
///
/// Nothing here probes the network. The port decision costs real time when
/// another program holds the port, and it belongs where the log already exists
/// and its result can be handed to the window — so it happens in `decide_port`
/// during setup, not in a `Default` that runs while the builder is being
/// assembled.
pub struct BackendState {
    child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    phase: Mutex<Phase>,
    /// What `decide_port` settled on. `None` until it has run.
    decision: Mutex<Option<PortChoice>>,
    /// Whether the running backend was started here or attached to.
    provenance: Mutex<Provenance>,
    /// The interpreter and package pair, once one has been resolved.
    resolved: Mutex<Option<Resolved>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(DEFAULT_PORT),
            phase: Mutex::new(Phase::Starting),
            decision: Mutex::new(None),
            provenance: Mutex::new(Provenance::Pending),
            resolved: Mutex::new(None),
        }
    }
}

impl BackendState {
    /// Stop the backend. Safe to call more than once.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// What to tell the renderer.
    pub fn status(&self) -> BackendStatus {
        let port = *self.port.lock().unwrap();
        let provenance = *self.provenance.lock().unwrap();
        let resolved = self.resolved.lock().unwrap().clone();
        // Only a process this shell spawned has its pipes read into the log
        // file. An adopted one writes wherever it was started from, and the
        // panel says so rather than presenting an empty log as a symptom.
        let logs_captured = provenance == Provenance::Spawned;
        match &*self.phase.lock().unwrap() {
            Phase::Starting => BackendStatus::Starting {
                port,
                provenance,
                logs_captured,
                resolved,
            },
            Phase::Ready => BackendStatus::Ready {
                port,
                provenance,
                logs_captured,
                resolved,
            },
            Phase::Failed(error) => BackendStatus::Failed {
                port,
                provenance,
                logs_captured,
                resolved,
                failure: error.present(),
            },
        }
    }

    fn set_phase(&self, phase: Phase) {
        *self.phase.lock().unwrap() = phase;
    }

    fn set_provenance(&self, provenance: Provenance) {
        *self.provenance.lock().unwrap() = provenance;
    }

    fn set_resolved(&self, package: &Path, interpreter: &Path, in_use: bool) {
        *self.resolved.lock().unwrap() = Some(Resolved {
            interpreter: readable(interpreter),
            package: readable(package),
            in_use,
        });
    }
}

/// What is on a port.
#[derive(Debug)]
enum Probe {
    /// This backend answered `/api/health` and named itself.
    Ours,
    /// Something is there, and it is not this backend. The sentence says how we
    /// know, because that sentence is what ends up in the log.
    Foreign(String),
    /// Nothing is listening.
    Vacant,
}

/// Ask a port whether it is the Job Hunter backend.
///
/// The question is `GET /api/health` and the answer has to carry the agreed
/// identity. Anything else — a different server, a 404, an HTTP greeting that
/// is not JSON, a socket that accepts and then says nothing — is somebody
/// else's port.
///
/// Both halves of the exchange are bounded. An unbounded read is what made a
/// silent socket indistinguishable from a healthy backend.
fn probe(port: u16) -> Probe {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let mut stream = match TcpStream::connect_timeout(&address.into(), PROBE_CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => return Probe::Vacant,
    };

    let _ = stream.set_read_timeout(Some(PROBE_READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PROBE_READ_TIMEOUT));

    // `Connection: close` makes the server end the stream itself, so the read
    // below finishes on end-of-file rather than on the timeout.
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Accept: application/json\r\nConnection: close\r\n\r\n"
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
        return Probe::Foreign(format!(
            "it accepted a connection and then refused the request ({error})"
        ));
    }

    let deadline = Instant::now() + PROBE_READ_TIMEOUT;
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => response.extend_from_slice(&chunk[..count]),
            // A timeout, a reset, anything: whatever is there has stopped
            // talking, and what we have is all we are going to get.
            Err(_) => break,
        }
        if response.len() >= PROBE_MAX_BYTES || Instant::now() >= deadline {
            break;
        }
    }

    if response.is_empty() {
        return Probe::Foreign("it accepted a connection and sent nothing back".to_string());
    }
    classify(&response)
}

/// Decide whether an HTTP response came from this backend.
fn classify(response: &[u8]) -> Probe {
    let head = String::from_utf8_lossy(&response[..response.len().min(256)]);
    let status = head.lines().next().unwrap_or("").trim();

    if !status.starts_with("HTTP/") {
        return Probe::Foreign("it answered, but not with HTTP".to_string());
    }
    if status.split_whitespace().nth(1) != Some("200") {
        return Probe::Foreign(format!("it answered /api/health with `{status}`"));
    }

    // The first brace starts the body of a plain response and the first chunk
    // of a chunked one. Parsing the first value and ignoring what follows
    // covers both without a transfer-encoding parser.
    let Some(start) = response.iter().position(|byte| *byte == b'{') else {
        return Probe::Foreign(
            "it answered /api/health with something that is not JSON".to_string(),
        );
    };
    let mut values =
        serde_json::Deserializer::from_slice(&response[start..]).into_iter::<serde_json::Value>();
    let Some(Ok(body)) = values.next() else {
        return Probe::Foreign(
            "it answered /api/health with something that is not JSON".to_string(),
        );
    };

    match body.get("service").and_then(serde_json::Value::as_str) {
        Some(name) if name == SERVICE_IDENTITY => Probe::Ours,
        Some(other) => Probe::Foreign(format!(
            "it answered /api/health as `{other}` rather than Job Hunter"
        )),
        None => Probe::Foreign(
            "it answered /api/health without naming itself as Job Hunter".to_string(),
        ),
    }
}

/// The port to use, and what is already there.
#[derive(Debug, Clone, Copy)]
enum PortChoice {
    /// This backend is already serving here. Adopt it rather than starting a
    /// second one that could not bind anyway.
    Adopt(u16),
    /// Nothing of ours is here and the port binds. Start the backend on it.
    Spawn(u16),
}

/// The port to run on, searching upwards from `start`.
///
/// A vacant port costs a refused loopback connection and no measurable time.
/// Only a port somebody is actually holding costs a probe, and the probe is
/// what keeps a stranger's server from being adopted as ours.
fn choose_port(start: u16, span: u16) -> Result<PortChoice, StartError> {
    let last = start.saturating_add(span.saturating_sub(1));
    let mut probed = Vec::new();

    for port in start..=last {
        match probe(port) {
            Probe::Ours => {
                logging::shell(&format!("port {port} already serves Job Hunter; adopting it"));
                return Ok(PortChoice::Adopt(port));
            }
            Probe::Foreign(reason) => {
                let note = format!("port {port}: {reason}");
                logging::shell(&format!("{note}; trying the next port"));
                probed.push(note);
            }
            Probe::Vacant => match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
                Ok(listener) => {
                    // The listener is dropped rather than handed over, because
                    // the backend is a separate process and binds for itself.
                    // That leaves a window in which somebody else could take
                    // the port, and nothing closes it short of passing the
                    // socket across the process boundary. What catches it is
                    // the health probe after the spawn, which is the only thing
                    // that ever proves the backend is really there.
                    drop(listener);
                    return Ok(PortChoice::Spawn(port));
                }
                Err(error) => {
                    // Windows reserves port ranges for Hyper-V and WSL. Nothing
                    // is listening and the port still cannot be used.
                    let note = format!(
                        "port {port}: nothing is listening, and it will not bind ({error})"
                    );
                    logging::shell(&format!("{note}; trying the next port"));
                    probed.push(note);
                }
            },
        }
    }

    Err(StartError::PortUnavailable {
        port: start,
        last,
        probed,
    })
}

/// Choose the port, before the window exists.
///
/// The renderer is told the address by the window's initialization script, and
/// that script has to be in place before the page's first line runs — so the
/// decision cannot wait for the backend to start. A failure here is recorded as
/// the backend's failure, and the startup screen shows it like any other.
pub fn decide_port(app: &AppHandle) -> u16 {
    let state = app.state::<BackendState>();
    match choose_port(DEFAULT_PORT, PORT_SEARCH_SPAN) {
        Ok(choice) => {
            let port = match choice {
                PortChoice::Adopt(port) | PortChoice::Spawn(port) => port,
            };
            *state.port.lock().unwrap() = port;
            *state.decision.lock().unwrap() = Some(choice);
            port
        }
        Err(error) => {
            logging::shell(&format!("port selection failed: {}", error.summary()));
            logging::shell(&format!("remedy: {}", error.remedy()));
            for note in error.probed() {
                logging::shell(&format!("  {note}"));
            }
            state.set_phase(Phase::Failed(error));
            // The renderer still needs a coherent address to hold on to while
            // it shows the failure.
            DEFAULT_PORT
        }
    }
}

/// Windows hands back verbatim paths. They are correct but unreadable, and
/// these strings end up in front of a person.
fn readable(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// Every place the backend package might be, best candidate first.
///
/// More than one can exist at once: a bundle copies `app/` next to the
/// executable while the checkout it was built from still holds the original.
/// Only one of them has the virtual environment, so the choice cannot be made
/// on the package alone.
fn backend_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut found = Vec::new();

    let mut consider = |candidate: PathBuf| {
        if candidate.join("app").join("main.py").exists() && !found.contains(&candidate) {
            found.push(candidate);
        }
    };

    // In a bundle the backend ships as a resource.
    if let Ok(resources) = app.path().resource_dir() {
        consider(resources.join("backend"));
    }

    // In development it sits next to src-tauri.
    if let Ok(mut here) = std::env::current_dir() {
        for _ in 0..4 {
            consider(here.join("backend"));
            if !here.pop() {
                break;
            }
        }
    }

    found
}

/// The backend package and the interpreter that will run it.
///
/// A package without an interpreter beside it is not a usable backend, so the
/// two are resolved together and the first pair that is complete wins.
fn resolve(app: &AppHandle) -> Result<(PathBuf, PathBuf), StartError> {
    let candidates = backend_candidates(app);

    if candidates.is_empty() {
        return Err(StartError::BackendMissing {
            probed: std::env::current_dir()
                .map(|here| vec![readable(&here.join("backend"))])
                .unwrap_or_default(),
        });
    }

    let mut probed = Vec::new();
    for candidate in &candidates {
        match python_command(candidate) {
            Ok(python) => return Ok((candidate.clone(), python)),
            Err(StartError::NoPythonEnvironment { probed: tried }) => probed.extend(tried),
            Err(other) => return Err(other),
        }
    }

    Err(StartError::NoPythonEnvironment { probed })
}

/// The Python interpreter to launch.
///
/// Only interpreters that belong to this installation count: the virtual
/// environment `scripts/setup.ps1` creates, and a runtime shipped alongside the
/// backend if one ever is. There is deliberately no fallback to whatever
/// `python` resolves to on PATH. On Windows that name is usually the Microsoft
/// Store alias stub, which spawns successfully, opens the Store, and never
/// serves anything — so the shell would sit and wait ninety seconds for a
/// backend that was never started. A missing environment is a condition to
/// report in two seconds, not to paper over.
fn python_command(backend: &Path) -> Result<PathBuf, StartError> {
    let candidates = [
        backend.join("runtime").join("python.exe"),
        backend.join(".venv").join("Scripts").join("python.exe"),
        backend.join(".venv").join("bin").join("python"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(StartError::NoPythonEnvironment {
        probed: candidates.iter().map(|path| readable(path)).collect(),
    })
}

/// Why the child ended, or `None` while it is still running.
///
/// Both the startup wait and the supervisor ask this. During startup it turns a
/// backend that died on an import error into an answer in about a second rather
/// than at the end of the timeout.
fn ended(state: &BackendState) -> Option<String> {
    let mut guard = state.child.lock().ok()?;
    let child = guard.as_mut()?;
    match child.try_wait() {
        Ok(Some(status)) => Some(match status.code() {
            Some(code) => format!("the process exited with code {code}"),
            None => "the process was terminated".to_string(),
        }),
        Ok(None) => None,
        Err(error) => Some(format!("the process could not be checked: {error}")),
    }
}

/// Watch the child until it ends, and record why.
///
/// Without this a backend that crashes or is killed simply stops answering,
/// and the interface has nothing to say beyond a failed request. The phase
/// changes, so the startup screen comes back with the reason.
fn monitor(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        let state = app.state::<BackendState>();

        // Shutdown took the child; there is nothing left to watch.
        if state.child.lock().map(|guard| guard.is_none()).unwrap_or(true) {
            return;
        }

        if let Some(detail) = ended(&state) {
            logging::shell(&format!("the backend ended: {detail}"));
            state.child.lock().unwrap().take();
            state.set_phase(Phase::Failed(StartError::Stopped { detail }));
            return;
        }
    });
}

/// Start the backend and wait until it answers.
pub fn start(app: &AppHandle) -> Result<u16, StartError> {
    let state = app.state::<BackendState>();

    // A port decision that already failed is the failure. Starting over would
    // replace a precise diagnosis with a vaguer one.
    let already_failed = match &*state.phase.lock().unwrap() {
        Phase::Failed(error) => Some(error.clone()),
        _ => None,
    };
    if let Some(error) = already_failed {
        return Err(error);
    }

    state.set_phase(Phase::Starting);
    match run(app, &state) {
        Ok(port) => {
            state.set_phase(Phase::Ready);
            logging::shell(&format!("the backend is answering on port {port}"));
            // Only a backend this shell started can be watched. One adopted on
            // an already-busy port belongs to whoever started it.
            if state.child.lock().unwrap().is_some() {
                monitor(app.clone());
            }
            Ok(port)
        }
        Err(error) => {
            // One path per line. Six absolute Windows paths joined into a
            // single line wrap into an unreadable block wherever they are
            // shown.
            logging::shell(&format!("start failed: {}", error.summary()));
            logging::shell(&format!("remedy: {}", error.remedy()));
            for path in error.probed() {
                logging::shell(&format!("  looked at {path}"));
            }
            state.set_phase(Phase::Failed(error.clone()));
            Err(error)
        }
    }
}

fn run(app: &AppHandle, state: &tauri::State<'_, BackendState>) -> Result<u16, StartError> {
    let port = match *state.decision.lock().unwrap() {
        // A backend of ours is already serving there, usually one the developer
        // started by hand. It belongs to whoever started it, so it is adopted
        // and deliberately not supervised.
        Some(PortChoice::Adopt(port)) => {
            state.set_provenance(Provenance::Adopted);
            // The pair is resolved anyway and recorded as not in use. The panel
            // then has paths to show without claiming they are the ones the
            // running process was started with, which the shell cannot know.
            if let Ok((backend, python)) = resolve(app) {
                state.set_resolved(&backend, &python, false);
            }
            logging::shell(
                "attached to a backend this shell did not start: it is not stopped on exit, \
                 cannot be restarted, and its output does not reach this log",
            );
            return Ok(port);
        }
        Some(PortChoice::Spawn(port)) => port,
        // Only reachable from a test that never called decide_port().
        None => *state.port.lock().unwrap(),
    };

    // Resolved before anything is spawned, so a missing environment costs a
    // few file system checks rather than a process and a timeout.
    let (backend, python) = resolve(app)?;
    state.set_provenance(Provenance::Spawned);
    state.set_resolved(&backend, &python, true);

    let mut command = Command::new(&python);
    command
        .current_dir(&backend)
        .arg("-m")
        .arg("uvicorn")
        .arg("app.main:app")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--log-level")
        .arg("info")
        .env("JOB_HUNTER_PORT", port.to_string())
        .env("PYTHONUNBUFFERED", "1")
        // Both pipes go to the log file. They used to go to Stdio::null(),
        // which is why a packaged failure left nothing behind to read.
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // Without this a console window flashes up behind the application.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    logging::shell(&format!(
        "starting {} in {} on port {}",
        readable(&python),
        readable(&backend),
        port
    ));

    let mut child = command.spawn().map_err(|error| StartError::SpawnFailed {
        python: readable(&python),
        detail: error.to_string(),
    })?;

    if let Some(stdout) = child.stdout.take() {
        logging::pipe(stdout, "BACKEND ");
    }
    if let Some(stderr) = child.stderr.take() {
        logging::pipe(stderr, "BACKEND ");
    }

    *state.child.lock().unwrap() = Some(child);

    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if let Probe::Ours = probe(port) {
            return Ok(port);
        }

        // The port is bound before uvicorn serves, so a connection that goes
        // unanswered is normal for a moment and not worth reporting. A process
        // that has ended is not: it is the whole answer, and waiting out the
        // rest of the timeout would only delay it.
        if let Some(detail) = ended(state) {
            state.shutdown();
            return Err(StartError::Stopped { detail });
        }

        std::thread::sleep(Duration::from_millis(200));
    }

    state.shutdown();
    Err(StartError::NoAnswer {
        port,
        waited_seconds: STARTUP_TIMEOUT.as_secs(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Once;
    use std::sync::atomic::{AtomicU16, Ordering};

    /// Keep the test run's log lines out of the real log directory.
    fn quiet() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            std::env::set_var(
                "JOB_HUNTER_DATA_DIR",
                std::env::temp_dir().join("job-hunter-shell-tests"),
            );
        });
    }

    /// What a decoy server does with a connection.
    #[derive(Clone, Copy, Debug)]
    enum Decoy {
        /// Accepts and never says a word. This is the case a TCP connect
        /// cannot tell apart from a healthy backend, and the one that used to
        /// hold the shell for the whole startup timeout.
        Silent,
        /// Accepts and hangs up immediately.
        Closes,
        /// Answers 200 with well-formed JSON belonging to something else.
        Stranger,
        /// Answers the way this backend does.
        Ours,
    }

    fn reply(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Put a decoy on `port`. It is bound before this returns, so a probe that
    /// follows cannot race it.
    fn decoy(port: u16, kind: Decoy) {
        let listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, port)).expect("the decoy port was free");
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                // Windows turns a close with unread received data into a
                // reset, and a reset discards whatever the client had already
                // buffered. A decoy that answers has to drain the request
                // first, exactly as a real server does.
                if matches!(kind, Decoy::Stranger | Decoy::Ours) {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                    let _ = stream.read(&mut [0u8; 4096]);
                }

                match kind {
                    Decoy::Silent => held.push(stream),
                    Decoy::Closes => drop(stream),
                    Decoy::Stranger => {
                        let _ = stream
                            .write_all(reply(r#"{"status":"ok","service":"some-dev-server"}"#).as_bytes());
                    }
                    Decoy::Ours => {
                        let _ = stream.write_all(
                            reply(r#"{"service":"job-hunter","status":"degraded","version":"0.2.0"}"#)
                                .as_bytes(),
                        );
                    }
                }
            }
        });
    }

    /// A run of `count` consecutive ports nothing is using.
    ///
    /// Tests run in parallel, so each call starts where the last one left off
    /// rather than from a fixed base.
    fn free_run(count: u16) -> u16 {
        static NEXT: AtomicU16 = AtomicU16::new(47_000);
        let from = NEXT.fetch_add(count + 4, Ordering::SeqCst);
        for base in from..from.saturating_add(400) {
            let bound: Vec<_> = (0..count)
                .map_while(|offset| TcpListener::bind((Ipv4Addr::LOCALHOST, base + offset)).ok())
                .collect();
            let usable = bound.len() == count as usize;
            drop(bound);
            if usable {
                return base;
            }
        }
        panic!("no run of {count} free ports above {from}");
    }

    /// The defect behind the port adoption: a socket that accepts and stays
    /// silent looked exactly like a working backend, and cost the full
    /// startup timeout to find out otherwise.
    #[test]
    fn a_silent_socket_is_rejected_within_the_probe_timeout() {
        let port = free_run(1);
        decoy(port, Decoy::Silent);

        let began = Instant::now();
        let verdict = probe(port);
        let elapsed = began.elapsed();

        assert!(matches!(verdict, Probe::Foreign(_)), "{verdict:?}");
        assert!(
            elapsed < PROBE_READ_TIMEOUT + Duration::from_secs(1),
            "the probe took {elapsed:?}, which is not a bound"
        );
    }

    /// A 200 is not proof of identity.
    #[test]
    fn a_stranger_answering_with_json_is_not_us() {
        let port = free_run(1);
        decoy(port, Decoy::Stranger);
        let verdict = probe(port);
        assert!(matches!(verdict, Probe::Foreign(_)), "{verdict:?}");
    }

    #[test]
    fn our_own_health_answer_is_recognised() {
        let port = free_run(1);
        decoy(port, Decoy::Ours);
        let verdict = probe(port);
        assert!(matches!(verdict, Probe::Ours), "{verdict:?}");
    }

    #[test]
    fn a_port_nobody_holds_is_vacant() {
        let port = free_run(1);
        let verdict = probe(port);
        assert!(matches!(verdict, Probe::Vacant), "{verdict:?}");
    }

    /// A stranger on the default port costs the next port, not the launch.
    #[test]
    fn a_stranger_moves_us_to_the_next_port() {
        quiet();
        let base = free_run(2);
        decoy(base, Decoy::Stranger);
        match choose_port(base, 2) {
            Ok(PortChoice::Spawn(port)) => assert_eq!(port, base + 1),
            other => panic!("expected the next port, got {other:?}"),
        }
    }

    /// A backend of ours already answering is adopted rather than duplicated.
    #[test]
    fn our_own_backend_is_adopted() {
        quiet();
        let base = free_run(2);
        decoy(base, Decoy::Ours);
        match choose_port(base, 2) {
            Ok(PortChoice::Adopt(port)) => assert_eq!(port, base),
            other => panic!("expected the port to be adopted, got {other:?}"),
        }
    }

    /// Exhaustion used to return the starting port, which then failed to bind
    /// with nothing to say. It is a typed failure that names the port.
    #[test]
    fn a_range_with_no_free_port_is_a_typed_failure() {
        quiet();
        let base = free_run(3);
        for offset in 0..3 {
            decoy(base + offset, Decoy::Closes);
        }

        let error = choose_port(base, 3).expect_err("every candidate is held");

        assert!(
            matches!(error, StartError::PortUnavailable { .. }),
            "{error:?}"
        );
        assert!(
            error.summary().contains(&base.to_string()),
            "the summary names the port: {}",
            error.summary()
        );
        // It is read as one sentence in the window, so it has to be one.
        let summary = error.summary();
        assert!(
            !summary.contains('\n') && !summary.contains("  "),
            "the summary is not one clean line: {summary:?}"
        );
        assert!(
            error.remedy().contains(&base.to_string()),
            "the remedy names the port: {}",
            error.remedy()
        );
        assert_eq!(
            error.probed().len(),
            3,
            "every candidate is accounted for: {:?}",
            error.probed()
        );
    }

    /// A directory with no environment in it must be reported, not guessed at.
    /// This is the case that used to spawn the Microsoft Store alias stub and
    /// then wait ninety seconds for it.
    #[test]
    fn missing_environment_is_reported_immediately() {
        let empty = std::env::temp_dir().join("job-hunter-no-such-backend");

        let began = Instant::now();
        let error = python_command(&empty).expect_err("an empty directory has no interpreter");
        let elapsed = began.elapsed();

        assert!(
            matches!(error, StartError::NoPythonEnvironment { .. }),
            "expected NoPythonEnvironment, got {error:?}"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "the answer took {elapsed:?}; it must be immediate"
        );
    }

    /// The diagnostic has to be able to say what was looked at and what to do.
    #[test]
    fn the_error_carries_the_probed_paths_and_the_remedy() {
        let empty = std::env::temp_dir().join("job-hunter-no-such-backend");
        let error = python_command(&empty).unwrap_err();

        assert_eq!(error.remedy(), SETUP_REMEDY);
        assert_eq!(error.summary(), "The local service has no Python environment.");

        let probed = error.probed();
        assert_eq!(probed.len(), 3, "every candidate is reported: {probed:?}");
        assert!(
            probed.iter().any(|path| path.contains(".venv")),
            "the virtual environment must be named: {probed:?}"
        );
        assert!(
            !probed.iter().any(|path| path == "python" || path == "python3"),
            "a bare interpreter name is not a candidate any more: {probed:?}"
        );
    }

    /// A virtual environment that exists is the one that gets launched.
    #[test]
    fn an_existing_virtual_environment_is_chosen() {
        let root = std::env::temp_dir().join("job-hunter-venv-probe");
        let scripts = root.join(".venv").join("Scripts");
        std::fs::create_dir_all(&scripts).unwrap();
        let interpreter = scripts.join("python.exe");
        std::fs::write(&interpreter, b"").unwrap();

        let chosen = python_command(&root).expect("the virtual environment is there");
        assert_eq!(chosen, interpreter);

        std::fs::remove_dir_all(&root).ok();
    }
}
