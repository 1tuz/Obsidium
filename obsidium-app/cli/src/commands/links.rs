use crate::args::{required, Args};
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use aquilum_core::Core;
use serde_json::{json, Value};

const USAGE: &str =
    "использование: obsidium links <suggest|add|remove> <note> [target] [--kind K] [--preview]";

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let action = args.at(1).ok_or_else(|| Failure::usage(USAGE))?.to_owned();
    match action.as_str() {
        "suggest" => suggest(core, args, options, workspace),
        "add" => edit(
            core,
            args,
            options,
            workspace,
            "link_notes",
            "использование: obsidium links add <note> <target> [--kind K] [--preview]",
        ),
        "remove" => edit(
            core,
            args,
            options,
            workspace,
            "unlink_notes",
            "использование: obsidium links remove <note> <target> [--kind K] [--preview]",
        ),
        other => Err(Failure::usage(format!(
            "неизвестная links-команда: {other}. {USAGE}"
        ))),
    }
}

fn suggest(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let limit = args.take_number("--limit")?;
    let note = required(
        args,
        2,
        "использование: obsidium links suggest <note> [--limit N]",
    )?;
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "limit", limit.map(|value| json!(value)));
    let value = call(core, "suggest_links", arguments, Some(workspace))?;
    emit(&value, options)
}

fn edit(
    core: &Core,
    args: &mut Args,
    options: &Options,
    workspace: &str,
    tool: &str,
    usage: &str,
) -> CliResult<()> {
    let target_flag = args.take_option("--target")?;
    let kind = args.take_option("--kind")?;
    let preview = args.take_flag("--preview");
    let expected_hash = args.take_option("--expected-hash")?;
    let version_name = args.take_option("--version-name")?;
    let note = required(args, 2, usage)?;
    let target = target_flag
        .or_else(|| args.value_at(3))
        .ok_or_else(|| Failure::usage(usage))?;
    let mut arguments = json!({ "note": note, "target": target });
    optional(&mut arguments, "kind", kind.map(Value::from));
    optional(
        &mut arguments,
        "preview",
        preview.then_some(Value::Bool(true)),
    );
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    optional(&mut arguments, "versionName", version_name.map(Value::from));
    let value = call(core, tool, arguments, Some(workspace))?;
    emit(&value, options)
}
