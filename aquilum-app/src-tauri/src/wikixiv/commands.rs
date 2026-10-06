use super::models::{SearchRequest, WikixivSearchResult};
use super::service::WikixivService;
use crate::settings::manager::SettingsManager;
use tauri::State;

#[tauri::command]
pub async fn wikixiv_search(
    service: State<'_, WikixivService>,
    settings: State<'_, SettingsManager>,
    text: String,
    generation: u64,
    document_path: Option<String>,
) -> Result<WikixivSearchResult, String> {
    let service = service.inner().clone();
    let enabled = settings.get_config().analysis.enable_wikixiv;
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
    .map_err(|error| error.to_string())?
}
