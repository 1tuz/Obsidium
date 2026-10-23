use crate::args::{required, Args};
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::{json, Value};

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let action = args.at(1).map(str::to_owned);
    match action.as_deref() {
        Some("neighborhood") => neighborhood(core, args, options, workspace),
        Some(other) => Err(Failure::usage(format!(
            "неизвестная graph-команда: {other}. Использование: obsidium graph neighborhood <note>"
        ))),
        None => Err(Failure::usage(
            "использование: obsidium graph neighborhood <note> [--depth N] [--direction in|out|both]",
        )),
    }
}

fn neighborhood(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let depth = args.take_number("--depth")?;
    let direction = args.take_option("--direction")?;
    let limit = args.take_number("--limit")?;
    let note = required(
        args,
        2,
        "использование: obsidium graph neighborhood <note> [--depth N] [--direction in|out|both]",
    )?;
    let mut arguments = json!({ "note": note });
    optional(&mut arguments, "depth", depth.map(|value| json!(value)));
    optional(&mut arguments, "direction", direction.map(Value::from));
    optional(&mut arguments, "limit", limit.map(|value| json!(value)));
    let value = call(core, "get_graph_neighborhood", arguments, Some(workspace))?;
    emit(&value, options)
}
