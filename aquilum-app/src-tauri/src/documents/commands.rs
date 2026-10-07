use super::hub::{DocumentHub, HubError, LegacyReplica, OpenedDocument, PullResult};
use super::session::{SessionError, SYSTEM_CLIENT};
use crate::blocking::run_blocking;
use crate::files::commands::WriteSource;
use crate::history::Source;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum DocumentCommandError {
    NotOpen,
    Stale,
    Missing,
    InvalidUtf8 { message: String },
    InvalidChanges { message: String },
    Io { message: String },
    Task { message: String },
}

impl From<HubError> for DocumentCommandError {
    fn from(error: HubError) -> Self {
        match error {
            HubError::NotOpen => Self::NotOpen,
            HubError::Stale => Self::Stale,
            HubError::Session(SessionError::Missing) => Self::Missing,
            HubError::Session(SessionError::Change(error)) => Self::InvalidChanges { message: error.to_string() },
            HubError::Session(SessionError::Disk { code: "invalid_utf8", message }) => Self::InvalidUtf8 { message },
            HubError::Session(error) => Self::Io { message: error.to_string() },
        }
    }
}

impl From<tauri::Error> for DocumentCommandError {
    fn from(error: tauri::Error) -> Self {
        Self::Task { message: error.to_string() }
    }
}

fn hub(app: &AppHandle) -> tauri::State<'_, DocumentHub> {
    app.state::<DocumentHub>()
}

#[tauri::command]
pub async fn document_open(
    app: AppHandle,
    path: String,
    tz_offset_minutes: i64,
) -> Result<OpenedDocument, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).open(&app, Path::new(&path), tz_offset_minutes)?)).await
}

#[tauri::command]
pub async fn document_push(
    app: AppHandle,
    path: String,
    version: u64,
    client: String,
    changes: Vec<Value>,
) -> Result<bool, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).push(&app, Path::new(&path), version, &client, &changes)?)).await
}

#[tauri::command]
pub async fn document_pull(app: AppHandle, path: String, version: u64) -> Result<PullResult, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).pull(Path::new(&path), version)?)).await
}

#[tauri::command]
pub async fn document_replace_text(
    app: AppHandle,
    path: String,
    text: String,
    source: Option<WriteSource>,
    base_version: Option<u64>,
) -> Result<u64, DocumentCommandError> {
    let source = Source::from(source.unwrap_or_default());
    run_blocking(move || {
        Ok(hub(&app).replace_text(&app, Path::new(&path), &text, SYSTEM_CLIENT, source, base_version)?)
    })
    .await
}

#[tauri::command]
pub async fn document_revert(
    app: AppHandle,
    path: String,
    version_text: String,
    previous_text: String,
    from_ms: u64,
) -> Result<bool, DocumentCommandError> {
    let source = Source::from(WriteSource::Revert { from_ms });
    run_blocking(move || Ok(hub(&app).revert(&app, Path::new(&path), &version_text, &previous_text, source)?)).await
}

#[tauri::command]
pub async fn document_import_legacy(app: AppHandle, replicas: Vec<LegacyReplica>) -> Result<usize, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).import_legacy(&replicas))).await
}

#[tauri::command]
pub async fn document_read(app: AppHandle, path: String) -> Result<OpenedDocument, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).read(&app, Path::new(&path))?)).await
}

#[tauri::command]
pub async fn document_resolve_positions(
    app: AppHandle,
    path: String,
    positions: Vec<Vec<u8>>,
) -> Result<Vec<Option<usize>>, DocumentCommandError> {
    run_blocking(move || Ok(hub(&app).resolve_positions(Path::new(&path), &positions)?)).await
}

#[tauri::command]
pub async fn document_release(app: AppHandle, path: String) -> Result<(), DocumentCommandError> {
    run_blocking(move || {
        hub(&app).release(&app, Path::new(&path));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn document_flush_all(app: AppHandle) -> Result<(), DocumentCommandError> {
    run_blocking(move || {
        hub(&app).flush_all(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn document_reconcile_all(app: AppHandle) -> Result<(), DocumentCommandError> {
    run_blocking(move || {
        hub(&app).reconcile_all(&app);
        Ok(())
    })
    .await
}
