use super::error::UiStateError;
use super::models::{
    KnownWorkspace, LoadedReaderState, LoadedSession, OpenSessionInput, SaveBaseViewStateInput,
    SaveReaderStateInput, SaveStateBatchInput,
};
use super::paths::{canonical_workspace, display_workspace, normalize_relative};
use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::documents::DocumentHub;
use obsidium_core::access::PathGrants;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[tauri::command]
pub async fn list_ui_workspaces(
    core: State<'_, Arc<Core>>,
) -> Result<Vec<KnownWorkspace>, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || service.list_workspaces()).await
}

#[tauri::command]
pub async fn set_ui_workspace_home_page(
    core: State<'_, Arc<Core>>,
    path: String,
    home_page: String,
) -> Result<(), UiStateError> {
    let canonical = canonical_workspace(&path)?;
    core.access.check_root(&canonical)?;
    let service = core.ui_state.clone();
    run_blocking(move || service.set_home_page(&canonical, &home_page)).await
}

#[tauri::command]
pub async fn forget_ui_workspace(
    core: State<'_, Arc<Core>>,
    workspace_id: Uuid,
) -> Result<(), UiStateError> {
    let service = core.ui_state.clone();
    let access = Arc::clone(&core.access);
    run_blocking(move || {
        let known = service
            .list_workspaces()?
            .into_iter()
            .find(|workspace| workspace.id == workspace_id);
        service.forget_workspace(workspace_id)?;
        if let Some(workspace) = known {
            access.revoke_root(Path::new(&workspace.path));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn pick_workspace_folder(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
) -> Result<Option<String>, UiStateError> {
    let dialog_app = app.clone();
    let picked = run_blocking::<_, UiStateError, _>(move || {
        Ok(dialog_app.dialog().file().blocking_pick_folder())
    })
    .await?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|error| UiStateError::InvalidInput {
            message: error.to_string(),
        })?;
    let canonical = canonical_workspace(&path.to_string_lossy())?;
    let service = core.ui_state.clone();
    let value = canonical.clone();
    run_blocking(move || service.resolve_workspace(&value, now_millis())).await?;
    let root = Path::new(&canonical);
    core.access.grant_root(root);
    crate::access::allow_root(&app, root).map_err(|error| UiStateError::Io {
        message: error.to_string(),
    })?;
    Ok(Some(display_workspace(&canonical)))
}

#[tauri::command]
pub async fn resolve_ui_workspace(
    core: State<'_, Arc<Core>>,
    path: String,
    now_ms: i64,
) -> Result<Uuid, UiStateError> {
    let canonical = canonical_workspace(&path)?;
    core.access.check_root(&canonical)?;
    let service = core.ui_state.clone();
    run_blocking(move || service.resolve_workspace(&canonical, now_ms)).await
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn resolve_ui_document(
    core: State<'_, Arc<Core>>,
    workspace_id: Uuid,
    relative_path: String,
) -> Result<Uuid, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let relative_path = normalize_relative(&relative_path)?;
        service.resolve_document(workspace_id, &relative_path)
    })
    .await
}

#[tauri::command]
pub async fn open_ui_session(
    core: State<'_, Arc<Core>>,
    input: OpenSessionInput,
) -> Result<LoadedSession, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || service.open_session(&input)).await
}

#[tauri::command]
pub async fn save_ui_state_batch(
    core: State<'_, Arc<Core>>,
    mut input: SaveStateBatchInput,
) -> Result<bool, UiStateError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        for view in &mut input.views {
            validate_view_path(&core.access, &mut view.path)?;
        }
        anchor_views(&core.documents, &mut input);
        core.ui_state.save_batch(&input)
    })
    .await
}

fn anchor_views(hub: &DocumentHub, input: &mut SaveStateBatchInput) {
    for view in &mut input.views {
        let Some(path) = view.path.as_deref() else {
            continue;
        };
        let offsets = [
            view.fallback_anchor,
            view.fallback_head,
            view.fallback_scroll_anchor,
        ]
        .map(|offset| offset.max(0) as usize);
        let Some(encoded) = hub.encode_positions(Path::new(path), &offsets) else {
            continue;
        };
        let [anchor, head, scroll] =
            <[Option<Vec<u8>>; 3]>::try_from(encoded).expect("three positions");
        view.cursor_anchor = anchor.unwrap_or_default();
        view.cursor_head = head.unwrap_or_default();
        view.scroll_anchor = scroll.unwrap_or_default();
    }
}

#[tauri::command]
pub async fn load_ui_document_view(
    core: State<'_, Arc<Core>>,
    workspace_id: Uuid,
    window_id: String,
    document_id: Uuid,
    pane_id: String,
) -> Result<Option<super::models::LoadedViewState>, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || service.load_view(workspace_id, &window_id, document_id, &pane_id)).await
}

#[tauri::command]
pub async fn rename_ui_document(
    core: State<'_, Arc<Core>>,
    document_id: Uuid,
    relative_path: String,
) -> Result<(), UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let relative_path = normalize_relative(&relative_path)?;
        service.rename_document(document_id, &relative_path)
    })
    .await
}

#[tauri::command]
pub async fn mark_ui_document_missing(
    core: State<'_, Arc<Core>>,
    document_id: Uuid,
    now_ms: i64,
) -> Result<(), UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || service.mark_document_missing(document_id, now_ms)).await
}

#[tauri::command]
pub async fn cleanup_ui_state(
    core: State<'_, Arc<Core>>,
    retention_days: u32,
    now_ms: i64,
) -> Result<usize, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || service.cleanup(retention_days, now_ms)).await
}

#[tauri::command]
pub async fn reset_ui_state(core: State<'_, Arc<Core>>, now_ms: i64) -> Result<(), UiStateError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let roots = core.access.roots();
        core.ui_state.reset(now_ms)?;
        for root in roots {
            core.ui_state
                .resolve_workspace(&root.to_string_lossy(), now_ms)?;
        }
        Ok(())
    })
    .await
}

fn validate_view_path(access: &PathGrants, path: &mut Option<String>) -> Result<(), UiStateError> {
    if let Some(path) = path {
        *path = access.check(path)?.to_string_lossy().into_owned();
    }
    Ok(())
}

#[tauri::command]
pub async fn load_ui_reader_state(
    core: State<'_, Arc<Core>>,
    workspace_id: Uuid,
    book_file: String,
) -> Result<Option<LoadedReaderState>, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let book_file = normalize_relative(&book_file)?;
        service.load_reader_state(workspace_id, &book_file)
    })
    .await
}

#[tauri::command]
pub async fn save_ui_reader_state(
    core: State<'_, Arc<Core>>,
    input: SaveReaderStateInput,
) -> Result<(), UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let book_file = normalize_relative(&input.book_file)?;
        service.save_reader_state(&SaveReaderStateInput { book_file, ..input })
    })
    .await
}

#[tauri::command]
pub async fn load_ui_base_view(
    core: State<'_, Arc<Core>>,
    workspace_id: Uuid,
    base_file: String,
) -> Result<Option<i64>, UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let base_file = normalize_relative(&base_file)?;
        service.load_base_view(workspace_id, &base_file)
    })
    .await
}

#[tauri::command]
pub async fn save_ui_base_view(
    core: State<'_, Arc<Core>>,
    input: SaveBaseViewStateInput,
) -> Result<(), UiStateError> {
    let service = core.ui_state.clone();
    run_blocking(move || {
        let base_file = normalize_relative(&input.base_file)?;
        service.save_base_view(&SaveBaseViewStateInput { base_file, ..input })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::validate_view_path;
    use obsidium_core::access::PathGrants;
    use std::fs;

    #[test]
    fn view_paths_must_be_inside_a_granted_root() {
        let base = std::env::temp_dir().join(format!("obsidium-view-path-{}", std::process::id()));
        let root = base.join("workspace");
        let outside = base.join("outside");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let grants = PathGrants::new();
        assert!(grants.grant_root(&root));
        let mut path = Some(outside.join("note.md").to_string_lossy().into_owned());

        assert!(validate_view_path(&grants, &mut path).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
