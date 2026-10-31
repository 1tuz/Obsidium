pub use obsidium_core::links::*;

use crate::app_core::Core;
use crate::files::error::FileCommandError;
use crate::mcp::vault::Vault;
use crate::search::paths::same_path;
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
) -> Result<SuggestedLinkResult, FileCommandError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        let vault = workspace_vault(&core, &workspace)?;
        let plan = plan_link(&core, &vault, &source, &target, LinkKind::Wiki)
            .map_err(|message| FileCommandError::Io { message })?;
        let applied = apply_link(&core, &vault, &plan, None)
            .map_err(|message| FileCommandError::Io { message })?;
        Ok(SuggestedLinkResult {
            changed: applied.changed,
            path: vault.relative(&plan.source),
        })
    })
    .await
    .map_err(|error| FileCommandError::Task {
        message: error.to_string(),
    })?
}

fn workspace_vault(core: &Core, workspace: &str) -> Result<Vault, FileCommandError> {
    let root = core.access.check_root(workspace)?;
    let visible = core
        .search
        .active_root()
        .is_some_and(|active| same_path(&active, &root));
    Ok(Vault { root, visible })
}

#[cfg(test)]
mod tests {
    use super::workspace_vault;
    use obsidium_core::app_core::{Core, CoreEvent, EventSink};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("obsidium-links-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        fs::canonicalize(path).unwrap()
    }

    #[test]
    fn workspace_vault_rejects_unknown_roots() {
        let app_data = scratch("app-data");
        let known = scratch("known");
        let unknown = scratch("unknown");
        let events: Arc<dyn EventSink> = Arc::new(|_: CoreEvent| {});
        let core = Core::open(&app_data, events);
        assert!(core.access.grant_root(&known));

        assert!(workspace_vault(&core, &known.to_string_lossy()).is_ok());
        assert!(workspace_vault(&core, &unknown.to_string_lossy()).is_err());

        core.shutdown();
        let _ = fs::remove_dir_all(app_data);
        let _ = fs::remove_dir_all(known);
        let _ = fs::remove_dir_all(unknown);
    }
}
