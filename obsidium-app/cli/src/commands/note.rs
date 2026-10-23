use crate::args::Args;
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::{json, Value};

const USAGE: &str =
    "использование: obsidium note <read|create|update|rename|move|delete|outline|context> <path>";

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let action = args.at(1).ok_or_else(|| Failure::usage(USAGE))?.to_owned();
    match action.as_str() {
        "read" => read(core, args, options, workspace),
        "create" => create(core, args, options, workspace),
        "update" => update(core, args, options, workspace),
        "rename" => rename(core, args, options, workspace),
        "move" => move_note(core, args, options, workspace),
        "delete" => delete(core, args, options, workspace),
        "outline" => outline(core, args, options, workspace),
        "context" => context(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная note-команда: {other}. {USAGE}"
        ))),
    }
}

fn read(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let heading = args.take_option("--heading")?;
    let offset = args.take_number("--offset")?;
    let limit = args.take_number("--limit")?;
    let note = crate::args::required(
        args,
        2,
        "использование: obsidium note read <path> [--heading H] [--offset N] [--limit N]",
    )?;
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "heading", heading.map(Value::from));
    optional(&mut arguments, "offset", offset.map(|value| json!(value)));
    optional(&mut arguments, "limit", limit.map(|value| json!(value)));
    let value = call(core, "read_note", arguments, Some(workspace))?;
    emit(&value, options)
}

fn create(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let version_name = args.take_option("--version-name")?;
    let content = args.content(options.stdin)?.unwrap_or_default();
    let path = crate::args::required(
        args,
        2,
        "использование: obsidium note create <path> [--content TEXT | --stdin]",
    )?;
    let mut arguments = json!({ "path": path, "content": content });
    optional(&mut arguments, "versionName", version_name.map(Value::from));
    let value = call(core, "create_note", arguments, Some(workspace))?;
    emit(&value, options)
}

fn update(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let mode = args
        .take_option("--mode")?
        .unwrap_or_else(|| "replace".to_owned());
    let find = args.take_option("--find")?;
    let heading = args.take_option("--heading")?;
    let all = args.take_flag("--all");
    let expected_hash = args.take_option("--expected-hash")?;
    let version_name = args.take_option("--version-name")?;
    let content = args
        .content(options.stdin)?
        .ok_or_else(|| Failure::usage("передайте --content TEXT или --stdin"))?;
    let note = crate::args::required(
        args,
        2,
        "использование: obsidium note update <path> [--content TEXT | --stdin] [--mode MODE]",
    )?;
    let mut arguments = json!({ "note": note, "content": content, "mode": mode });
    optional(&mut arguments, "find", find.map(Value::from));
    optional(&mut arguments, "heading", heading.map(Value::from));
    optional(&mut arguments, "all", all.then_some(Value::Bool(true)));
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    optional(&mut arguments, "versionName", version_name.map(Value::from));
    let value = call(core, "update_note", arguments, Some(workspace))?;
    emit(&value, options)
}

fn rename(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let flag = args.take_option("--title")?;
    let note = crate::args::required(
        args,
        2,
        "использование: obsidium note rename <path> <title> [--title T]",
    )?;
    let title = flag
        .or_else(|| args.value_at(3))
        .ok_or_else(|| Failure::usage("использование: obsidium note rename <path> <title>"))?;
    let arguments = json!({ "note": note, "title": title });
    let value = call(core, "rename_note", arguments, Some(workspace))?;
    emit(&value, options)
}

fn move_note(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let flag = args.take_option("--folder")?;
    let to_workspace = args.take_option("--to-workspace")?;
    let note = crate::args::required(
        args,
        2,
        "использование: obsidium note move <path> [folder] [--to-workspace W]",
    )?;
    let folder = flag.or_else(|| args.value_at(3));
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "folder", folder.map(Value::from));
    optional(&mut arguments, "toWorkspace", to_workspace.map(Value::from));
    let value = call(core, "move_note", arguments, Some(workspace))?;
    emit(&value, options)
}

fn delete(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let note = crate::args::required(args, 2, "использование: obsidium note delete <path>")?;
    let value = call(
        core,
        "delete_note",
        json!({ "note": note }),
        Some(workspace),
    )?;
    emit(&value, options)
}

fn outline(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let note = crate::args::required(args, 2, "использование: obsidium note outline <path>")?;
    let value = call(
        core,
        "note_outline",
        json!({ "note": note }),
        Some(workspace),
    )?;
    emit(&value, options)
}

fn context(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let mut sections = Vec::new();
    while let Some(mut items) = args.take_list("--sections")? {
        sections.append(&mut items);
    }
    let sections = (!sections.is_empty()).then_some(sections);
    let limit = args.take_number("--limit")?;
    let no_content = args.take_flag("--no-content");
    let note = crate::args::required(
        args,
        2,
        "использование: obsidium note context <path> [--sections LIST] [--limit N] [--no-content]",
    )?;
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "sections", sections.map(Value::from));
    optional(&mut arguments, "limit", limit.map(|value| json!(value)));
    optional(
        &mut arguments,
        "content",
        no_content.then_some(Value::Bool(false)),
    );
    let value = call(core, "get_note_context", arguments, Some(workspace))?;
    emit(&value, options)
}
