mod config;
mod focus;
mod history;
mod ide;
mod poller;
mod process_ext;
mod sessions;
mod status;
mod types;

use std::sync::Mutex;
use types::AppConfig;

/// Shared config state exposed to Tauri commands.
pub struct ConfigState(pub Mutex<Option<AppConfig>>);

#[tauri::command]
fn get_config(state: tauri::State<'_, ConfigState>) -> Result<AppConfig, String> {
    if let Some(cfg) = state.0.lock().ok().and_then(|c| c.clone()) {
        return Ok(cfg);
    }
    let cfg = config::init_config()
        .ok_or_else(|| "No WSL Claude configuration found".to_string())?;
    if let Ok(mut slot) = state.0.lock() {
        *slot = Some(cfg.clone());
    }
    Ok(cfg)
}

#[tauri::command]
fn set_always_on_top(enabled: bool, window: tauri::Window) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_conversation(
    project_path: String,
    session_id: String,
    state: tauri::State<'_, ConfigState>,
) -> Result<Vec<history::ConversationEntry>, String> {
    let cfg = state
        .0
        .lock()
        .ok()
        .and_then(|c| c.clone())
        .ok_or_else(|| "No WSL configuration available".to_string())?;
    Ok(history::read_conversation(
        &cfg,
        &project_path,
        &session_id,
        2_000_000, // last 2MB
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ConfigState(Mutex::new(config::init_config())))
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_always_on_top,
            get_conversation,
            focus::focus_agent,
            focus::send_to_terminal
        ])
        .setup(|app| {
            poller::start_polling(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
