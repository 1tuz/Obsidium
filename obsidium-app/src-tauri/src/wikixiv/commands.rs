use super::models::{SearchRequest, WikixivSearchResult};
use crate::app_core::Core;
use crate::files::error::FileCommandError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn wikixiv_search(
    core: State<'_, Arc<Core>>,
    text: String,
    generation: u64,
    document_path: Option<String>,
) -> Result<WikixivSearchResult, FileCommandError> {
    let settings = &core.settings;
    let service = core.wikixiv.clone();
    let enabled = settings.get_config().analysis.enable_wikixiv;
    let document_path = match document_path {
        Some(path) => Some(core.access.check(&path)?.to_string_lossy().into_owned()),
        None => None,
    };
    tauri::async_runtime::spawn_blocking(move || {
        service.search(
            SearchRequest {
                text,
                document_path,
                generation,
            },
            enabled,
        )
    })
    .await
    .map_err(|error| FileCommandError::Task {
        message: error.to_string(),
    })?
    .map_err(|message| FileCommandError::Io { message })
}
