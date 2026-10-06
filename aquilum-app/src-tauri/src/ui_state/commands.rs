use super::error::UiStateError;
use crate::blocking::run_blocking;
use super::models::{
    KnownWorkspace, LoadedReaderState, LoadedSession, OpenSessionInput, SaveReaderStateInput,
    SaveStateBatchInput,
};
use super::paths::{canonical_workspace, normalize_relative};
use super::service::UiStateService;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn list_ui_workspaces(
    service: State<'_, UiStateService>,
) -> Result<Vec<KnownWorkspace>, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.list_workspaces()).await
}

#[tauri::command]
pub async fn set_ui_workspace_home_page(
    service: State<'_, UiStateService>,
    path: String,
    home_page: String,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    let canonical = canonical_workspace(&path)?;
    run_blocking(move || service.set_home_page(&canonical, &home_page)).await
}

#[tauri::command]
pub async fn forget_ui_workspace(
    service: State<'_, UiStateService>,
    workspace_id: Uuid,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.forget_workspace(workspace_id)).await
}

#[tauri::command]
pub async fn resolve_ui_workspace(
    service: State<'_, UiStateService>,
    path: String,
    now_ms: i64,
) -> Result<Uuid, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || {
        let path = canonical_workspace(&path)?;
        service.resolve_workspace(&path, now_ms)
    })
    .await
}

#[tauri::command]
pub async fn resolve_ui_document(
    service: State<'_, UiStateService>,
    workspace_id: Uuid,
    relative_path: String,
) -> Result<Uuid, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || {
        let relative_path = normalize_relative(&relative_path)?;
        service.resolve_document(workspace_id, &relative_path)
    })
    .await
}

#[tauri::command]
pub async fn open_ui_session(
    service: State<'_, UiStateService>,
    input: OpenSessionInput,
) -> Result<LoadedSession, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.open_session(&input)).await
}

#[tauri::command]
pub async fn save_ui_state_batch(
    service: State<'_, UiStateService>,
    input: SaveStateBatchInput,
) -> Result<bool, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.save_batch(&input)).await
}

#[tauri::command]
pub async fn load_ui_document_view(
    service: State<'_, UiStateService>,
    workspace_id: Uuid,
    window_id: String,
    document_id: Uuid,
    pane_id: String,
) -> Result<Option<super::models::LoadedViewState>, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.load_view(workspace_id, &window_id, document_id, &pane_id)).await
}

#[tauri::command]
pub async fn rename_ui_document(
    service: State<'_, UiStateService>,
    document_id: Uuid,
    relative_path: String,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || {
        let relative_path = normalize_relative(&relative_path)?;
        service.rename_document(document_id, &relative_path)
    })
    .await
}

#[tauri::command]
pub async fn mark_ui_document_missing(
    service: State<'_, UiStateService>,
    document_id: Uuid,
    now_ms: i64,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.mark_document_missing(document_id, now_ms)).await
}

#[tauri::command]
pub async fn cleanup_ui_state(
    service: State<'_, UiStateService>,
    retention_days: u32,
    now_ms: i64,
) -> Result<usize, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.cleanup(retention_days, now_ms)).await
}

#[tauri::command]
pub async fn reset_ui_state(
    service: State<'_, UiStateService>,
    now_ms: i64,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || service.reset(now_ms)).await
}

#[tauri::command]
pub async fn load_ui_reader_state(
    service: State<'_, UiStateService>,
    workspace_id: Uuid,
    book_file: String,
) -> Result<Option<LoadedReaderState>, UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || {
        let book_file = normalize_relative(&book_file)?;
        service.load_reader_state(workspace_id, &book_file)
    })
    .await
}

#[tauri::command]
pub async fn save_ui_reader_state(
    service: State<'_, UiStateService>,
    input: SaveReaderStateInput,
) -> Result<(), UiStateError> {
    let service = service.inner().clone();
    run_blocking(move || {
        let book_file = normalize_relative(&input.book_file)?;
        service.save_reader_state(&SaveReaderStateInput {
            book_file,
            ..input
        })
    })
    .await
}
