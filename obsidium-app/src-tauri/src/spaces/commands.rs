use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::error::FileCommandError;
use crate::settings::models::Space;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_spaces(core: State<'_, Arc<Core>>) -> Result<Vec<Space>, String> {
    Ok(core.settings.get_config().spaces.spaces)
}

#[tauri::command]
pub fn save_space(core: State<'_, Arc<Core>>, space: Space) -> Result<Space, String> {
    let settings = &core.settings;
    let mut config = settings.get_config();
    let saved = crate::spaces::save_space(&mut config.spaces, space)?;
    settings.update_config(config)?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_space(core: State<'_, Arc<Core>>, id: String) -> Result<Vec<Space>, String> {
    let settings = &core.settings;
    let mut config = settings.get_config();
    crate::spaces::delete_space(&mut config.spaces, &id)?;
    let remaining = config.spaces.spaces.clone();
    settings.update_config(config)?;
    Ok(remaining)
}

#[tauri::command]
pub async fn list_space_files(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    space_id: Option<String>,
) -> Result<Vec<String>, FileCommandError> {
    let space = match space_id {
        Some(id) => core
            .settings
            .get_config()
            .spaces
            .spaces
            .into_iter()
            .find(|space| space.id == id)
            .ok_or_else(|| FileCommandError::Io {
                message: format!("пространство не найдено: {id}"),
            })?,
        None => Space::default(),
    };

    let core = Arc::clone(&core);
    run_blocking(move || {
        let root = core.access.check_root(&workspace_path)?;
        crate::spaces::list_space_files(&root, &space)
    })
    .await
}
