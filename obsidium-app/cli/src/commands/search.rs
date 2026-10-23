use crate::args::Args;
use crate::client::{call, optional};
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::{json, Value};

const PAGE_LIMIT: usize = 50;
const USAGE: &str =
    "использование: obsidium search <query...> [--folder F] [--limit N] [--offset N]";

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let folder = args.take_option("--folder")?;
    let limit = args
        .take_number("--limit")?
        .unwrap_or(10)
        .clamp(1, PAGE_LIMIT);
    let offset = args.take_number("--offset")?.unwrap_or(0);
    args.reject_unknown_flags(1)?;
    let query = args.rest_from(1);
    if query.is_empty() {
        return Err(Failure::usage(USAGE));
    }

    let mut arguments = json!({ "query": query, "limit": limit, "offset": offset });
    optional(&mut arguments, "folder", folder.map(Value::from));
    let value = call(core, "search_notes", arguments, Some(workspace))?;
    emit(&value, options)
}
