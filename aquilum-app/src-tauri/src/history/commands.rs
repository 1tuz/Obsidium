use super::service::{HistoryPage, VersionTexts};
use super::{store, HistoryService};
use crate::blocking::run_blocking;
use crate::files::error::FileCommandError;
use crate::files::gate::{self, known_roots};
use crate::files::trash::trash_path;
use std::path::Path;
use tauri::{AppHandle, Manager};

const HISTORY_PAGE_LIMIT: usize = 200;

#[tauri::command]
pub async fn note_history(
    app: AppHandle,
    path: String,
    offset: usize,
    limit: usize,
) -> Result<HistoryPage, FileCommandError> {
    run_blocking(move || {
        let history = app.state::<HistoryService>();
        Ok(history.page(&|| known_roots(&app), Path::new(&path), offset, limit.min(HISTORY_PAGE_LIMIT)))
    })
    .await
}

#[tauri::command]
pub async fn read_note_version(
    app: AppHandle,
    path: String,
    version: Option<String>,
) -> Result<Option<VersionTexts>, FileCommandError> {
    run_blocking(move || {
        let history = app.state::<HistoryService>();
        Ok(history.version(&|| known_roots(&app), Path::new(&path), version.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn name_note_version(
    app: AppHandle,
    path: String,
    version: Option<String>,
    name: String,
) -> Result<Option<String>, FileCommandError> {
    run_blocking(move || Ok(gate::name_version(&app, Path::new(&path), version.as_deref(), &name))).await
}

#[tauri::command]
pub async fn cleanup_history(
    workspace_path: String,
    retention_days: u32,
) -> Result<u64, FileCommandError> {
    run_blocking(move || {
        let vault = Path::new(&workspace_path);
        store::adopt_quantum_history(vault);
        store::adopt_quantum_history(&trash_path(vault));
        Ok(store::remove_expired(vault, retention_days))
    })
    .await
}
