use atomic_write_file::AtomicWriteFile;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;
use toml_edit::{value, Array, DocumentMut, Item, Table};

const SERVER_NAME: &str = "obsidium";
const COMMAND: &str = "obsidium";
const ARGS: [&str; 4] = ["mcp", "stdio", "--workspace", "."];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectWorkspaceReport {
    pub workspace: String,
    pub claude: ConfigFileStatus,
    pub codex: ConfigFileStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigFileStatus {
    Created,
    Unchanged,
}

pub fn connect_workspace(path: &Path) -> Result<ConnectWorkspaceReport, String> {
    let workspace =
        fs::canonicalize(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !workspace.is_dir() {
        return Err(format!("не папка: {}", workspace.display()));
    }

    let claude_path = workspace.join(".mcp.json");
    let codex_dir = workspace.join(".codex");
    let codex_path = codex_dir.join("config.toml");
    reject_symlink(&claude_path)?;
    reject_symlink(&codex_dir)?;
    reject_symlink(&codex_path)?;

    let claude_content = prepare_claude_config(&claude_path)?;
    let codex_content = prepare_codex_config(&codex_path)?;

    if let Some(content) = claude_content.as_deref() {
        write_atomic(&claude_path, content)?;
    }
    if let Some(content) = codex_content.as_deref() {
        fs::create_dir_all(&codex_dir)
            .map_err(|error| format!("{}: {error}", codex_dir.display()))?;
        write_atomic(&codex_path, content)?;
    }

    Ok(ConnectWorkspaceReport {
        workspace: workspace.to_string_lossy().into_owned(),
        claude: status(claude_content),
        codex: status(codex_content),
    })
}

fn prepare_claude_config(path: &Path) -> Result<Option<String>, String> {
    let mut config = read_optional(path)?
        .map(|source| {
            serde_json::from_str::<Value>(&source)
                .map_err(|error| format!("{}: {error}", path.display()))
        })
        .transpose()?
        .unwrap_or_else(|| json!({}));
    let root = config
        .as_object_mut()
        .ok_or_else(|| format!("{}: ожидается JSON-объект", path.display()))?;
    let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| format!("{}: mcpServers должен быть объектом", path.display()))?;

    if let Some(existing) = servers.get(SERVER_NAME) {
        return if claude_server_matches(existing) {
            Ok(None)
        } else {
            Err(format!(
                "{}: запись MCP-сервера obsidium уже занята",
                path.display()
            ))
        };
    }

    servers.insert(SERVER_NAME.to_owned(), claude_server());
    let mut source = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    source.push('\n');
    Ok(Some(source))
}

fn prepare_codex_config(path: &Path) -> Result<Option<String>, String> {
    let source = read_optional(path)?.unwrap_or_default();
    let mut config = source
        .parse::<DocumentMut>()
        .map_err(|error| format!("{}: {error}", path.display()))?;
    let servers = config
        .as_table_mut()
        .entry("mcp_servers")
        .or_insert_with(|| Item::Table(Table::new()))
        .as_table_like_mut()
        .ok_or_else(|| format!("{}: mcp_servers должен быть таблицей", path.display()))?;

    if let Some(existing) = servers.get(SERVER_NAME) {
        return if codex_server_matches(existing) {
            Ok(None)
        } else {
            Err(format!(
                "{}: запись MCP-сервера obsidium уже занята",
                path.display()
            ))
        };
    }

    let mut server = Table::new();
    server["command"] = value(COMMAND);
    let mut args = Array::new();
    for argument in ARGS {
        args.push(argument);
    }
    server["args"] = value(args);
    servers.insert(SERVER_NAME, Item::Table(server));
    Ok(Some(config.to_string()))
}

fn claude_server() -> Value {
    json!({
        "command": COMMAND,
        "args": ARGS,
    })
}

fn claude_server_matches(server: &Value) -> bool {
    server.get("command").and_then(Value::as_str) == Some(COMMAND)
        && server.get("args") == Some(&json!(ARGS))
}

fn codex_server_matches(server: &Item) -> bool {
    let Some(server) = server.as_table_like() else {
        return false;
    };
    let args = server.get("args").and_then(Item::as_array);
    server.get("command").and_then(Item::as_str) == Some(COMMAND)
        && args.is_some_and(|args| {
            args.len() == ARGS.len()
                && args
                    .iter()
                    .zip(ARGS)
                    .all(|(value, expected)| value.as_str() == Some(expected))
        })
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(source) => Ok(Some(source)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "символическая ссылка запрещена: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let mut file =
        AtomicWriteFile::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("{}: {error}", path.display()))?;
    file.commit()
        .map_err(|error| format!("{}: {error}", path.display()))
}

fn status(content: Option<String>) -> ConfigFileStatus {
    if content.is_some() {
        ConfigFileStatus::Created
    } else {
        ConfigFileStatus::Unchanged
    }
}

#[cfg(test)]
mod tests {
    use super::{connect_workspace, ConfigFileStatus};
    use serde_json::Value;
    use std::fs;
    use tempfile::tempdir;
    use toml_edit::DocumentMut;

    #[test]
    fn adds_both_agent_configs_without_replacing_existing_settings() {
        let workspace = tempdir().unwrap();
        fs::write(
            workspace.path().join(".mcp.json"),
            r#"{"custom":true,"mcpServers":{"other":{"command":"other"}}}"#,
        )
        .unwrap();
        fs::create_dir(workspace.path().join(".codex")).unwrap();
        fs::write(
            workspace.path().join(".codex/config.toml"),
            "model = \"gpt-6\"\n\n[mcp_servers.other]\ncommand = \"other\"\n",
        )
        .unwrap();

        let report = connect_workspace(workspace.path()).unwrap();
        let claude: Value =
            serde_json::from_str(&fs::read_to_string(workspace.path().join(".mcp.json")).unwrap())
                .unwrap();
        let codex = fs::read_to_string(workspace.path().join(".codex/config.toml")).unwrap();
        let codex: DocumentMut = codex.parse().unwrap();

        assert_eq!(report.claude, ConfigFileStatus::Created);
        assert_eq!(report.codex, ConfigFileStatus::Created);
        assert_eq!(claude["custom"], true);
        assert_eq!(claude["mcpServers"]["other"]["command"], "other");
        assert_eq!(claude["mcpServers"]["obsidium"]["command"], "obsidium");
        assert_eq!(codex["model"].as_str(), Some("gpt-6"));
        assert_eq!(
            codex["mcp_servers"]["other"]["command"].as_str(),
            Some("other")
        );
        assert_eq!(
            codex["mcp_servers"]["obsidium"]["command"].as_str(),
            Some("obsidium")
        );

        let claude_before = fs::read_to_string(workspace.path().join(".mcp.json")).unwrap();
        let codex_before = fs::read_to_string(workspace.path().join(".codex/config.toml")).unwrap();
        let repeated = connect_workspace(workspace.path()).unwrap();
        assert_eq!(repeated.claude, ConfigFileStatus::Unchanged);
        assert_eq!(repeated.codex, ConfigFileStatus::Unchanged);
        assert_eq!(
            fs::read_to_string(workspace.path().join(".mcp.json")).unwrap(),
            claude_before
        );
        assert_eq!(
            fs::read_to_string(workspace.path().join(".codex/config.toml")).unwrap(),
            codex_before
        );
    }

    #[test]
    fn rejects_a_conflicting_server_without_overwriting_it() {
        let workspace = tempdir().unwrap();
        let claude_path = workspace.path().join(".mcp.json");
        let original = r#"{"mcpServers":{"obsidium":{"command":"other","args":[]}}}"#;
        fs::write(&claude_path, original).unwrap();
        fs::create_dir(workspace.path().join(".codex")).unwrap();
        fs::write(
            workspace.path().join(".codex/config.toml"),
            "model = \"gpt-6\"\n",
        )
        .unwrap();

        assert!(connect_workspace(workspace.path()).is_err());
        assert_eq!(fs::read_to_string(claude_path).unwrap(), original);
    }

    #[test]
    fn rejects_invalid_toml_before_writing_the_claude_config() {
        let workspace = tempdir().unwrap();
        let claude_path = workspace.path().join(".mcp.json");
        let original = r#"{"custom":true}"#;
        fs::write(&claude_path, original).unwrap();
        fs::create_dir(workspace.path().join(".codex")).unwrap();
        fs::write(workspace.path().join(".codex/config.toml"), "invalid = [\n").unwrap();

        assert!(connect_workspace(workspace.path()).is_err());
        assert_eq!(fs::read_to_string(claude_path).unwrap(), original);
    }
}
