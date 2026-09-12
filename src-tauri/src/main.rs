// The release build must not open a console window behind the application.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod logging;

use backend::{BackendState, BackendStatus};
use serde::Serialize;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

/// What the shell knows about the backend: starting, answering, or failed with
/// a reason the startup screen renders verbatim.
#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
    state.status()
}

/// What "Check again" on the diagnostic panel does to the shell.
///
/// The panel's own reload only re-asks the backend and the shell for what they
/// already decided. This asks the supervisor to bring its next check forward,
/// so a service that has come back on the port is attached to now rather than
/// up to ten seconds from now. It asks and returns; the answer arrives through
/// `backend_status` like every other change of state.
#[tauri::command]
fn backend_recheck(state: tauri::State<'_, BackendState>) -> BackendStatus {
    state.request_recheck();
    state.status()
}

#[derive(Serialize)]
struct LogTail {
    path: String,
    lines: Vec<String>,
}

/// The last `count` lines of today's log.
///
/// An absent file is an ordinary answer, not a failure: the startup screen asks
/// for the tail before the backend has written its first line.
#[tauri::command]
fn backend_log_tail(count: usize) -> LogTail {
    let (path, lines) = logging::tail(count.clamp(1, 500));
    LogTail {
        path: path.to_string_lossy().into_owned(),
        lines,
    }
}

/// Open the log directory in the file manager.
///
/// The directory rather than the file: the panel already shows the tail of
/// today's log, and what a person opening this actually wants is yesterday's
/// file, or all seven of them to attach somewhere. The path is the shell's own,
/// never one the renderer supplies, so nothing the page can say decides what
/// gets opened.
#[tauri::command]
fn open_log_folder() -> Result<String, String> {
    let directory = logging::log_dir();
    // A first run can reach this before anything has been written.
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    tauri_plugin_opener::open_path(&directory, None::<&str>).map_err(|error| error.to_string())?;
    Ok(directory.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend_status,
            backend_recheck,
            backend_log_tail,
            open_log_folder
        ])
        .setup(|app| {
            logging::shell("Job Hunter is starting");

            // Which port the backend will be on has to be settled before the
            // window exists, because the answer goes into the window's
            // initialization script. A free port costs a refused loopback
            // connection; only a port somebody else is holding costs a probe.
            let port = backend::decide_port(app.handle());

            // The page is served from tauri://localhost, so a relative /api
            // path would never reach the backend. This used to be a
            // window.eval at PageLoadEvent::Started, racing the renderer's own
            // module evaluation and forcing 'unsafe-inline' into script-src.
            // An initialization script is guaranteed to run first.
            let address = format!("window.__JOB_HUNTER_API__ = 'http://127.0.0.1:{port}';");

            // The window keeps its size, title and colours in tauri.conf.json,
            // where "create": false stops Tauri opening it before the script is
            // attached. Rebuilding it from that same config adds the script
            // without moving the window's appearance into Rust.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .expect("tauri.conf.json must define a window labelled main");

            // The window comes up first, and the renderer paints its startup
            // state while the backend is still being found and launched. It
            // used to wait for start() to return, which meant up to ninety
            // seconds of no window at all whenever the backend was unwell.
            let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(address)
                .build()?;
            let _ = window.show();
            let _ = window.set_focus();

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // The result is recorded in the backend state, which the
                // renderer reads through backend_status; the log keeps the
                // detail for afterwards.
                let _ = backend::start(&handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.app_handle().state::<BackendState>().shutdown();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Job Hunter application")
        .run(|handle, event| {
            // Whichever way the application exits, the backend goes with it.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                logging::shell("Job Hunter is closing");
                handle.state::<BackendState>().shutdown();
            }
        });
}
