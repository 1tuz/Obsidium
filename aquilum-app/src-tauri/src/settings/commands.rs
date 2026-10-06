use crate::settings::manager::SettingsManager;
use crate::settings::models::AppConfig;
use tauri::State;

#[tauri::command]
pub fn get_settings(settings: State<'_, SettingsManager>) -> Result<AppConfig, String> {
    Ok(settings.get_config())
}

#[tauri::command]
pub fn update_settings(
    new_config: AppConfig,
    settings: State<'_, SettingsManager>,
) -> Result<(), String> {
    settings.update_config(new_config)
}
