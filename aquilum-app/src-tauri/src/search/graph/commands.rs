use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::search::error::SearchError;
use aquilum_core::search::graph::{
    layout::{Mode, Options},
    service::{GraphModifiedDateDelta, GraphNodeFilter, GraphTopologyDelta},
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

const MAX_PATHS: usize = 512;

#[derive(Deserialize)]
pub struct GraphPositionUpdate {
    index: u32,
    x: f32,
    y: f32,
}

#[tauri::command]
pub async fn get_graph_snapshot(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    layout_mode: String,
    attraction: f64,
    repulsion: f64,
) -> Result<tauri::ipc::Response, SearchError> {
    let options = layout_options(&layout_mode, attraction, repulsion)?;
    let service = core.search.clone();
    let bytes = run_blocking(move || {
        service
            .render_graph(&workspace_path, options)
            .map(|snapshot| snapshot.as_ref().clone())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_graph_modified_date_delta(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    base_epoch_low: u32,
    base_epoch_high: u32,
    since_revision: u64,
    layout_mode: String,
    attraction: f64,
    repulsion: f64,
) -> Result<Option<GraphModifiedDateDelta>, SearchError> {
    let options = layout_options(&layout_mode, attraction, repulsion)?;
    let service = core.search.clone();
    let base_epoch = u64::from(base_epoch_low) | (u64::from(base_epoch_high) << 32);
    run_blocking(move || {
        service.graph_modified_date_delta(&workspace_path, base_epoch, since_revision, options)
    })
    .await
}

#[tauri::command]
pub async fn get_graph_topology_delta(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    base_epoch_low: u32,
    base_epoch_high: u32,
    since_revision: u64,
    layout_mode: String,
    attraction: f64,
    repulsion: f64,
) -> Result<Option<GraphTopologyDelta>, SearchError> {
    let options = layout_options(&layout_mode, attraction, repulsion)?;
    let service = core.search.clone();
    let base_epoch = u64::from(base_epoch_low) | (u64::from(base_epoch_high) << 32);
    run_blocking(move || {
        service.graph_topology_delta(&workspace_path, base_epoch, since_revision, options)
    })
    .await
}

#[tauri::command]
pub async fn get_graph_timeline_range(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<aquilum_core::search::graph::timeline::TimelineRange, SearchError> {
    let service = core.search.clone();
    run_blocking(move || service.graph_timeline_range(&workspace_path)).await
}

#[tauri::command]
pub async fn get_graph_timeline_events(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    after_event: i64,
    limit: usize,
) -> Result<Vec<aquilum_core::search::graph::timeline::TimelineEvent>, SearchError> {
    let service = core.search.clone();
    run_blocking(move || service.graph_timeline_events(&workspace_path, after_event, limit)).await
}

#[tauri::command]
pub async fn get_graph_timeline_snapshot(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    event_id: i64,
    layout_mode: String,
    attraction: f64,
    repulsion: f64,
) -> Result<tauri::ipc::Response, SearchError> {
    let options = layout_options(&layout_mode, attraction, repulsion)?;
    let service = core.search.clone();
    let bytes = run_blocking(move || {
        service
            .render_graph_at_event(&workspace_path, event_id, options)
            .map(|snapshot| snapshot.as_ref().clone())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_graph_paths(
    core: State<'_, Arc<Core>>,
    epoch_low: u32,
    epoch_high: u32,
    indices: Vec<u32>,
) -> Result<Vec<String>, SearchError> {
    if indices.len() > MAX_PATHS {
        return Err(SearchError::InvalidWorkspace {
            message: format!("Запрошено больше {MAX_PATHS} путей за раз"),
        });
    }
    let service = core.search.clone();
    let epoch = u64::from(epoch_low) | (u64::from(epoch_high) << 32);
    run_blocking(move || service.graph_paths(epoch, &indices)).await
}

#[tauri::command]
pub async fn set_graph_positions(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    epoch_low: u32,
    epoch_high: u32,
    layout_mode: String,
    attraction: f64,
    repulsion: f64,
    updates: Vec<GraphPositionUpdate>,
) -> Result<(), SearchError> {
    let options = layout_options(&layout_mode, attraction, repulsion)?;
    if updates.len() > MAX_PATHS {
        return Err(SearchError::InvalidWorkspace {
            message: format!("Запрошено больше {MAX_PATHS} узлов за раз"),
        });
    }
    let service = core.search.clone();
    let epoch = u64::from(epoch_low) | (u64::from(epoch_high) << 32);
    let updates = updates
        .into_iter()
        .map(|update| (update.index, update.x, update.y))
        .collect::<Vec<_>>();
    run_blocking(move || service.save_graph_positions(&workspace_path, epoch, options, &updates))
        .await
}

fn layout_options(mode: &str, attraction: f64, repulsion: f64) -> Result<Options, SearchError> {
    let mode = Mode::parse(mode).ok_or_else(|| SearchError::InvalidWorkspace {
        message: "Неизвестный режим раскладки графа".to_owned(),
    })?;
    Ok(Options {
        mode,
        attraction,
        repulsion,
    })
}

#[tauri::command]
pub async fn get_graph_filter_nodes(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    epoch_low: u32,
    epoch_high: u32,
    folder: Option<String>,
    tag: Option<String>,
    property_key: Option<String>,
    property_value: Option<String>,
) -> Result<Vec<u32>, SearchError> {
    let service = core.search.clone();
    let epoch = u64::from(epoch_low) | (u64::from(epoch_high) << 32);
    run_blocking(move || {
        service.graph_filter_nodes(
            &workspace_path,
            epoch,
            GraphNodeFilter {
                folder,
                tag,
                property_key,
                property_value,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn get_graph_cluster_ids(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    epoch_low: u32,
    epoch_high: u32,
    resolution: f64,
) -> Result<Vec<u32>, SearchError> {
    let service = core.search.clone();
    let epoch = u64::from(epoch_low) | (u64::from(epoch_high) << 32);
    run_blocking(move || service.graph_cluster_ids(&workspace_path, epoch, resolution)).await
}
