use super::{list_dates, note_path, today, JournalError, JournalNote};
use crate::app_core::Core;
use crate::blocking::run_blocking;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn journal_today(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<JournalNote, JournalError> {
    let settings = core.settings.get_config().journal;
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        today(&root, &settings)
    })
    .await
}

#[tauri::command]
pub async fn journal_dates(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<String>, JournalError> {
    let settings = core.settings.get_config().journal;
    let core = Arc::clone(&core);
    run_blocking::<_, JournalError, _>(move || {
        let root = core.access.check_root(&workspace_path)?;
        let dates: Vec<String> = list_dates(&root, &settings)
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
    let core = Arc::clone(&core);
    run_blocking::<_, JournalError, _>(move || {
        let root = core.access.check_root(&workspace_path)?;
        note_path(&root, &settings, (year, month, day))
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}
