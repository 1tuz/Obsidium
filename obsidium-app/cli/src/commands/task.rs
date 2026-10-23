use crate::args::{read_stdin, required, Args};
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::{json, Value};

const USAGE: &str =
    "использование: obsidium task <list|add|update|toggle|delete> [note] [--text T]";

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let action = args.at(1).ok_or_else(|| Failure::usage(USAGE))?.to_owned();
    match action.as_str() {
        "list" => list(core, args, options, workspace),
        "add" => add(core, args, options, workspace),
        "update" => update(core, args, options, workspace),
        "toggle" => toggle(core, args, options, workspace),
        "delete" => delete(core, args, options, workspace),
        other => Err(Failure::usage(format!(
            "неизвестная task-команда: {other}. {USAGE}"
        ))),
    }
}

fn list(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let note = args.take_option("--note")?;
    let folder = args.take_option("--folder")?;
    let status = args.take_option("--status")?;
    let query = args.take_option("--query")?;
    let offset = args.take_number("--offset")?;
    let limit = args.take_number("--limit")?;
    let note = note.or_else(|| args.value_at(2));
    let mut arguments = json!({});
    optional(&mut arguments, "note", note.map(Value::from));
    optional(&mut arguments, "folder", folder.map(Value::from));
    optional(&mut arguments, "status", status.map(Value::from));
    optional(&mut arguments, "query", query.map(Value::from));
    optional(&mut arguments, "offset", offset.map(|value| json!(value)));
    optional(&mut arguments, "limit", limit.map(|value| json!(value)));
    let value = call(core, "list_tasks", arguments, Some(workspace))?;
    emit(&value, options)
}

fn add(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let flag = args.take_option("--text")?;
    let heading = args.take_option("--heading")?;
    let expected_hash = args.take_option("--expected-hash")?;
    let note = required(
        args,
        2,
        "использование: obsidium task add <note> <text...> [--heading H]",
    )?;
    let text = match flag {
        Some(text) => text,
        None if options.stdin => read_stdin()?,
        None => args.rest_from(3),
    };
    if text.trim().is_empty() {
        return Err(Failure::usage(
            "передайте текст задачи аргументом или через --text",
        ));
    }
    let mut arguments = json!({ "note": note, "text": text });
    optional(&mut arguments, "underHeading", heading.map(Value::from));
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    let value = call(core, "create_task", arguments, Some(workspace))?;
    emit(&value, options)
}

fn update(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let flag = args.take_option("--text")?;
    let task_id = args.take_option("--task-id")?;
    let line = args.take_number("--line")?;
    let expected_hash = args.take_option("--expected-hash")?;
    let note = required(
        args,
        2,
        "использование: obsidium task update <note> <text...> [--task-id ID] [--line N]",
    )?;
    let text = match flag {
        Some(text) => text,
        None if options.stdin => read_stdin()?,
        None => args.rest_from(3),
    };
    if text.trim().is_empty() {
        return Err(Failure::usage(
            "передайте новый текст задачи через --text или аргументом",
        ));
    }
    let mut arguments = json!({ "note": note, "text": text });
    optional(&mut arguments, "taskId", task_id.map(Value::from));
    optional(&mut arguments, "line", line.map(|value| json!(value)));
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    let value = call(core, "update_task", arguments, Some(workspace))?;
    emit(&value, options)
}

fn toggle(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let task_id = args.take_option("--task-id")?;
    let line = args.take_number("--line")?;
    let done = args.take_flag("--done");
    let undone = args.take_flag("--undone");
    let expected_hash = args.take_option("--expected-hash")?;
    let note = required(
        args,
        2,
        "использование: obsidium task toggle <note> [--task-id ID] [--line N] [--done | --undone]",
    )?;
    if done && undone {
        return Err(Failure::usage("--done и --undone несовместимы"));
    }
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "taskId", task_id.map(Value::from));
    optional(&mut arguments, "line", line.map(|value| json!(value)));
    optional(
        &mut arguments,
        "done",
        done.then_some(Value::Bool(true))
            .or_else(|| undone.then_some(Value::Bool(false))),
    );
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    let value = call(core, "toggle_task", arguments, Some(workspace))?;
    emit(&value, options)
}

fn delete(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let task_id = args.take_option("--task-id")?;
    let line = args.take_number("--line")?;
    let expected_hash = args.take_option("--expected-hash")?;
    let note = required(
        args,
        2,
        "использование: obsidium task delete <note> [--task-id ID] [--line N]",
    )?;
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "taskId", task_id.map(Value::from));
    optional(&mut arguments, "line", line.map(|value| json!(value)));
    optional(
        &mut arguments,
        "expectedHash",
        expected_hash.map(Value::from),
    );
    let value = call(core, "delete_task", arguments, Some(workspace))?;
    emit(&value, options)
}
