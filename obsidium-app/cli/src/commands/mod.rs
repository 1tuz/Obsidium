use crate::args::Args;
use crate::error::{CliResult, Failure};
use crate::output::Options;
use aquilum_core::Core;

mod context;
mod graph;
mod knowledge;
mod links;
mod note;
mod query;
mod search;
mod task;
mod transaction;

pub fn dispatch(
    core: &Core,
    command: &str,
    args: &mut Args,
    options: &Options,
    workspace: &str,
) -> CliResult<()> {
    match command {
        "search" => search::run(core, args, options, workspace),
        "context" => context::run(core, args, options, workspace),
        "knowledge" => knowledge::run(core, args, options, workspace),
        "note" => note::run(core, args, options, workspace),
        "task" => task::run(core, args, options, workspace),
        "links" => links::run(core, args, options, workspace),
        "graph" => graph::run(core, args, options, workspace),
        "query" => query::run(core, args, options, workspace),
        "transaction" => transaction::run(core, args, options, workspace),
        "history" => history(core, args, options, workspace),
        "backlinks" => backlinks(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная команда: {other}. Список команд: obsidium help"
        ))),
    }
}

fn history(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let offset = args.take_number("--offset")?;
    let limit = args.take_number("--limit")?;
    let note = crate::args::required(
        args,
        1,
        "использование: obsidium history <path> [--offset N] [--limit N]",
    )?;
    let mut arguments = serde_json::json!({ "note": note });
    crate::client::optional(&mut arguments, "offset", offset.map(|value| value.into()));
    crate::client::optional(&mut arguments, "limit", limit.map(|value| value.into()));
    let value = crate::client::call(core, "note_history", arguments, Some(workspace))?;
    crate::output::emit(&value, options)
}

fn backlinks(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let note = crate::args::required(args, 1, "использование: obsidium backlinks <path>")?;
    let value = crate::client::call(
        core,
        "backlinks",
        serde_json::json!({ "note": note }),
        Some(workspace),
    )?;
    crate::output::emit(&value, options)
}
