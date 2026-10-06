use super::models::{AnalysisMethod, AnalysisResult};
use crate::blocking::run_blocking;
use crate::search::error::SearchError;
use crate::search::service::SearchService;
use tauri::State;

use crate::settings::manager::SettingsManager;

#[tauri::command]
pub async fn analyze_document(
    service: State<'_, SearchService>,
    settings: State<'_, SettingsManager>,
    workspace_path: String,
    document_path: String,
    method: AnalysisMethod,
    limit: Option<usize>,
) -> Result<Vec<AnalysisResult>, SearchError> {
    let service = service.inner().clone();
    let config = settings.get_config();
    run_blocking(move || {
        service.analyze_document(&workspace_path, &document_path, method, limit, &config)
    })
    .await
}
