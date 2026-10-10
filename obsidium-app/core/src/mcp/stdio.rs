use super::{protocol, tools};
use crate::app_core::{Core, EventSink};
use crate::settings::SettingsManager;
use crate::ui_state::UiStateService;
use serde_json::Value;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

struct Endpoint {
    port: u16,
    token: String,
}

pub fn run_stdio_core(core: Arc<Core>) -> i32 {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let message = line.trim();
        if message.is_empty() {
            continue;
        }
        let call = |name: &str, arguments: &Value| tools::call(&core, name, arguments);
        if let Some(response) = protocol::handle_message(message, &call) {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                core.shutdown();
                return 1;
            }
        }
    }
    core.shutdown();
    0
}

pub fn open_headless_core(
    app_identifier: &str,
    runtime_name: &str,
    workspace: Option<&Path>,
) -> Result<Arc<Core>, String> {
    let main_data = default_app_data_dir(app_identifier)
        .ok_or_else(|| "не удалось определить каталог данных Obsidium".to_owned())?;
    let runtime_data = main_data.join(runtime_name);
    std::fs::create_dir_all(&runtime_data).map_err(|error| error.to_string())?;

    let events: Arc<dyn EventSink> = Arc::new(|_| {});
    let core = Core::open(&runtime_data, events);

    let config = SettingsManager::new(&main_data).get_config();
    core.settings.update_config(config)?;

    let known = UiStateService::open(&main_data.join("ui-state.sqlite3"))
        .list_workspaces()
        .unwrap_or_default();
    for item in &known {
        let _ = core
            .ui_state
            .resolve_workspace(&item.path, item.last_seen_ms);
    }

    let selected = workspace.map(Path::to_path_buf).or_else(|| {
        known
            .iter()
            .max_by_key(|item| item.last_seen_ms)
            .map(|item| PathBuf::from(&item.path))
    });
    if let Some(path) = selected {
        if !path.is_dir() {
            return Err(format!("база знаний не найдена: {}", path.display()));
        }
        let root = crate::search::paths::canonical_path(&path);
        core.watcher.watch(&root)?;
        let path = root.to_string_lossy().into_owned();
        core.ui_state
            .resolve_workspace(&path, now_ms())
            .map_err(|error| format!("{error:?}"))?;
        core.search
            .prepare(&path)
            .map_err(|error| error.to_string())?;
    }
    Ok(core)
}

pub fn run_stdio_headless(app_identifier: &str) -> i32 {
    let workspace = std::env::var_os("OBSIDIUM_WORKSPACE").map(PathBuf::from);
    match open_headless_core(app_identifier, "headless-mcp", workspace.as_deref()) {
        Ok(core) => run_stdio_core(core),
        Err(error) => {
            eprintln!("[obsidium:mcp] {error}");
            2
        }
    }
}

pub fn run_stdio_bridge(app_identifier: &str) -> i32 {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let message = line.trim();
        if message.is_empty() {
            continue;
        }
        if let Some(response) = forward(message, app_identifier) {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                return 1;
            }
        }
    }
    0
}

fn forward(message: &str, app_identifier: &str) -> Option<String> {
    let Some(endpoint) = endpoint(app_identifier) else {
        return transport_error(message, "не найдены настройки MCP");
    };
    let response = ureq::post(&format!("http://127.0.0.1:{}/mcp", endpoint.port))
        .set("Authorization", &format!("Bearer {}", endpoint.token))
        .set("Content-Type", "application/json")
        .send_string(message);

    match response {
        Ok(response) if response.status() == 202 => None,
        Ok(response) => response
            .into_string()
            .ok()
            .filter(|body| !body.trim().is_empty()),
        Err(ureq::Error::Status(status, _)) => {
            transport_error(message, &format!("сервер ответил {status}"))
        }
        Err(error) => transport_error(
            message,
            &format!("приложение Obsidium не запущено или MCP выключен ({error})"),
        ),
    }
}

fn transport_error(message: &str, reason: &str) -> Option<String> {
    let id = serde_json::from_str::<Value>(message)
        .ok()
        .and_then(|value| value.get("id").cloned())
        .filter(|id| !id.is_null())?;
    Some(
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": format!("Obsidium MCP: {reason}") },
        })
        .to_string(),
    )
}

fn endpoint(app_identifier: &str) -> Option<Endpoint> {
    let from_env = (
        std::env::var("AQUILUM_MCP_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok()),
        std::env::var("AQUILUM_MCP_TOKEN").ok(),
    );
    if let (Some(port), Some(token)) = from_env {
        return Some(Endpoint { port, token });
    }

    let settings = std::fs::read_to_string(settings_path(app_identifier)?).ok()?;
    let mcp = serde_json::from_str::<Value>(&settings)
        .ok()?
        .get("mcp")?
        .clone();
    Some(Endpoint {
        port: u16::try_from(mcp.get("port").and_then(Value::as_u64)?).ok()?,
        token: mcp.get("token").and_then(Value::as_str)?.to_owned(),
    })
}

fn settings_path(app_identifier: &str) -> Option<PathBuf> {
    Some(default_app_data_dir(app_identifier)?.join("settings.json"))
}

pub fn default_app_data_dir(app_identifier: &str) -> Option<PathBuf> {
    std::env::var_os("OBSIDIUM_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| data_directory().map(|base| base.join(app_identifier)))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn data_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::transport_error;
    use serde_json::Value;

    #[test]
    fn transport_errors_use_the_obsidium_name() {
        let response =
            transport_error(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#, "причина").unwrap();
        let parsed = serde_json::from_str::<Value>(&response).unwrap();
        let message = parsed["error"]["message"].as_str().unwrap();
        assert!(message.starts_with("Obsidium MCP:"), "{message}");
        assert!(!message.to_lowercase().contains("aquilum"), "{message}");
    }
}
