use crate::blocking::run_blocking;
use obsidium_core::files::error::FileCommandError;
use obsidium_core::files::gallery::{list_images, ImageEntry};
use std::path::Path;

#[tauri::command]
pub async fn list_workspace_images(
    workspace_path: String,
) -> Result<Vec<ImageEntry>, FileCommandError> {
    run_blocking(move || Ok(list_images(Path::new(&workspace_path)))).await
}
