use crate::app_core::Core;
use crate::blocking::run_blocking;
use obsidium_core::search::dataview::{InlineRequest, InlineResult};
use obsidium_core::search::error::SearchError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn evaluate_inline_expressions(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    note_path: String,
    expressions: Vec<InlineRequest>,
    tz_offset_minutes: Option<i64>,
) -> Result<Vec<InlineResult>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let note_path = core.access.check(&note_path)?;
        service.evaluate_inline_expressions(
            &workspace_path.to_string_lossy(),
            &note_path.to_string_lossy(),
            &expressions,
            tz_offset_minutes.unwrap_or_default(),
        )
    })
    .await
}
