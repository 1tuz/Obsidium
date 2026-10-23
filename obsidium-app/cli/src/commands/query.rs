use crate::args::Args;
use crate::client::call;
use crate::error::{CliResult, Failure};
use crate::output::{emit, Options};
use obsidium_core::Core;
use serde_json::json;

pub fn run(core: &Core, args: &mut Args, options: &Options, workspace: &str) -> CliResult<()> {
    let query = args.rest_from(1);
    if query.is_empty() {
        return Err(Failure::usage(
            "использование: obsidium query <dataview text>",
        ));
    }
    let value = call(
        core,
        "query_notes",
        json!({ "query": query }),
        Some(workspace),
    )?;
    emit(&value, options)
}
