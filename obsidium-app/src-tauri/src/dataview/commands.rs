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
    run_blocking(move || {
        service.evaluate_inline_expressions(
            &workspace_path,
            &note_path,
            &expressions,
            tz_offset_minutes.unwrap_or_default(),
        )
    })
    .await
}
