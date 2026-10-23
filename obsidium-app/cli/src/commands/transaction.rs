use crate::args::Args;
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::Value;

const USAGE: &str =
    "использование: obsidium transaction <preview|apply|rollback> [--file plan.json | --stdin]";

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let action = args.at(1).ok_or_else(|| Failure::usage(USAGE))?.to_owned();
    match action.as_str() {
        "preview" => plan(core, args, options, workspace, "preview_transaction"),
        "apply" => plan(core, args, options, workspace, "apply_transaction"),
        "rollback" => rollback(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная transaction-команда: {other}. {USAGE}"
        ))),
    }
}

fn plan(
    core: &Core,
    args: &mut Args,
    options: &Options,
    workspace: &str,
    tool: &str,
) -> CliResult<()> {
    let version_name = args.take_option("--version-name")?;
    let mut arguments = args.payload(options.stdin)?;
    if arguments.get("versionName").is_none() {
        optional(&mut arguments, "versionName", version_name.map(Value::from));
    }
    let value = call(core, tool, arguments, Some(workspace))?;
    emit(&value, options)
}

fn rollback(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let flag = args.take_option("--transaction-id")?;
    let id = flag.or_else(|| args.value_at(2));
    let arguments = match id {
        Some(id) => serde_json::json!({ "transactionId": id }),
        None => args.payload(options.stdin)?,
    };
    let value = call(core, "rollback_transaction", arguments, Some(workspace))?;
    emit(&value, options)
}
