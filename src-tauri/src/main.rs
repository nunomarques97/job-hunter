// The release build must not open a console window behind the application.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod logging;

use backend::{BackendState, BackendStatus};
use serde::Serialize;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, WindowEvent};

/// What the shell knows about the backend: starting, answering, or failed with
/// a reason the startup screen renders verbatim.
#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![backend_status, backend_log_tail])
        .on_page_load(|window, payload| {
            // Tell the renderer where the backend actually ended up. The page is
            // served from tauri://localhost, so a relative /api path would never
            // reach it. This runs as navigation starts, before the bundle's own
            // scripts, and the renderer falls back to the default port if it
            // somehow does not.
            if payload.event() != PageLoadEvent::Started {
                return;
            }
            let port = *window.app_handle().state::<BackendState>().port.lock().unwrap();
            let port = if port == 0 { backend::DEFAULT_PORT } else { port };
            let _ = window.eval(&format!(
                "window.__JOB_HUNTER_API__ = 'http://127.0.0.1:{port}';"
            ));
        })
        .setup(|app| {
            logging::shell("Job Hunter is starting");

            // The window comes up first, and the renderer paints its startup
            // state while the backend is still being found and launched. It
            // used to wait for start() to return, which meant up to ninety
            // seconds of no window at all whenever the backend was unwell.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

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
