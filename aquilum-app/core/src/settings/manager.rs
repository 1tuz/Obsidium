use crate::files::document::write_file_atomic_impl;
use crate::settings::models::AppConfig;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub struct SettingsManager {
    config_path: PathBuf,
    current_config: RwLock<AppConfig>,
}

impl SettingsManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let config_path = app_data_dir.join("settings.json");
        let current_config = Self::load_or_default(&config_path);
        Self {
            config_path,
            current_config: RwLock::new(current_config),
        }
    }

    fn load_or_default(path: &Path) -> AppConfig {
        match fs::read_to_string(path) {
            Ok(content) => {
                match serde_json::from_str::<AppConfig>(&content) {
                    Ok(mut config) => {
                        if config.ui.accent_mode == "legacy"
                            || (config.ui.accent_mode == "custom"
                                && is_legacy_default_accent(&config.ui.primary_color))
                        {
                            config.ui.accent_mode =
                                if is_legacy_default_accent(&config.ui.primary_color) {
                                    "palette"
                                } else {
                                    "custom"
                                }
                                .to_string();
                            if let Err(error) = write_config(path, &config) {
                                eprintln!("[aquilum:settings] не удалось сохранить миграцию accent: {error}");
                            }
                        }
                        return config;
                    }
                    Err(error) => set_aside_unreadable(path, &error),
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => eprintln!(
                "[aquilum:settings] не удалось прочитать {}: {error}",
                path.display()
            ),
        }
        let default_config = AppConfig::default();
        if let Err(error) = write_config(path, &default_config) {
            eprintln!("[aquilum:settings] не удалось записать настройки по умолчанию: {error}");
        }
        default_config
    }

    pub fn get_config(&self) -> AppConfig {
        self.current_config.read().unwrap().clone()
    }

    pub fn update_config(&self, new_config: AppConfig) -> Result<(), String> {
        write_config(&self.config_path, &new_config)?;
        *self.current_config.write().unwrap() = new_config;
        Ok(())
    }
}

fn is_legacy_default_accent(color: &str) -> bool {
    color.eq_ignore_ascii_case("#1471eb") || color.eq_ignore_ascii_case("#d357fe")
}

fn write_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    write_file_atomic_impl(path, &json, None)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn set_aside_unreadable(path: &Path, error: &serde_json::Error) {
    let backup = path.with_extension("json.unreadable");
    eprintln!(
        "[aquilum:settings] {} не разобран ({error}), копия сохранена в {}",
        path.display(),
        backup.display()
    );
    if let Err(copy_error) = fs::copy(path, &backup) {
        eprintln!("[aquilum:settings] не удалось сохранить копию: {copy_error}");
    }
}

#[cfg(test)]
mod tests {
    use super::SettingsManager;

    #[test]
    fn partial_settings_keep_present_values_and_fill_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"mcp":{"token":"secret"},"editor":{"fontFamily":"iA Writer Quattro"}}"#,
        )
        .unwrap();

        let config = SettingsManager::new(dir.path()).get_config();

        assert_eq!(config.mcp.token, "secret");
        assert_eq!(config.mcp.port, 8787);
        assert_eq!(config.editor.font.font_family, "iA Writer Quattro");
        assert_eq!(config.editor.save_debounce_ms, 1000);
        assert!(config.analysis.enable_bm25f);
        assert!(config.builtins.editing_toolbar);
        assert!(config.builtins.kanban);
    }

    #[test]
    fn builtin_plugin_settings_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SettingsManager::new(dir.path());
        let mut config = manager.get_config();
        assert!(config.builtins.editing_toolbar);
        assert!(config.builtins.kanban);
        assert_eq!(config.builtins.toolbar_position, "top");
        config.builtins.editing_toolbar = false;
        config.builtins.toolbar_position = "selection".to_owned();
        manager.update_config(config).unwrap();
        let stored = SettingsManager::new(dir.path()).get_config();
        assert!(!stored.builtins.editing_toolbar);
        assert_eq!(stored.builtins.toolbar_position, "selection");
    }

    #[test]
    fn unreadable_settings_are_set_aside_before_defaults_are_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ broken").unwrap();

        SettingsManager::new(dir.path());

        let backup = std::fs::read_to_string(dir.path().join("settings.json.unreadable")).unwrap();
        assert_eq!(backup, "{ broken");
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"mcp\""));
    }

    #[test]
    fn legacy_theme_setting_migrates_to_appearance() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"ui":{"theme":"dark"}}"#,
        )
        .unwrap();

        let manager = SettingsManager::new(dir.path());
        let config = manager.get_config();

        assert_eq!(config.ui.appearance, "dark");
        assert_eq!(config.ui.palette, "obsidium");
        assert_eq!(config.ui.motion, "off");
        assert!(config.ui.enabled_snippets.is_empty());
        manager.update_config(config).unwrap();
        let stored = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(stored.contains("\"appearance\": \"dark\""));
        assert!(!stored.contains("\"theme\""));
    }

    #[test]
    fn explicit_motion_preference_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), r#"{"ui":{"motion":"on"}}"#).unwrap();

        let config = SettingsManager::new(dir.path()).get_config();

        assert_eq!(config.ui.motion, "on");
    }

    #[test]
    fn legacy_custom_accent_is_migrated_without_losing_its_color() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r##"{"ui":{"primaryColor":"#ff00aa"}}"##,
        )
        .unwrap();

        let manager = SettingsManager::new(dir.path());
        let config = manager.get_config();

        assert_eq!(config.ui.accent_mode, "custom");
        assert_eq!(config.ui.primary_color, "#ff00aa");
        let stored = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(stored.contains("\"accentMode\": \"custom\""));
    }

    #[test]
    fn migrated_default_accent_uses_palette_and_keeps_the_legacy_color() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r##"{"ui":{"accentMode":"custom","primaryColor":"#D357FE"}}"##,
        )
        .unwrap();

        let config = SettingsManager::new(dir.path()).get_config();

        assert_eq!(config.ui.accent_mode, "palette");
        assert_eq!(config.ui.primary_color, "#D357FE");
    }

    #[test]
    fn legacy_enabled_snippet_names_are_preserved_under_a_migration_key() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"ui":{"enabledSnippets":["foo.css"]}}"#,
        )
        .unwrap();

        let config = SettingsManager::new(dir.path()).get_config();

        assert_eq!(config.ui.enabled_snippets["__legacy__"], ["foo.css"]);
    }
}
