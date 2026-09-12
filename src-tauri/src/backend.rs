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
use std::sync::atomic::{AtomicBool, Ordering};
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

/// How often a running backend is asked whether it is still there.
///
/// The question is the same `/api/health` shape check the port probe asks, not
/// a TCP connect: a socket that accepts a connection and then says nothing is
/// precisely the failure a connect cannot see.
const HEALTH_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// How often the supervisor wakes between polls.
///
/// Shorter than the poll, because a spawned child that has exited is a fact the
/// operating system already holds. Waiting out the rest of a ten-second window
/// to read it would only delay the restart.
const SUPERVISOR_TICK: Duration = Duration::from_secs(1);

/// How long to wait for `/api/info` when recording where an adopted backend
/// came from.
///
/// Longer than a health probe. That route asks the model runtime about itself,
/// and the answer is worth waiting for: it is the only record this window will
/// ever have of a process it did not start, and it is read once.
const ORIGIN_READ_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// The backend stopped after it had already used this window's one
    /// automatic restart.
    ///
    /// Separate from `Stopped` because the remedy is different and because the
    /// screen must not imply that another restart is coming. Once per window
    /// session means once — a backend that failed, was restarted, ran for an
    /// hour and failed again has spent it.
    RestartExhausted { detail: String, restarted: String },
    /// The automatic restart was attempted and the new process never answered.
    RestartFailed { detail: String },
    /// A backend this window attached to has stopped.
    ///
    /// There is no child handle, so there is nothing here to restart. This is
    /// not a degraded version of `Stopped`: it is a different situation with a
    /// different answer, and the panel must not offer an action that cannot
    /// work.
    AdoptedStopped { port: u16, detail: String },
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
            StartError::RestartExhausted { .. } => "restart_exhausted",
            StartError::RestartFailed { .. } => "restart_failed",
            StartError::AdoptedStopped { .. } => "adopted_stopped",
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
            StartError::RestartExhausted { detail, restarted } => format!(
                "The local service stopped again ({detail}), and this window had already used \
                 its one automatic restart at {restarted}."
            ),
            StartError::RestartFailed { detail } => format!(
                "The local service stopped, and starting it again did not work: {detail}"
            ),
            StartError::AdoptedStopped { port, detail } => format!(
                "The service this window attached to on port {port} has stopped ({detail}). \
                 This window did not start it, so it cannot restart it."
            ),
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
            StartError::NoAnswer { .. }
            | StartError::Stopped { .. }
            | StartError::RestartFailed { .. } => {
                "Check the backend log, then restart Job Hunter.".to_string()
            }
            StartError::RestartExhausted { .. } => {
                "Close Job Hunter and open it again for a fresh service. The log below has \
                 both failures."
                    .to_string()
            }
            StartError::AdoptedStopped { .. } => {
                // Deliberately one instruction rather than two. Starting the
                // service again does not bring this window back: it attached
                // once, at launch, and nothing re-attaches it. Saying "start it
                // again" on its own would be the kind of half-true remedy this
                // screen exists to avoid.
                "Close Job Hunter and open it again. If the service is running by then this \
                 window attaches to it; if not, it starts its own."
                    .to_string()
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

/// Where an adopted backend came from, asked of the backend itself.
///
/// A process this window did not start leaves nothing behind when it stops: no
/// exit code, no child handle, and no output in this log. The one moment it can
/// be asked is while it is still answering, so it is asked then and the answer
/// is kept. Without it the panel can only say that something stopped, which is
/// the least useful true sentence available.
#[derive(Debug, Clone, Serialize)]
pub struct Origin {
    /// The address this window attached to.
    pub address: String,
    /// The interpreter the service reported as its own, if it answered.
    pub interpreter: Option<String>,
    /// The data directory it reported as its own, if it answered.
    pub data_dir: Option<String>,
}

/// The one automatic restart, once it has been spent.
#[derive(Debug, Clone, Serialize)]
pub struct Restart {
    /// When it happened, in the same UTC stamp the log file uses.
    pub at: String,
    /// The failed poll that caused it, worded as the log worded it.
    pub reason: String,
}

/// What supervision is doing, and what it is still able to do.
///
/// The panel renders this rather than inferring it. "One restart" is a rule
/// about a window session, and a screen that quietly re-arms it — or that
/// offers a restart for a process this window never started — would be telling
/// the person in front of it something that is not true.
#[derive(Debug, Clone, Serialize)]
pub struct Supervision {
    /// Whether anything is polling the backend at all.
    pub watching: bool,
    /// Seconds between health polls.
    pub poll_seconds: u64,
    /// False for an adopted backend: this window has no handle to restart.
    pub can_restart: bool,
    /// The restart, once it has been used. `None` means it is still available.
    pub restart: Option<Restart>,
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
        origin: Option<Origin>,
        supervision: Supervision,
        launched_at: String,
    },
    Ready {
        port: u16,
        provenance: Provenance,
        logs_captured: bool,
        resolved: Option<Resolved>,
        origin: Option<Origin>,
        supervision: Supervision,
        launched_at: String,
    },
    Failed {
        port: u16,
        provenance: Provenance,
        logs_captured: bool,
        resolved: Option<Resolved>,
        origin: Option<Origin>,
        supervision: Supervision,
        launched_at: String,
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
    /// What an adopted backend said about itself while it was still answering.
    origin: Mutex<Option<Origin>>,
    /// The one automatic restart, once it has been spent. This is per window
    /// session and it is never cleared: a backend that recovers has still used
    /// it.
    restart: Mutex<Option<Restart>>,
    /// Whether a supervisor is running.
    watching: AtomicBool,
    /// Set once the window is closing, so the supervisor stops rather than
    /// treating a deliberate kill as a crash to recover from.
    stopping: AtomicBool,
    /// When this window opened, in the log file's own UTC stamp. The panel uses
    /// it to say which log lines predate this launch.
    launched_at: String,
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
            origin: Mutex::new(None),
            restart: Mutex::new(None),
            watching: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            launched_at: logging::stamp(),
        }
    }
}

impl BackendState {
    /// Stop the backend and stop supervising it. Safe to call more than once.
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.kill_child();
    }

    /// Kill the child without ending supervision.
    ///
    /// The restart path uses this: the process has to go, but the window is not
    /// closing and the supervisor has more to do.
    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Whether the window is closing.
    fn stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    /// Take the one automatic restart, if it has not been taken already.
    ///
    /// The check and the claim are one operation under one lock, so two
    /// failures observed close together cannot both find the budget unspent.
    /// This is the whole of the restart-once rule.
    fn claim_restart(&self, reason: &str) -> bool {
        let Ok(mut guard) = self.restart.lock() else {
            return false;
        };
        if guard.is_some() {
            return false;
        }
        *guard = Some(Restart {
            at: logging::stamp(),
            reason: reason.to_string(),
        });
        true
    }

    /// The restart, if one has happened.
    fn restart(&self) -> Option<Restart> {
        self.restart.lock().ok().and_then(|guard| guard.clone())
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
        let origin = self.origin.lock().unwrap().clone();
        let launched_at = self.launched_at.clone();
        let supervision = Supervision {
            watching: self.watching.load(Ordering::SeqCst),
            poll_seconds: HEALTH_POLL_INTERVAL.as_secs(),
            // Only a child this window holds can be started again. An adopted
            // backend belongs to whoever started it, and the panel offers no
            // button for it rather than one that cannot work.
            can_restart: provenance == Provenance::Spawned,
            restart: self.restart(),
        };
        match &*self.phase.lock().unwrap() {
            Phase::Starting => BackendStatus::Starting {
                port,
                provenance,
                logs_captured,
                resolved,
                origin,
                supervision,
                launched_at,
            },
            Phase::Ready => BackendStatus::Ready {
                port,
                provenance,
                logs_captured,
                resolved,
                origin,
                supervision,
                launched_at,
            },
            Phase::Failed(error) => BackendStatus::Failed {
                port,
                provenance,
                logs_captured,
                resolved,
                origin,
                supervision,
                launched_at,
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

    fn set_origin(&self, origin: Origin) {
        *self.origin.lock().unwrap() = Some(origin);
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
    match ask(port, "/api/health", PROBE_READ_TIMEOUT) {
        Answer::NotListening => Probe::Vacant,
        Answer::NoReply(reason) => Probe::Foreign(reason),
        Answer::Reply(response) => classify(&response),
    }
}

/// What one bounded HTTP exchange on the loopback interface produced.
enum Answer {
    /// The connection was refused. Nothing holds the port.
    NotListening,
    /// Something holds the port and did not answer usefully. The sentence says
    /// how, because that sentence ends up in the log.
    NoReply(String),
    /// The raw bytes, headers and all.
    Reply(Vec<u8>),
}

/// Ask the loopback port one GET, with both halves of the exchange bounded.
///
/// An unbounded read is what once made a silent socket indistinguishable from
/// a healthy backend, so the bound is the point of this function rather than a
/// precaution in it.
fn ask(port: u16, path: &str, read_timeout: Duration) -> Answer {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let mut stream = match TcpStream::connect_timeout(&address.into(), PROBE_CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => return Answer::NotListening,
    };

    let _ = stream.set_read_timeout(Some(read_timeout));
    let _ = stream.set_write_timeout(Some(read_timeout));

    // `Connection: close` makes the server end the stream itself, so the read
    // below finishes on end-of-file rather than on the timeout.
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Accept: application/json\r\nConnection: close\r\n\r\n"
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
        return Answer::NoReply(format!(
            "it accepted a connection and then refused the request ({error})"
        ));
    }

    let deadline = Instant::now() + read_timeout;
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
        return Answer::NoReply("it accepted a connection and sent nothing back".to_string());
    }
    Answer::Reply(response)
}

/// The body of a 200, parsed as JSON.
fn body(response: &[u8]) -> Option<serde_json::Value> {
    let head = String::from_utf8_lossy(&response[..response.len().min(256)]);
    let status = head.lines().next().unwrap_or("").trim();
    if !status.starts_with("HTTP/") || status.split_whitespace().nth(1) != Some("200") {
        return None;
    }
    // The first brace starts the body of a plain response and the first chunk
    // of a chunked one. Parsing the first value and ignoring what follows
    // covers both without a transfer-encoding parser.
    let start = response.iter().position(|byte| *byte == b'{')?;
    serde_json::Deserializer::from_slice(&response[start..])
        .into_iter::<serde_json::Value>()
        .next()?
        .ok()
}

/// Ask an adopted backend where it is running from, while it still can answer.
///
/// Nothing here is required for the window to work, so every failure is simply
/// no answer. What it buys is the difference between "the service stopped" and
/// "the service that was running from this interpreter, with its data here,
/// stopped" on the one screen that has to be useful when everything else is
/// not.
fn fetch_origin(port: u16) -> Origin {
    let mut origin = Origin {
        address: format!("127.0.0.1:{port}"),
        interpreter: None,
        data_dir: None,
    };
    let Answer::Reply(response) = ask(port, "/api/info", ORIGIN_READ_TIMEOUT) else {
        return origin;
    };
    let Some(info) = body(&response) else {
        return origin;
    };
    let text = |key: &str| {
        info.get(key)
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
    };
    origin.interpreter = text("python_executable");
    origin.data_dir = text("data_dir");
    origin
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

    let Some(body) = body(response) else {
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

/// What supervision does about a backend that has stopped answering.
///
/// Kept as a decision over two facts rather than as branches inside the loop,
/// because this is the rule the task is about and a rule that cannot be tested
/// on its own is a rule nobody can check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Response {
    /// This window started it and has not used its restart. Start it again.
    Restart,
    /// This window started it and the restart is already spent. Stop trying
    /// and say so.
    GiveUp,
    /// This window attached to it. It was never ours to restart; explain that
    /// instead of attempting anything.
    Explain,
}

fn respond(provenance: Provenance, restart_used: bool) -> Response {
    match provenance {
        // Pending means nothing was ever started, so there is nothing to
        // recover and nothing to claim. It reaches supervision only if a
        // supervisor were started before a process existed, which start()
        // does not do — the arm is here so the rule is total rather than
        // relying on that.
        Provenance::Adopted | Provenance::Pending => Response::Explain,
        Provenance::Spawned if restart_used => Response::GiveUp,
        Provenance::Spawned => Response::Restart,
    }
}

/// Watch the backend, restart it once if it was ours, explain it otherwise.
///
/// Two signals, one decision. A spawned child that has exited is read from the
/// operating system every tick, because it is certain and immediate. Everything
/// else — a process still running that has stopped answering, and an adopted
/// backend, which has no child handle at all — comes from the health poll.
fn supervise(app: AppHandle) {
    std::thread::spawn(move || {
        {
            let state = app.state::<BackendState>();
            state.watching.store(true, Ordering::SeqCst);
            let provenance = *state.provenance.lock().unwrap();
            logging::shell(&format!(
                "supervising the backend: a health poll every {}s, {}",
                HEALTH_POLL_INTERVAL.as_secs(),
                match provenance {
                    Provenance::Spawned =>
                        "one automatic restart available for this window session",
                    _ => "no restart — this window did not start it",
                }
            ));
        }

        let mut last_poll = Instant::now();
        loop {
            std::thread::sleep(SUPERVISOR_TICK);
            let state = app.state::<BackendState>();

            if state.stopping() {
                state.watching.store(false, Ordering::SeqCst);
                return;
            }
            // A failure has been recorded and the panel is showing it. Saying
            // it again every second would only churn the log.
            if matches!(&*state.phase.lock().unwrap(), Phase::Failed(_)) {
                state.watching.store(false, Ordering::SeqCst);
                return;
            }

            let provenance = *state.provenance.lock().unwrap();
            let port = *state.port.lock().unwrap();

            let mut trouble = match provenance {
                Provenance::Spawned => ended(&state),
                _ => None,
            };

            if trouble.is_none() {
                if last_poll.elapsed() < HEALTH_POLL_INTERVAL {
                    continue;
                }
                last_poll = Instant::now();
                trouble = match probe(port) {
                    Probe::Ours => None,
                    Probe::Vacant => Some(format!("nothing is listening on port {port}")),
                    Probe::Foreign(reason) => {
                        Some(format!("the health check on port {port} failed: {reason}"))
                    }
                };
            }

            let Some(detail) = trouble else { continue };
            logging::shell(&format!("the backend stopped answering: {detail}"));

            match respond(provenance, state.restart().is_some()) {
                Response::Explain => {
                    logging::shell(
                        "no restart: this window attached to that service rather than \
                         starting it, so it has no handle to restart",
                    );
                    state.set_phase(Phase::Failed(StartError::AdoptedStopped { port, detail }));
                    state.watching.store(false, Ordering::SeqCst);
                    return;
                }
                Response::GiveUp => {
                    let restarted = state
                        .restart()
                        .map(|restart| restart.at)
                        .unwrap_or_else(|| "earlier in this session".to_string());
                    logging::shell(
                        "no second restart: the one automatic restart for this window session \
                         has been used. Close Job Hunter and open it again.",
                    );
                    state.set_phase(Phase::Failed(StartError::RestartExhausted {
                        detail,
                        restarted,
                    }));
                    state.watching.store(false, Ordering::SeqCst);
                    return;
                }
                Response::Restart => {
                    // The claim is what spends the budget, and it is made
                    // before the attempt: a restart that fails has still been
                    // used.
                    if !state.claim_restart(&detail) {
                        continue;
                    }
                    match restart(&app, &state, port, &detail) {
                        Ok(()) => last_poll = Instant::now(),
                        Err(error) => {
                            logging::shell(&format!("the restart failed: {}", error.summary()));
                            state.set_phase(Phase::Failed(error));
                            state.watching.store(false, Ordering::SeqCst);
                            return;
                        }
                    }
                }
            }
        }
    });
}

/// Start the backend again, on the same port, after a failed poll.
fn restart(
    app: &AppHandle,
    state: &BackendState,
    port: u16,
    reason: &str,
) -> Result<(), StartError> {
    logging::shell(&format!(
        "restarting the backend on port {port}. Reason: {reason}. This is the one automatic \
         restart in this window session; a second failure stops and shows diagnostics."
    ));
    state.set_phase(Phase::Starting);
    // The process is usually gone already. When it is not — a backend that
    // stopped answering while still running — it has to go before another one
    // tries to take the port.
    state.kill_child();

    spawn_child(app, state, port).and_then(|()| await_answer(state, port)).map_err(|error| {
        StartError::RestartFailed {
            detail: error.summary(),
        }
    })?;

    state.set_phase(Phase::Ready);
    logging::shell(&format!(
        "the backend answered again on port {port} after its one automatic restart"
    ));
    Ok(())
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
            // Both kinds are watched. Only one of them can be restarted, and
            // the supervisor is where that difference is decided: an adopted
            // backend that stops is a thing the window has to explain, which
            // it cannot do if nothing is looking.
            supervise(app.clone());
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
            // Asked now, while it can still answer. Once it stops there is
            // nothing left to ask, and "a service stopped" with no idea which
            // one is the least useful true sentence the panel could show.
            let origin = fetch_origin(port);
            match (&origin.interpreter, &origin.data_dir) {
                (Some(interpreter), Some(data_dir)) => logging::shell(&format!(
                    "the adopted backend reports it is running {interpreter} with its data in \
                     {data_dir}"
                )),
                _ => logging::shell(
                    "the adopted backend did not say where it is running from; only the \
                     address it was attached on is known",
                ),
            }
            state.set_origin(origin);
            return Ok(port);
        }
        Some(PortChoice::Spawn(port)) => port,
        // Only reachable from a test that never called decide_port().
        None => *state.port.lock().unwrap(),
    };

    spawn_child(app, state, port)?;
    await_answer(state, port)?;
    Ok(port)
}

/// Resolve the pair, start the process, and put its output into the log.
///
/// Separate from the wait that follows it because the restart path needs both
/// halves and nothing else: the port is already decided, and re-deciding it
/// would move a backend the renderer has an address for.
fn spawn_child(app: &AppHandle, state: &BackendState, port: u16) -> Result<(), StartError> {
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
    Ok(())
}

/// Wait until the spawned backend answers on its port, or until it is clear
/// that it will not.
fn await_answer(state: &BackendState, port: u16) -> Result<(), StartError> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if let Probe::Ours = probe(port) {
            return Ok(());
        }

        // The port is bound before uvicorn serves, so a connection that goes
        // unanswered is normal for a moment and not worth reporting. A process
        // that has ended is not: it is the whole answer, and waiting out the
        // rest of the timeout would only delay it.
        if let Some(detail) = ended(state) {
            state.kill_child();
            return Err(StartError::Stopped { detail });
        }

        std::thread::sleep(Duration::from_millis(200));
    }

    state.kill_child();
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

    /// The rule this task exists for: one restart per window session.
    ///
    /// Not one per failure. A backend that fails, is restarted, runs for an
    /// hour and fails again has spent it, and the second failure has to stop
    /// and explain rather than start the cycle over.
    #[test]
    fn a_spawned_backend_is_restarted_once_and_then_given_up_on() {
        assert_eq!(respond(Provenance::Spawned, false), Response::Restart);
        assert_eq!(respond(Provenance::Spawned, true), Response::GiveUp);
    }

    /// A backend this window attached to is never restarted, whatever the
    /// budget says. There is no child handle to restart, and offering one
    /// would be offering something that cannot work.
    #[test]
    fn an_adopted_backend_is_never_restarted() {
        assert_eq!(respond(Provenance::Adopted, false), Response::Explain);
        assert_eq!(respond(Provenance::Adopted, true), Response::Explain);
        assert_eq!(respond(Provenance::Pending, false), Response::Explain);
    }

    /// The budget is claimed once, under one lock, so two failures seen close
    /// together cannot both find it unspent.
    #[test]
    fn the_restart_budget_is_claimed_exactly_once() {
        quiet();
        let state = BackendState::default();

        assert!(state.restart().is_none(), "it starts unspent");
        assert!(state.claim_restart("the first failure"));
        assert!(
            !state.claim_restart("the second failure"),
            "a second claim must fail, whenever it arrives"
        );

        let restart = state.restart().expect("the restart is recorded");
        assert_eq!(restart.reason, "the first failure");
        assert!(!restart.at.is_empty(), "the restart carries when it happened");
    }

    /// Two threads racing on the same failure must not produce two restarts.
    #[test]
    fn only_one_of_two_racing_claims_wins() {
        quiet();
        let state = std::sync::Arc::new(BackendState::default());
        let winners: Vec<bool> = (0..8)
            .map(|index| {
                let state = state.clone();
                std::thread::spawn(move || state.claim_restart(&format!("failure {index}")))
            })
            .map(|handle| handle.join().unwrap())
            .collect();

        assert_eq!(
            winners.iter().filter(|won| **won).count(),
            1,
            "exactly one claim wins: {winners:?}"
        );
    }

    /// The panel reads this to say what supervision can still do. An adopted
    /// backend must never report that it can be restarted.
    #[test]
    fn the_status_reports_what_supervision_can_do() {
        quiet();
        let state = BackendState::default();
        state.set_provenance(Provenance::Adopted);
        let BackendStatus::Starting { supervision, .. } = state.status() else {
            panic!("a fresh state is starting");
        };
        assert!(!supervision.can_restart);
        assert!(supervision.restart.is_none());
        assert_eq!(supervision.poll_seconds, HEALTH_POLL_INTERVAL.as_secs());

        state.set_provenance(Provenance::Spawned);
        state.claim_restart("the backend stopped answering");
        let BackendStatus::Starting { supervision, .. } = state.status() else {
            panic!("a fresh state is starting");
        };
        assert!(supervision.can_restart);
        assert_eq!(
            supervision.restart.map(|restart| restart.reason),
            Some("the backend stopped answering".to_string()),
            "the used restart is visible, so the panel never re-arms it silently"
        );
    }

    /// A window that is closing is not a backend that crashed. The supervisor
    /// has to be able to tell them apart or it would fight the shutdown.
    #[test]
    fn shutdown_stops_supervision() {
        quiet();
        let state = BackendState::default();
        assert!(!state.stopping());
        state.shutdown();
        assert!(state.stopping());
    }

    /// The failure the panel shows after the second kill has to say both
    /// things: what happened now, and that the restart is gone.
    #[test]
    fn the_exhausted_failure_names_the_restart_it_already_used() {
        let error = StartError::RestartExhausted {
            detail: "nothing is listening on port 8756".to_string(),
            restarted: "2026-09-12 09:14:02Z".to_string(),
        };
        let summary = error.summary();
        assert!(summary.contains("nothing is listening on port 8756"), "{summary}");
        assert!(summary.contains("2026-09-12 09:14:02Z"), "{summary}");
        assert!(summary.contains("already used"), "{summary}");
        assert!(!error.remedy().is_empty());
    }

    /// The adopted failure has to say why no restart is coming, and name the
    /// port the window attached to.
    #[test]
    fn the_adopted_failure_explains_why_nothing_is_restarted() {
        let error = StartError::AdoptedStopped {
            port: 8756,
            detail: "nothing is listening on port 8756".to_string(),
        };
        let summary = error.summary();
        assert!(summary.contains("8756"), "{summary}");
        assert!(summary.contains("did not start it"), "{summary}");
        assert_eq!(error.kind(), "adopted_stopped");
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
