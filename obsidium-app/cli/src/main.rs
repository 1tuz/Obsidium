mod args;
mod client;
mod commands;
mod error;
mod help;
mod output;

use aquilum_core::mcp::open_headless_core;
use aquilum_core::Core;
use args::Args;
use error::{CliResult, Failure};
use output::Options;
use std::path::Path;
use std::sync::Arc;

const APP_IDENTIFIER: &str = "com.dmitriy.aquilum-app";

fn main() {
    if let Err(failure) = execute() {
        eprintln!("obsidium: {}", failure.message());
        std::process::exit(failure.code());
    }
}

fn execute() -> CliResult<()> {
    let mut args = Args::new(std::env::args().skip(1).collect());
    let options = Options {
        json: args.take_flag("--json"),
        compact: args.take_flag("--compact"),
        stdin: args.take_flag("--stdin"),
    };
    let workspace = args
        .take_option("--workspace")?
        .or_else(|| std::env::var("OBSIDIUM_WORKSPACE").ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());

    if args.is_empty() || matches!(args.first(), Some("help" | "--help" | "-h")) {
        help::print();
        return Ok(());
    }

    let selected = workspace
        .as_deref()
        .map(Path::new)
        .filter(|path| path.is_dir());
    let core = open_headless_core(APP_IDENTIFIER, "headless-cli", selected)
        .map_err(|error| Failure::execution(error))?;

    let command = args.first().map(str::to_owned);
    match command.as_deref() {
        Some("mcp") => mcp(core, &mut args),
        Some("workspaces") => {
            let value = client::call(&core, "list_workspaces", serde_json::json!({}), None)?;
            output::emit(&value, &options)
        }
        Some(command) => {
            let workspace = workspace.ok_or_else(|| {
                Failure::usage("для этой команды нужен --workspace PATH или OBSIDIUM_WORKSPACE")
            })?;
            commands::dispatch(&core, command, &mut args, &options, &workspace)
        }
        None => Ok(()),
    }
}

fn mcp(core: Arc<Core>, args: &mut Args) -> CliResult<()> {
    let usage = "использование: obsidium mcp stdio [--workspace PATH]";
    if args.at(1) != Some("stdio") {
        return Err(Failure::usage(usage));
    }
    if let Some(extra) = args.at(2) {
        return Err(Failure::usage(format!("лишний аргумент: {extra}")));
    }
    if aquilum_core::mcp::run_stdio_core(core) == 0 {
        Ok(())
    } else {
        Err(Failure::execution("MCP stdio завершился с ошибкой"))
    }
}
