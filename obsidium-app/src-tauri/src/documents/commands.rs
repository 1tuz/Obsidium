use super::hub::{HubError, LegacyReplica, OpenedDocument, PullResult};
use super::session::{SessionError, SYSTEM_CLIENT};
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::commands::WriteSource;
use crate::history::Source;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum DocumentCommandError {
    NotOpen,
    Stale,
    Missing,
    InvalidUtf8 { message: String },
    InvalidChanges { message: String },
    OutsideWorkspace { path: String },
    Io { message: String },
    Task { message: String },
}

impl From<HubError> for DocumentCommandError {
    fn from(error: HubError) -> Self {
        match error {
            HubError::NotOpen => Self::NotOpen,
            HubError::Stale => Self::Stale,
            HubError::Session(SessionError::Missing) => Self::Missing,
            HubError::Session(SessionError::Change(error)) => Self::InvalidChanges {
                message: error.to_string(),
            },
            HubError::Session(SessionError::Disk {
                code: "invalid_utf8",
                message,
            }) => Self::InvalidUtf8 { message },
            HubError::Session(error) => Self::Io {
                message: error.to_string(),
            },
        }
    }
}

impl From<crate::app_core::TaskFailed> for DocumentCommandError {
    fn from(error: crate::app_core::TaskFailed) -> Self {
        Self::Task {
            message: error.to_string(),
        }
    }
}

impl From<crate::files::error::FileCommandError> for DocumentCommandError {
    fn from(error: crate::files::error::FileCommandError) -> Self {
        match error {
            crate::files::error::FileCommandError::OutsideWorkspace { path } => {
                Self::OutsideWorkspace { path }
            }
            error => Self::Io {
                message: error.to_string(),
            },
        }
    }
}

#[tauri::command]
pub async fn document_open(
    core: State<'_, Arc<Core>>,
    path: String,
    tz_offset_minutes: i64,
) -> Result<OpenedDocument, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core.documents.open(&core, &path, tz_offset_minutes)?)
    })
    .await
}

#[tauri::command]
pub async fn document_push(
    core: State<'_, Arc<Core>>,
    path: String,
    version: u64,
    client: String,
    changes: Vec<Value>,
) -> Result<bool, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core
            .documents
            .push(&core, &path, version, &client, &changes)?)
    })
    .await
}

#[tauri::command]
pub async fn document_pull(
    core: State<'_, Arc<Core>>,
    path: String,
    version: u64,
) -> Result<PullResult, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core.documents.pull(&path, version)?)
    })
    .await
}

#[tauri::command]
pub async fn document_replace_text(
    core: State<'_, Arc<Core>>,
    path: String,
    text: String,
    source: Option<WriteSource>,
    base_version: Option<u64>,
) -> Result<u64, DocumentCommandError> {
    let source = Source::from(source.unwrap_or_default());
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core
            .documents
            .replace_text(&core, &path, &text, SYSTEM_CLIENT, source, base_version)?)
    })
    .await
}

#[tauri::command]
pub async fn document_revert(
    core: State<'_, Arc<Core>>,
    path: String,
    version_text: String,
    previous_text: String,
    from_ms: u64,
) -> Result<bool, DocumentCommandError> {
    let source = Source::from(WriteSource::Revert { from_ms });
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core
            .documents
            .revert(&core, &path, &version_text, &previous_text, source)?)
    })
    .await
}

#[tauri::command]
pub async fn document_import_legacy(
    core: State<'_, Arc<Core>>,
    replicas: Vec<LegacyReplica>,
) -> Result<usize, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let allowed: Vec<LegacyReplica> = replicas
            .into_iter()
            .filter_map(|mut replica| {
                let path = core.access.check(&replica.path).ok()?;
                replica.path = path.to_string_lossy().into_owned();
                Some(replica)
            })
            .collect();
        Ok(core.documents.import_legacy(&allowed))
    })
    .await
}

#[tauri::command]
pub async fn document_read(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<OpenedDocument, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core.documents.read(&core, &path)?)
    })
    .await
}

#[tauri::command]
pub async fn document_resolve_positions(
    core: State<'_, Arc<Core>>,
    path: String,
    positions: Vec<Vec<u8>>,
) -> Result<Vec<Option<usize>>, DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        Ok(core.documents.resolve_positions(&path, &positions)?)
    })
    .await
}

#[tauri::command]
pub async fn document_release(
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<(), DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        core.documents.release(&core, &path);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn document_flush_all(core: State<'_, Arc<Core>>) -> Result<(), DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        core.documents.flush_all(&core);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn document_reconcile_all(
    core: State<'_, Arc<Core>>,
) -> Result<(), DocumentCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        core.documents.reconcile_all(&core);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::DocumentCommandError;
    use crate::files::error::FileCommandError;
    use serde_json::json;

    #[test]
    fn path_access_errors_keep_the_outside_workspace_code() {
        let error = DocumentCommandError::from(FileCommandError::OutsideWorkspace {
            path: "/outside".to_owned(),
        });

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({ "code": "outside_workspace", "details": { "path": "/outside" } })
        );
    }
}
