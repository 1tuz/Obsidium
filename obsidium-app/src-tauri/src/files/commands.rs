use super::deletions::{deletion_page_impl, DeletionPage};
use super::document::{ensure_directory_impl, read_file_snapshot_impl, read_file_stat_impl};
use super::error::FileCommandError;
use super::gate;
use super::models::{FileItem, FileRenameResult, FileSnapshot, FileStat, FileWriteResult};
use super::trash::{cleanup_trash_impl, ensure_trash_impl, trash_state_impl, TrashState};
use super::workspace::{existing_files_impl, list_vault_snippets_impl, read_directory_impl};
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::history::Source;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const TRASH_PAGE_LIMIT: usize = 200;

#[derive(Clone, Copy, Default, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteSource {
    #[default]
    Edit,
    ReadingProgress,
    #[serde(rename_all = "camelCase")]
    Restore {
        from_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    Revert {
        from_ms: u64,
    },
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
pub async fn read_directory(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<Vec<FileItem>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        read_directory_impl(&path)
    })
    .await
}

#[tauri::command]
pub async fn list_vault_snippets(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<FileItem>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        list_vault_snippets_impl(&root)
    })
    .await
}

#[tauri::command]
pub async fn resolve_attachments(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    names: Vec<String>,
) -> Result<Vec<Option<String>>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        Ok(super::attachments::resolve_attachments_impl(&root, names))
    })
    .await
}

#[tauri::command]
pub async fn existing_files(
    core: State<'_, Arc<Core>>,
    paths: Vec<String>,
) -> Result<Vec<String>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let allowed: Vec<String> = paths
            .into_iter()
            .filter_map(|path| {
                core.access
                    .check(&path)
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .collect();
        Ok(existing_files_impl(allowed))
    })
    .await
}

#[tauri::command]
pub async fn read_file_snapshot(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<FileSnapshot, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        read_file_snapshot_impl(&path)
    })
    .await
}

#[tauri::command]
pub async fn read_file_stat(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<FileStat, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        read_file_stat_impl(&path)
    })
    .await
}

#[tauri::command]
pub async fn write_file_atomic(
    core: State<'_, Arc<Core>>,
    path: String,
    content: String,
    expected_hash: Option<String>,
    source: Option<WriteSource>,
) -> Result<FileWriteResult, FileCommandError> {
    let source = Source::from(source.unwrap_or_default());
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        gate::write(
            &core,
            &path,
            &content,
            expected_hash.as_deref(),
            source,
            None,
        )
    })
    .await
}

#[tauri::command]
pub async fn create_file(
    core: State<'_, Arc<Core>>,
    path: String,
    content: String,
) -> Result<FileWriteResult, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        gate::create(&core, &path, &content, Source::Me, None)
    })
    .await
}

#[tauri::command]
pub async fn create_binary_file(
    core: State<'_, Arc<Core>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<FileWriteResult, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        gate::create_binary(&core, &path, &bytes)
    })
    .await
}

#[tauri::command]
pub async fn trash_file(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    path: String,
) -> Result<String, FileCommandError> {
    let core = Arc::clone(&core);
    let moved = run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        let path = core.access.check(&path)?;
        gate::trash(&core, &root, &path)
    })
    .await?;
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn list_trash(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    offset: usize,
    limit: usize,
) -> Result<DeletionPage, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        deletion_page_impl(&root, offset, limit.min(TRASH_PAGE_LIMIT))
    })
    .await
}

#[tauri::command]
pub async fn restore_deletion(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    id: String,
) -> Result<(), FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        gate::restore_deletion(&core, &root, &id)
    })
    .await
}

#[tauri::command]
pub async fn get_trash_state(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<TrashState, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        trash_state_impl(&root)
    })
    .await
}

#[tauri::command]
pub async fn open_trash(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<(), FileCommandError> {
    let core = Arc::clone(&core);
    let path = run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        ensure_trash_impl(&root)
    })
    .await?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| FileCommandError::Io {
            message: error.to_string(),
        })
}

#[tauri::command]
pub async fn cleanup_trash(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    retention_days: u32,
) -> Result<u64, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        cleanup_trash_impl(&root, retention_days)
    })
    .await
}

#[tauri::command]
pub async fn ensure_directory(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<(), FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        ensure_directory_impl(&path)
    })
    .await
}

#[tauri::command]
pub async fn copy_file(
    core: State<'_, Arc<Core>>,
    from: String,
    to: String,
) -> Result<(), FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let from = core.access.check(&from)?;
        let to = core.access.check(&to)?;
        gate::copy(&core, &from, &to)
    })
    .await
}

#[tauri::command]
pub async fn rename_file(
    core: State<'_, Arc<Core>>,
    old_path: String,
    new_path: String,
) -> Result<FileRenameResult, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let old_path = core.access.check(&old_path)?;
        let new_path = core.access.check(&new_path)?;
        gate::rename(&core, &old_path, &new_path)
    })
    .await
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportKind {
    Book,
    Cover,
    Media,
}

impl ImportKind {
    fn filter(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Book => ("Books", &["epub", "mobi", "azw3", "fb2"]),
            Self::Cover => (
                "Images",
                &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
            ),
            Self::Media => (
                "Media",
                &[
                    "png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg", "mp4", "webm",
                    "mov", "m4v",
                ],
            ),
        }
    }
}

#[tauri::command]
pub async fn pick_import_file(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
    kind: ImportKind,
) -> Result<Option<String>, FileCommandError> {
    let (name, extensions) = kind.filter();
    let picked = run_blocking::<_, FileCommandError, _>(move || {
        Ok(app
            .dialog()
            .file()
            .add_filter(name, extensions)
            .blocking_pick_file())
    })
    .await?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| FileCommandError::Io {
        message: error.to_string(),
    })?;
    let granted = core.access.grant_file(&path.to_string_lossy())?;
    Ok(Some(granted.to_string_lossy().into_owned()))
}
