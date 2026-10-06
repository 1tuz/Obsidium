use super::document::{
    ensure_directory_impl, hash_bytes, read_file_hash_impl, read_file_snapshot_impl,
    read_file_stat_impl,
};
use super::error::FileCommandError;
use crate::blocking::run_blocking;
use super::gate;
use crate::history::Source;
use super::models::{FileItem, FileRenameResult, FileSnapshot, FileStat, FileWriteResult};
use super::deletions::{deletion_page_impl, DeletionPage};
use super::trash::{
    cleanup_trash_impl, ensure_trash_impl, trash_state_impl,
    TrashState,
};
use super::workspace::{existing_files_impl, read_directory_impl};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const TRASH_PAGE_LIMIT: usize = 200;

#[derive(Clone, Copy, Default, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteSource {
    #[default]
    Edit,
    ReadingProgress,
    #[serde(rename_all = "camelCase")]
    Restore { from_ms: u64 },
    #[serde(rename_all = "camelCase")]
    Revert { from_ms: u64 },
}

impl From<WriteSource> for Source {
    fn from(source: WriteSource) -> Self {
        match source {
            WriteSource::Edit => Source::Me,
            WriteSource::ReadingProgress => Source::Reading,
            WriteSource::Restore { from_ms } => Source::Restore(from_ms),
            WriteSource::Revert { from_ms } => Source::Revert(from_ms),
        }
    }
}

#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<FileItem>, FileCommandError> {
    run_blocking(move || read_directory_impl(Path::new(&path))).await
}

#[tauri::command]
pub async fn resolve_attachments(
    workspace_path: String,
    names: Vec<String>,
) -> Result<Vec<Option<String>>, FileCommandError> {
    run_blocking(move || {
        Ok(super::attachments::resolve_attachments_impl(
            Path::new(&workspace_path),
            names,
        ))
    })
    .await
}

#[tauri::command]
pub async fn existing_files(paths: Vec<String>) -> Result<Vec<String>, FileCommandError> {
    run_blocking(move || Ok(existing_files_impl(paths))).await
}

#[tauri::command]
pub async fn read_file_snapshot(path: String) -> Result<FileSnapshot, FileCommandError> {
    run_blocking(move || read_file_snapshot_impl(Path::new(&path))).await
}

#[tauri::command]
pub async fn read_file_hash(path: String) -> Result<String, FileCommandError> {
    run_blocking(move || read_file_hash_impl(Path::new(&path))).await
}

#[tauri::command]
pub async fn read_file_stat(path: String) -> Result<FileStat, FileCommandError> {
    run_blocking(move || read_file_stat_impl(Path::new(&path))).await
}

#[tauri::command]
pub fn hash_text(text: String) -> String {
    hash_bytes(text.as_bytes())
}

#[tauri::command]
pub async fn write_file_atomic(
    app: AppHandle,
    path: String,
    content: String,
    expected_hash: Option<String>,
    source: Option<WriteSource>,
) -> Result<FileWriteResult, FileCommandError> {
    let source = Source::from(source.unwrap_or_default());
    run_blocking(move || {
        gate::write(&app, Path::new(&path), &content, expected_hash.as_deref(), source, None)
    })
    .await
}

#[tauri::command]
pub async fn create_file(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<FileWriteResult, FileCommandError> {
    run_blocking(move || gate::create(&app, Path::new(&path), &content, Source::Me, None)).await
}

#[tauri::command]
pub async fn create_binary_file(
    app: AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<FileWriteResult, FileCommandError> {
    run_blocking(move || gate::create_binary(&app, Path::new(&path), &bytes)).await
}

#[tauri::command]
pub async fn trash_file(
    app: AppHandle,
    workspace_path: String,
    path: String,
) -> Result<String, FileCommandError> {
    let moved = run_blocking(move || {
        gate::trash(&app, Path::new(&workspace_path), Path::new(&path))
    })
    .await?;
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn list_trash(
    workspace_path: String,
    offset: usize,
    limit: usize,
) -> Result<DeletionPage, FileCommandError> {
    run_blocking(move || deletion_page_impl(Path::new(&workspace_path), offset, limit.min(TRASH_PAGE_LIMIT))).await
}

#[tauri::command]
pub async fn restore_deletion(
    app: AppHandle,
    workspace_path: String,
    id: String,
) -> Result<(), FileCommandError> {
    run_blocking(move || gate::restore_deletion(&app, Path::new(&workspace_path), &id)).await
}

#[tauri::command]
pub async fn get_trash_state(workspace_path: String) -> Result<TrashState, FileCommandError> {
    run_blocking(move || trash_state_impl(Path::new(&workspace_path))).await
}

#[tauri::command]
pub async fn open_trash(app: AppHandle, workspace_path: String) -> Result<(), FileCommandError> {
    let path = run_blocking(move || ensure_trash_impl(Path::new(&workspace_path))).await?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| FileCommandError::Io {
            message: error.to_string(),
        })
}

#[tauri::command]
pub async fn cleanup_trash(
    workspace_path: String,
    retention_days: u32,
) -> Result<u64, FileCommandError> {
    run_blocking(move || cleanup_trash_impl(Path::new(&workspace_path), retention_days)).await
}

#[tauri::command]
pub async fn ensure_directory(path: String) -> Result<(), FileCommandError> {
    run_blocking(move || ensure_directory_impl(Path::new(&path))).await
}

#[tauri::command]
pub async fn copy_file(app: AppHandle, from: String, to: String) -> Result<(), FileCommandError> {
    run_blocking(move || gate::copy(&app, Path::new(&from), Path::new(&to))).await
}

#[tauri::command]
pub async fn rename_file(
    app: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<FileRenameResult, FileCommandError> {
    run_blocking(move || gate::rename(&app, Path::new(&old_path), Path::new(&new_path))).await
}
