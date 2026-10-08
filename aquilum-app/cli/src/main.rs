use aquilum_core::files::document::{ensure_directory_impl, read_file_snapshot_impl};
use aquilum_core::files::gate;
use aquilum_core::history::Source;
use aquilum_core::mcp::{open_headless_core, run_stdio_core, vault::Vault};
use aquilum_core::search::models::SearchIndexState;
use aquilum_core::Core;
use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const APP_IDENTIFIER: &str = "com.dmitriy.aquilum-app";
const INDEX_TIMEOUT: Duration = Duration::from_secs(30);

fn main() {
    if let Err(error) = execute() {
        eprintln!("obsidium: {error}");
        std::process::exit(2);
    }
}

fn execute() -> Result<(), String> {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    let json_output = take_flag(&mut args, "--json");
    let workspace =
        take_option(&mut args, "--workspace").or_else(|| std::env::var("OBSIDIUM_WORKSPACE").ok());

    if args.is_empty() || matches!(args[0].as_str(), "help" | "--help" | "-h") {
        print_help();
        return Ok(());
    }

    let selected = workspace.as_deref().map(Path::new);
    let core = open_headless_core(APP_IDENTIFIER, "headless-cli", selected)?;

    if args.len() == 2 && args[0] == "mcp" && args[1] == "stdio" {
        let code = run_stdio_core(core);
        return if code == 0 {
            Ok(())
        } else {
            Err("MCP stdio завершился с ошибкой".to_owned())
        };
    }

    if args[0] == "workspaces" {
        let workspaces = core
            .ui_state
            .list_workspaces()
            .map_err(|error| format!("{error:?}"))?;
        return print_value(json!({ "workspaces": workspaces }), json_output);
    }

    let workspace = workspace.ok_or_else(|| {
        "для этой команды нужен --workspace PATH или OBSIDIUM_WORKSPACE".to_owned()
    })?;
    let vault = vault(&workspace)?;

    match args[0].as_str() {
        "search" => search(&core, &workspace, &mut args, json_output),
        "note" => note(&core, &vault, &mut args, json_output),
        "backlinks" => backlinks(&core, &workspace, &vault, &mut args, json_output),
        "history" => history(&core, &vault, &mut args, json_output),
        other => Err(format!("неизвестная команда: {other}")),
    }
}

fn vault(workspace: &str) -> Result<Vault, String> {
    let root = aquilum_core::search::paths::canonical_path(Path::new(workspace));
    if !root.is_dir() {
        return Err(format!("база знаний не найдена: {}", root.display()));
    }
    Ok(Vault {
        root,
        visible: false,
    })
}

fn search(
    core: &Arc<Core>,
    workspace: &str,
    args: &mut Vec<String>,
    json_output: bool,
) -> Result<(), String> {
    if args.len() < 2 {
        return Err("использование: obsidium search <query> --workspace PATH".to_owned());
    }
    let limit = take_option(args, "--limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 100);
    let query = args[1..].join(" ");
    wait_for_index(core, workspace)?;
    let result = core
        .search
        .search(workspace, &query, Some(limit))
        .map_err(|error| error.to_string())?;
    if json_output {
        return print_value(
            serde_json::to_value(result).map_err(|error| error.to_string())?,
            true,
        );
    }
    for item in result.results {
        println!("{}\t{}", item.path, item.title);
    }
    Ok(())
}

fn note(
    core: &Arc<Core>,
    vault: &Vault,
    args: &mut Vec<String>,
    json_output: bool,
) -> Result<(), String> {
    if args.len() < 3 {
        return Err("использование: obsidium note <read|create|update> <path>".to_owned());
    }
    let action = args[1].clone();
    let requested = args[2].clone();
    match action.as_str() {
        "read" => {
            let path = vault.note(&requested)?;
            let snapshot = read_file_snapshot_impl(&path).map_err(|error| error.to_string())?;
            if json_output {
                print_value(
                    json!({
                        "path": vault.relative(&path),
                        "hash": snapshot.hash,
                        "content": snapshot.content,
                    }),
                    true,
                )
            } else {
                print!("{}", snapshot.content);
                Ok(())
            }
        }
        "create" => {
            let content = input_content(args, false)?;
            let path = vault.note_path(&requested)?;
            if let Some(parent) = path.parent() {
                ensure_directory_impl(parent).map_err(|error| error.to_string())?;
            }
            let written = gate::create(core, &path, &content, Source::Agent, Some("CLI create"))
                .map_err(|error| error.to_string())?;
            print_value(
                json!({
                    "path": vault.relative(&path),
                    "hash": written.hash,
                    "created": true,
                }),
                json_output,
            )
        }
        "update" => {
            let content = input_content(args, true)?;
            let path = vault.note(&requested)?;
            let snapshot = read_file_snapshot_impl(&path).map_err(|error| error.to_string())?;
            let written = gate::write(
                core,
                &path,
                &content,
                Some(&snapshot.hash),
                Source::Agent,
                Some("CLI update"),
            )
            .map_err(|error| error.to_string())?;
            print_value(
                json!({
                    "path": vault.relative(&path),
                    "hash": written.hash,
                    "changed": written.hash != snapshot.hash,
                }),
                json_output,
            )
        }
        other => Err(format!("неизвестная note-команда: {other}")),
    }
}

fn backlinks(
    core: &Arc<Core>,
    workspace: &str,
    vault: &Vault,
    args: &mut Vec<String>,
    json_output: bool,
) -> Result<(), String> {
    let requested = args
        .get(1)
        .ok_or_else(|| "использование: obsidium backlinks <note>".to_owned())?;
    let path = vault.note(requested)?;
    wait_for_index(core, workspace)?;
    let result = core
        .search
        .backlinks(workspace, &path.to_string_lossy())
        .map_err(|error| error.to_string())?;
    if json_output {
        print_value(
            serde_json::to_value(result).map_err(|error| error.to_string())?,
            true,
        )
    } else {
        for item in result {
            println!("{}\t{}", item.path, item.title);
        }
        Ok(())
    }
}

fn history(
    core: &Arc<Core>,
    vault: &Vault,
    args: &mut Vec<String>,
    json_output: bool,
) -> Result<(), String> {
    let requested = args
        .get(1)
        .cloned()
        .ok_or_else(|| "использование: obsidium history <note>".to_owned())?;
    let limit = take_option(args, "--limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 200);
    let path = vault.note(&requested)?;
    let page = core.history.page(&|| core.known_roots(), &path, 0, limit);
    print_value(
        serde_json::to_value(page).map_err(|error| error.to_string())?,
        json_output,
    )
}

fn wait_for_index(core: &Core, workspace: &str) -> Result<(), String> {
    core.search
        .prepare(workspace)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + INDEX_TIMEOUT;
    loop {
        let status = core.search.status(Some(workspace));
        match status.state {
            SearchIndexState::Ready if !status.updating => return Ok(()),
            SearchIndexState::Error => {
                return Err(status
                    .error
                    .unwrap_or_else(|| "ошибка поискового индекса".to_owned()));
            }
            _ if Instant::now() >= deadline => {
                return Err("поисковый индекс не успел подготовиться за 30 секунд".to_owned());
            }
            _ => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn input_content(args: &mut Vec<String>, required: bool) -> Result<String, String> {
    if take_flag(args, "--stdin") {
        let mut content = String::new();
        std::io::stdin()
            .read_to_string(&mut content)
            .map_err(|error| error.to_string())?;
        return Ok(content);
    }
    if let Some(content) = take_option(args, "--content") {
        return Ok(content);
    }
    if required {
        Err("передайте --content TEXT или --stdin".to_owned())
    } else {
        Ok(String::new())
    }
}

fn print_value(value: Value, json_output: bool) -> Result<(), String> {
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?
        );
    } else if let Some(path) = value.get("path").and_then(Value::as_str) {
        println!("{path}");
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?
        );
    }
    Ok(())
}

fn take_flag(args: &mut Vec<String>, name: &str) -> bool {
    if let Some(index) = args.iter().position(|argument| argument == name) {
        args.remove(index);
        true
    } else {
        false
    }
}

fn take_option(args: &mut Vec<String>, name: &str) -> Option<String> {
    let index = args.iter().position(|argument| argument == name)?;
    if index + 1 >= args.len() {
        return None;
    }
    args.remove(index);
    Some(args.remove(index))
}

fn print_help() {
    println!(
        r#"Obsidium CLI

Usage:
  obsidium --workspace PATH search <query> [--limit N] [--json]
  obsidium --workspace PATH note read <path> [--json]
  obsidium --workspace PATH note create <path> [--content TEXT | --stdin] [--json]
  obsidium --workspace PATH note update <path> [--content TEXT | --stdin] [--json]
  obsidium --workspace PATH backlinks <path> [--json]
  obsidium --workspace PATH history <path> [--limit N] [--json]
  obsidium workspaces [--json]
  obsidium [--workspace PATH] mcp stdio

Environment:
  OBSIDIUM_WORKSPACE   default vault for headless commands
  OBSIDIUM_DATA_DIR    override Obsidium application-data directory
"#
    );
}
