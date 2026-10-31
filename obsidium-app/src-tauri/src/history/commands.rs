use super::service::{HistoryPage, VersionTexts};
use super::store;
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::error::FileCommandError;
use crate::files::gate;
use crate::files::trash::existing_trash_path;
use std::sync::Arc;
use tauri::State;

const HISTORY_PAGE_LIMIT: usize = 200;

#[tauri::command]
pub async fn note_history(
    core: State<'_, Arc<Core>>,
    path: String,
    offset: usize,
    limit: usize,
) -> Result<HistoryPage, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let history = &core.history;
        let path = core.access.check(&path)?;
        Ok(history.page(
            &|| core.known_roots(),
            &path,
            offset,
            limit.min(HISTORY_PAGE_LIMIT),
        ))
    })
    .await
}

#[tauri::command]
pub async fn read_note_version(
    core: State<'_, Arc<Core>>,
    path: String,
    version: Option<String>,
) -> Result<Option<VersionTexts>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let history = &core.history;
        let path = core.access.check(&path)?;
        Ok(history.version(&|| core.known_roots(), &path, version.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn name_note_version(
    core: State<'_, Arc<Core>>,
    path: String,
    version: Option<String>,
    name: String,
) -> Result<Option<String>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(gate::name_version(&core, &path, version.as_deref(), &name))
    })
    .await
}

#[tauri::command]
pub async fn cleanup_history(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    retention_days: u32,
) -> Result<u64, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let vault = core.access.check_root(&workspace_path)?;
        store::adopt_legacy_history_tree(&vault);
        if let Some(trash) = existing_trash_path(&vault)? {
            store::adopt_legacy_history_tree(&trash);
        }
        Ok(store::remove_expired(&vault, retention_days))
    })
    .await
}
