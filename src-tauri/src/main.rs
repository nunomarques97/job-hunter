// The release build must not open a console window behind the application.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use backend::{BackendState, StartError};
use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, WindowEvent};

/// Where the renderer should send its API calls.
///
/// The port is chosen at startup, because a developer may already have the
/// backend running, so the renderer asks rather than assuming.
#[tauri::command]
fn backend_port(state: tauri::State<'_, BackendState>) -> u16 {
    *state.port.lock().unwrap()
}

/// Whether the backend is answering right now, for the interface to show.
#[tauri::command]
fn backend_ready(state: tauri::State<'_, BackendState>) -> bool {
    backend::port_in_use(*state.port.lock().unwrap())
}

/// Why the backend is not running, when it is not.
///
/// The typed value distinguishes a machine that has never had
/// `scripts/setup.ps1` run on it from a backend that started and stayed silent,
/// and carries the paths that were looked at so the diagnostic can show them.
#[tauri::command]
fn backend_failure(state: tauri::State<'_, BackendState>) -> Option<StartError> {
    state.failure.lock().unwrap().clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend_port,
            backend_ready,
            backend_failure
        ])
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
            let handle = app.handle().clone();

            // The window is created hidden and shown once the backend answers,
            // so the user never sees an empty shell failing to load data.
            std::thread::spawn(move || {
                let started = backend::start(&handle);
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                if let Err(error) = started {
                    // Named cases, because the two that matter have different
                    // answers: one is fixed by running a script, the other is a
                    // backend that is genuinely failing to serve.
                    match &error {
                        StartError::NoPythonEnvironment { probed } => {
                            eprintln!(
                                "Job Hunter: {} {} Looked at: {}",
                                error.summary(),
                                error.remedy(),
                                probed.join(", ")
                            );
                        }
                        _ => eprintln!("Job Hunter: {error}"),
                    }
                }
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
                handle.state::<BackendState>().shutdown();
            }
        });
}
