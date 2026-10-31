use super::models::{AnalysisMethod, AnalysisResult};
use super::report::KnowledgeReport;
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::search::error::SearchError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn analyze_document(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    document_path: String,
    method: AnalysisMethod,
    limit: Option<usize>,
) -> Result<Vec<AnalysisResult>, SearchError> {
    let settings = &core.settings;
    let service = core.search.clone();
    let config = settings.get_config();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let document_path = core.access.check(&document_path)?;
        service.analyze_document(
            &workspace_path.to_string_lossy(),
            &document_path.to_string_lossy(),
            method,
            limit,
            &config,
        )
    })
    .await
}

#[tauri::command]
pub async fn get_knowledge_report(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    stale_after_days: Option<u64>,
) -> Result<KnowledgeReport, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.knowledge_report(&workspace_path.to_string_lossy(), stale_after_days)
    })
    .await
}
