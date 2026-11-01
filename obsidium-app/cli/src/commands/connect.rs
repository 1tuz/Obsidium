use crate::args::Args;
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::mcp::workspace_config::connect_workspace;
use std::env;
use std::path::PathBuf;

pub fn run(args: &mut Args, options: &Options, workspace: Option<&str>) -> CliResult<()> {
    if matches!(args.at(1), Some("--help" | "-h")) {
        println!("использование: obsidium connect [PATH]");
        return Ok(());
    }

    let positional = args.value_at(1);
    if args.at(2).is_some() || (workspace.is_some() && positional.is_some()) {
        return Err(Failure::usage(
            "использование: obsidium [--workspace PATH] connect [PATH]",
        ));
    }
    args.reject_unknown_flags(1)?;

    let workspace = workspace
        .map(PathBuf::from)
        .or_else(|| positional.map(PathBuf::from))
        .map(Ok)
        .unwrap_or_else(env::current_dir)
        .map_err(|error| Failure::execution(error.to_string()))?;
    let report = connect_workspace(&workspace).map_err(Failure::execution)?;
    let value =
        serde_json::to_value(report).map_err(|error| Failure::execution(error.to_string()))?;
    emit(&value, options)
}
