use super::active::ActiveNote;
use super::{McpServer, McpStatus};
use crate::settings::manager::SettingsManager;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn set_active_note(active: State<'_, ActiveNote>, path: Option<String>) {
    active.set(path.map(PathBuf::from));
}

#[tauri::command]
pub fn get_mcp_status(server: State<'_, McpServer>) -> McpStatus {
    server.status()
}

#[tauri::command]
pub fn apply_mcp_settings(
    app: AppHandle,
    server: State<'_, McpServer>,
    settings: State<'_, SettingsManager>,
) -> McpStatus {
    server.apply(&app, &settings.get_config().mcp)
}
