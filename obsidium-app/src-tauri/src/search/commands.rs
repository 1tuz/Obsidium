use super::bases::{BaseEvaluation, BaseQuery};
use super::dataview::QueryOutput;
use super::error::SearchError;
use super::fields::NoteFields;
use super::models::{
    Backlink, NoteSuggestion, OutgoingLink, SearchIndexStatus, SearchResponse, WikiLinkResolution,
};
use super::CalendarEvent;
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::error::FileCommandError;
use obsidium_core::search::activity::{ActivityMeasure, ActivityNote};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn prepare_search_index(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<SearchIndexStatus, SearchError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        if let Err(error) = core.watcher.watch(&workspace_path) {
            eprintln!(
                "[obsidium:watch] наблюдение за базой не запущено: {error}. \
                 Внешние правки будут подтягиваться при возврате фокуса в окно."
            );
        }
        core.search.prepare(&workspace_path.to_string_lossy())
    })
    .await
}

#[tauri::command]
pub async fn search_knowledge_base(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<SearchResponse, SearchError> {
    let service = core.search.clone();
    let settings = core.settings.get_config().search;
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.search(&workspace_path.to_string_lossy(), &query, limit, &settings)
    })
    .await
}

#[tauri::command]
pub fn get_search_index_status(
    core: State<'_, Arc<Core>>,
    workspace_path: Option<String>,
) -> SearchIndexStatus {
    let service = &core.search;
    let workspace_path = workspace_path
        .and_then(|path| core.access.check_root(&path).ok())
        .map(|path| path.to_string_lossy().into_owned());
    service.status(workspace_path.as_deref())
}

#[tauri::command]
pub fn get_search_cache_size(core: State<'_, Arc<Core>>) -> u64 {
    core.search.search_cache_size()
}

#[tauri::command]
pub async fn clear_unused_search_cache(core: State<'_, Arc<Core>>) -> Result<u64, SearchError> {
    let service = core.search.clone();
    run_blocking(move || service.clear_unused_search_cache()).await
}

#[tauri::command]
pub async fn rebuild_search_index(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<SearchIndexStatus, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.rebuild_active_index(&workspace_path.to_string_lossy())
    })
    .await
}

#[tauri::command]
pub async fn get_backlinks(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    document_path: String,
) -> Result<Vec<Backlink>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let document_path = core.access.check(&document_path)?;
        service.backlinks(
            &workspace_path.to_string_lossy(),
            &document_path.to_string_lossy(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_outgoing_links(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    document_path: String,
) -> Result<Vec<OutgoingLink>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let document_path = core.access.check(&document_path)?;
        service.outgoing_links(
            &workspace_path.to_string_lossy(),
            &document_path.to_string_lossy(),
        )
    })
    .await
}

#[tauri::command]
pub async fn run_dataview_query(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    document_path: String,
    query: String,
    tz_offset_minutes: i64,
) -> Result<QueryOutput, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let document_path = core.access.check(&document_path)?;
        service.run_dataview_query(
            &workspace_path.to_string_lossy(),
            &document_path.to_string_lossy(),
            &query,
            tz_offset_minutes,
        )
    })
    .await
}

#[tauri::command]
pub async fn get_note_fields(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    document_paths: Vec<String>,
) -> Result<Vec<NoteFields>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let document_paths = document_paths
            .iter()
            .map(|path| {
                core.access
                    .check(path)
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        service.note_fields(&workspace_path.to_string_lossy(), &document_paths)
    })
    .await
}

#[tauri::command]
pub async fn get_base_rows(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<NoteFields>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.base_rows(&workspace_path.to_string_lossy())
    })
    .await
}

#[tauri::command]
pub async fn get_note_activity(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<obsidium_core::search::activity::NoteTimestamp>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.note_timestamps(&workspace_path.to_string_lossy())
    })
    .await
}

#[tauri::command]
pub async fn get_note_day_notes(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    day: String,
    measure: ActivityMeasure,
    tz_offset_minutes: i64,
) -> Result<Vec<ActivityNote>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.notes_on_day(
            &workspace_path.to_string_lossy(),
            &day,
            measure,
            tz_offset_minutes,
        )
    })
    .await
}

#[tauri::command]
pub async fn get_recent_changes(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    limit: Option<usize>,
) -> Result<Vec<ActivityNote>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.recent_changes(&workspace_path.to_string_lossy(), limit)
    })
    .await
}

#[tauri::command]
pub async fn get_calendar_events(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    year: i64,
    month: i64,
) -> Result<Vec<CalendarEvent>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.calendar_events(&workspace_path.to_string_lossy(), year, month)
    })
    .await
}

#[tauri::command]
pub async fn query_base(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    query: BaseQuery,
) -> Result<BaseEvaluation, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.query_base(&workspace_path.to_string_lossy(), &query)
    })
    .await
}

#[tauri::command]
pub async fn resolve_wiki_links(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    source_path: String,
    targets: Vec<String>,
) -> Result<WikiLinkResolution, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        let source_path = core.access.check(&source_path)?;
        service.resolve_wiki_links(
            &workspace_path.to_string_lossy(),
            &source_path.to_string_lossy(),
            &targets,
        )
    })
    .await
}

#[tauri::command]
pub async fn suggest_notes(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<NoteSuggestion>, SearchError> {
    let service = core.search.clone();
    let core = Arc::clone(&core);
    run_blocking(move || {
        let workspace_path = core.access.check_root(&workspace_path)?;
        service.suggest_notes(
            &workspace_path.to_string_lossy(),
            &query,
            limit.unwrap_or(12),
        )
    })
    .await
}

#[tauri::command]
pub async fn update_task_status(
    core: State<'_, Arc<Core>>,
    path: String,
    task_id: String,
    new_status: String,
) -> Result<bool, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let path = core.access.check(&path)?;
        super::tasks::update_task_status(&path, &task_id, &new_status)
    })
    .await
}
