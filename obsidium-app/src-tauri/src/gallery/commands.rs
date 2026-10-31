use crate::app_core::Core;
use crate::blocking::run_blocking;
use obsidium_core::files::error::FileCommandError;
use obsidium_core::files::gallery::{list_images, ImageEntry};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn list_workspace_images(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<Vec<ImageEntry>, FileCommandError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        Ok(list_images(&root))
    })
    .await
}
