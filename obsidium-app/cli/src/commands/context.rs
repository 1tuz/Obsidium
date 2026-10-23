use crate::args::Args;
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use aquilum_core::Core;
use serde_json::json;

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    match args.at(1) {
        Some("search") => search(core, args, options, workspace),
        Some("connections") => connections(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная подкоманда context: {}. Используйте search или connections",
            other.unwrap_or("")
        ))),
    }
}

fn search(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let query = args.rest_from(2);
    if query.trim().is_empty() {
        return Err(Failure::usage(
            "использование: obsidium context search \"запрос\" [--folder F] [--tags a,b] [--limit N] [--max-chars N] [--graph-depth N] [--deep]",
        ));
    }
    let mut arguments = json!({ "query": query });
    optional(
        &mut arguments,
        "folder",
        args.take_option("--folder")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "tags",
        args.take_list("--tags")?.map(|tags| json!(tags)),
    );
    optional(
        &mut arguments,
        "limit",
        args.take_number("--limit")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "maxChars",
        args.take_number("--max-chars")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "graphDepth",
        args.take_number("--graph-depth")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "seedNotes",
        args.take_list("--seeds")?.map(|notes| json!(notes)),
    );
    if args.take_flag("--deep") {
        arguments["mode"] = json!("deep");
    }
    let value = call(core, "search_context", arguments, Some(workspace))?;
    emit(&value, options)
}

fn connections(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let mut arguments = json!({});
    let notes = args.take_list("--notes")?;
    let query = args.rest_from(2);
    if let Some(notes) = notes {
        arguments["notes"] = json!(notes);
    } else if !query.trim().is_empty() {
        arguments["query"] = json!(query);
    } else {
        return Err(Failure::usage(
            "использование: obsidium context connections \"тема\" | --notes A,B [--depth N] [--limit N]",
        ));
    }
    optional(
        &mut arguments,
        "depth",
        args.take_number("--depth")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "limit",
        args.take_number("--limit")?.map(Into::into),
    );
    let value = call(core, "discover_connections", arguments, Some(workspace))?;
    emit(&value, options)
}
