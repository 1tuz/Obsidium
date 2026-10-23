use crate::args::Args;
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::json;

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    match args.at(1) {
        Some("review") => review(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная подкоманда knowledge: {}. Используйте review",
            other.unwrap_or("")
        ))),
    }
}

fn review(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let mut arguments = json!({});
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
        "checks",
        args.take_list("--checks")?.map(|checks| json!(checks)),
    );
    optional(
        &mut arguments,
        "staleAfterDays",
        args.take_number("--stale-days")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "offset",
        args.take_number("--offset")?.map(Into::into),
    );
    optional(
        &mut arguments,
        "limit",
        args.take_number("--limit")?.map(Into::into),
    );
    let value = call(core, "review_knowledge", arguments, Some(workspace))?;
    emit(&value, options)
}
