use super::McpStatus;
use crate::app_core::Core;
use crate::files::error::FileCommandError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn set_active_note(
    core: State<'_, Arc<Core>>,
    path: Option<String>,
) -> Result<(), FileCommandError> {
    let path = path.map(|path| core.access.check(&path)).transpose()?;
    core.active_note.set(path);
    Ok(())
}

#[tauri::command]
pub fn get_mcp_status(core: State<'_, Arc<Core>>) -> McpStatus {
    core.mcp.status()
}

#[tauri::command]
pub fn apply_mcp_settings(core: State<'_, Arc<Core>>) -> McpStatus {
    core.apply_mcp_settings()
}
