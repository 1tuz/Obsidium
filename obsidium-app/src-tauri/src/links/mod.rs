pub use aquilum_core::links::*;

use crate::app_core::Core;
use crate::mcp::vault::Vault;
use crate::search::paths::{canonical_workspace, same_path};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedLinkResult {
    pub changed: bool,
    pub path: String,
}

#[tauri::command]
pub async fn apply_suggested_link(
    core: State<'_, Arc<Core>>,
    workspace: String,
    source: String,
    target: String,
) -> Result<SuggestedLinkResult, String> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        let vault = workspace_vault(&core, &workspace)?;
        let plan = plan_link(&core, &vault, &source, &target, LinkKind::Wiki)?;
        let applied = apply_link(&core, &vault, &plan)?;
        Ok(SuggestedLinkResult {
            changed: applied.changed,
            path: vault.relative(&plan.source),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn workspace_vault(core: &Core, workspace: &str) -> Result<Vault, String> {
    let root = canonical_workspace(workspace).map_err(|error| error.to_string())?;
    let visible = core
        .search
        .active_root()
        .is_some_and(|active| same_path(&active, &root));
    Ok(Vault { root, visible })
}
