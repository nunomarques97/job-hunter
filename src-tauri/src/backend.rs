//! Supervising the local Python backend.
//!
//! The desktop shell owns the backend process: it starts it on launch, waits
//! until it answers, and kills it on exit so closing the window never leaves an
//! orphan listening on the port.
//!
//! The backend binds to the loopback interface only. It is not a server on the
//! network, and nothing outside this machine can reach it.

use std::fmt;
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
            StartError::NoAnswer { .. } | StartError::Stopped { .. } => {
                "Check the backend log, then restart Job Hunter.".to_string()
            }
        }
    }

    /// The paths that were looked at, for a diagnostic that shows its working.
    pub fn probed(&self) -> &[String] {
        match self {
            StartError::BackendMissing { probed } | StartError::NoPythonEnvironment { probed } => {
                probed
            }
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

/// What the shell can report about the backend right now.
///
/// The window is on screen before any of this is decided, so the renderer asks
/// for it rather than being told once. `Starting` is a real answer: it is what
/// separates "still working on it" from "it failed", and the startup screen
/// shows a different state for each.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BackendStatus {
    Starting { port: u16 },
    Ready { port: u16 },
    Failed { port: u16, failure: StartFailure },
}

#[derive(Debug, Clone)]
enum Phase {
    Starting,
    Ready,
    Failed(StartError),
}

pub struct BackendState {
    child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    phase: Mutex<Phase>,
}

impl Default for BackendState {
    fn default() -> Self {
        // Decide the port immediately, so the renderer can be told where to
        // look before the page starts loading.
        let port = if port_in_use(DEFAULT_PORT) {
            DEFAULT_PORT
        } else {
            free_port(DEFAULT_PORT)
        };
        Self {
            child: Mutex::new(None),
            port: Mutex::new(port),
            phase: Mutex::new(Phase::Starting),
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
        match &*self.phase.lock().unwrap() {
            Phase::Starting => BackendStatus::Starting { port },
            Phase::Ready => BackendStatus::Ready { port },
            Phase::Failed(error) => BackendStatus::Failed {
                port,
                failure: error.present(),
            },
        }
    }

    fn set_phase(&self, phase: Phase) {
        *self.phase.lock().unwrap() = phase;
    }
}

/// True when something already answers on the port.
///
/// A developer usually has the backend running in a terminal already, and
/// starting a second one would fail to bind and produce a confusing error.
pub fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// The first free port at or after `start`.
fn free_port(start: u16) -> u16 {
    for candidate in start..start.saturating_add(40) {
        if TcpListener::bind((Ipv4Addr::LOCALHOST, candidate)).is_ok() {
            return candidate;
        }
    }
    start
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

/// Watch the child until it ends, and record why.
///
/// Without this a backend that crashes or is killed simply stops answering,
/// and the interface has nothing to say beyond a failed request. The phase
/// changes, so the startup screen comes back with the reason.
fn monitor(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        let state = app.state::<BackendState>();

        let ended = {
            let mut guard = match state.child.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            match guard.as_mut() {
                // Shutdown took the child; there is nothing left to watch.
                None => return,
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => Some(match status.code() {
                        Some(code) => format!("the process exited with code {code}"),
                        None => "the process was terminated".to_string(),
                    }),
                    Ok(None) => None,
                    Err(error) => Some(format!("the process could not be checked: {error}")),
                },
            }
        };

        if let Some(detail) = ended {
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
    let port = *state.port.lock().unwrap();

    if port_in_use(port) {
        // Something is already serving there, usually a backend the developer
        // started by hand. Adopt it rather than fighting for the port.
        return Ok(port);
    }

    // Resolved before anything is spawned, so a missing environment costs a
    // few file system checks rather than a process and a timeout.
    let (backend, python) = resolve(app)?;

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
        if port_in_use(port) {
            return Ok(port);
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
