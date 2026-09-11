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
}

impl StartError {
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
            StartError::NoAnswer { .. } => {
                "Check the backend log, then restart the application.".to_string()
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

pub struct BackendState {
    child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    /// The last reason the backend failed to start, for the interface to show.
    pub failure: Mutex<Option<StartError>>,
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
            failure: Mutex::new(None),
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

/// Start the backend and wait until it answers.
pub fn start(app: &AppHandle) -> Result<u16, StartError> {
    let state = app.state::<BackendState>();

    match run(app, &state) {
        Ok(port) => {
            *state.failure.lock().unwrap() = None;
            Ok(port)
        }
        Err(error) => {
            *state.failure.lock().unwrap() = Some(error.clone());
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
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        // Without this a console window flashes up behind the application.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command.spawn().map_err(|error| StartError::SpawnFailed {
        python: readable(&python),
        detail: error.to_string(),
    })?;
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
