use crate::blocking::run_blocking;
use crate::search::error::SearchError;
use crate::search::service::SearchService;
use tauri::State;

const MAX_PATHS: usize = 512;

#[tauri::command]
pub async fn get_graph_snapshot(
    service: State<'_, SearchService>,
    workspace_path: String,
) -> Result<tauri::ipc::Response, SearchError> {
    let service = service.inner().clone();
    let bytes = run_blocking(move || {
        service
            .render_graph(&workspace_path)
            .map(|snapshot| snapshot.as_ref().clone())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_graph_paths(
    service: State<'_, SearchService>,
    epoch_low: u32,
    epoch_high: u32,
    indices: Vec<u32>,
) -> Result<Vec<String>, SearchError> {
    if indices.len() > MAX_PATHS {
        return Err(SearchError::InvalidWorkspace {
            message: format!("Запрошено больше {MAX_PATHS} путей за раз"),
        });
    }
    let service = service.inner().clone();
    let epoch = u64::from(epoch_low) | (u64::from(epoch_high) << 32);
    run_blocking(move || service.graph_paths(epoch, &indices)).await
}
