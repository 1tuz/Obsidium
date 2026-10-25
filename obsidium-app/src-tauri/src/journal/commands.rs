use super::{list_dates, note_path, today, JournalError, JournalNote};
use crate::app_core::Core;
use crate::blocking::run_blocking;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn journal_today(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<JournalNote, JournalError> {
    let settings = core.settings.get_config().journal;
    run_blocking(move || today(Path::new(&workspace_path), &settings)).await
}

#[tauri::command]
pub async fn journal_dates(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<String>, JournalError> {
    let settings = core.settings.get_config().journal;
    run_blocking::<_, JournalError, _>(move || {
        let dates: Vec<String> = list_dates(Path::new(&workspace_path), &settings)
            .into_iter()
            .map(|(year, month, day)| format!("{year:04}-{month:02}-{day:02}"))
            .collect();
        Ok(dates)
    })
    .await
}

#[tauri::command]
pub async fn journal_note(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    year: i64,
    month: i64,
    day: i64,
) -> Result<String, JournalError> {
    let settings = core.settings.get_config().journal;
    run_blocking::<_, JournalError, _>(move || {
        note_path(Path::new(&workspace_path), &settings, (year, month, day))
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}
