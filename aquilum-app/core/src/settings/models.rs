use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Bm25fParams {
    pub k1: f32,
    pub k3: f32,
    pub b_title: f32,
    pub b_body: f32,
    pub title_weight: f32,
}

impl Default for Bm25fParams {
    fn default() -> Self {
        Self {
            k1: 1.2,
            k3: 8.0,
            b_title: 0.3,
            b_body: 0.75,
            title_weight: 2.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AnalysisSettings {
    pub enable_bm25f: bool,
    pub enable_adamic_adar: bool,
    pub enable_wikixiv: bool,
    pub bm25f_params: Bm25fParams,
}

impl Default for AnalysisSettings {
    fn default() -> Self {
        Self {
            enable_bm25f: true,
            enable_adamic_adar: true,
            enable_wikixiv: true,
            bm25f_params: Bm25fParams::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchIndexSettings {
    pub candidate_pool_size: usize,
    pub max_query_terms: usize,
}

impl Default for SearchIndexSettings {
    fn default() -> Self {
        Self {
            candidate_pool_size: 256,
            max_query_terms: 64,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FontSettings {
    pub font_family: String,
    pub font_weight: u32,
    pub font_size_base: u32,
}

impl Default for FontSettings {
    fn default() -> Self {
        UiSettings::default().font
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorSettings {
    pub save_debounce_ms: u32,
    pub line_height: f32,
    pub max_width_ch: u32,
    pub smart_dashes: bool,
    pub list_callouts: bool,
    pub auto_link_title: bool,
    pub live_tabs: u32,
    pub link_suggest: bool,
    pub link_suggest_min_chars: u32,
    #[serde(flatten)]
    pub font: FontSettings,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            save_debounce_ms: 1000,
            line_height: 1.8,
            max_width_ch: 65,
            smart_dashes: true,
            list_callouts: true,
            auto_link_title: true,
            live_tabs: 3,
            link_suggest: true,
            link_suggest_min_chars: 2,
            font: FontSettings {
                font_family: "iA Writer Mono".to_string(),
                font_weight: 400,
                font_size_base: 16,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReaderSettings {
    pub line_height: f32,
    pub max_width_ch: u32,
    pub margin_px: u32,
    pub justify: bool,
    pub hyphenate: bool,
    pub flow: String,
    #[serde(flatten)]
    pub font: FontSettings,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            line_height: 1.6,
            max_width_ch: 65,
            margin_px: 48,
            justify: true,
            hyphenate: true,
            flow: "paginated".to_string(),
            font: FontSettings {
                font_family: "iA Writer Quattro".to_string(),
                font_weight: 400,
                font_size_base: 18,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiSettings {
    #[serde(alias = "theme")]
    pub appearance: String,
    pub palette: String,
    #[serde(default = "legacy_accent_mode")]
    pub accent_mode: String,
    pub motion: String,
    #[serde(deserialize_with = "deserialize_enabled_snippets")]
    pub enabled_snippets: HashMap<String, Vec<String>>,
    pub language: String,
    pub primary_color: String,
    #[serde(flatten)]
    pub font: FontSettings,
}

fn legacy_accent_mode() -> String {
    "legacy".to_string()
}

fn deserialize_enabled_snippets<'de, D>(
    deserializer: D,
) -> Result<HashMap<String, Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StoredSnippets {
        Scoped(HashMap<String, Vec<String>>),
        Legacy(Vec<String>),
    }

    match StoredSnippets::deserialize(deserializer)? {
        StoredSnippets::Scoped(snippets) => Ok(snippets),
        StoredSnippets::Legacy(names) => Ok(HashMap::from([("__legacy__".to_string(), names)])),
    }
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            appearance: "system".to_string(),
            palette: "obsidium".to_string(),
            accent_mode: "palette".to_string(),
            motion: "off".to_string(),
            enabled_snippets: HashMap::new(),
            language: String::new(),
            primary_color: "#1471eb".to_string(),
            font: FontSettings {
                font_family: "Inter".to_string(),
                font_weight: 400,
                font_size_base: 14,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrashSettings {
    pub retention_days: u32,
}

impl Default for TrashSettings {
    fn default() -> Self {
        Self { retention_days: 30 }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistorySettings {
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct McpSettings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub allow_write: bool,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8787,
            token: String::new(),
            allow_write: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BuiltinPluginSettings {
    pub editing_toolbar: bool,
    pub kanban: bool,
    pub toolbar_position: String,
}

impl Default for BuiltinPluginSettings {
    fn default() -> Self {
        Self {
            editing_toolbar: true,
            kanban: true,
            toolbar_position: "top".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub builtins: BuiltinPluginSettings,
    pub analysis: AnalysisSettings,
    pub mcp: McpSettings,
    pub trash: TrashSettings,
    pub history: HistorySettings,
    pub search: SearchIndexSettings,
    pub editor: EditorSettings,
    pub reader: ReaderSettings,
    pub ui: UiSettings,
    pub templates: TemplateSettings,
    pub files: FilesSettings,
    pub updates: UpdateSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateSettings {
    pub folder: String,
}

impl Default for TemplateSettings {
    fn default() -> Self {
        Self {
            folder: "Templates".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FilesSettings {
    pub folder: String,
}

impl Default for FilesSettings {
    fn default() -> Self {
        Self {
            folder: "Files".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    pub auto: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self { auto: true }
    }
}
