use crate::error::{CliResult, Failure};
use aquilum_core::mcp::tools;
use aquilum_core::Core;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const INDEX_TIMEOUT: Duration = Duration::from_secs(30);
const INDEX_POLL: Duration = Duration::from_millis(50);

static INDEX_READY: AtomicBool = AtomicBool::new(false);

pub fn call(
    core: &Core,
    name: &str,
    mut arguments: Value,
    workspace: Option<&str>,
) -> CliResult<Value> {
    if let Some(workspace) = workspace {
        wait_for_index(core, workspace);
        match arguments.as_object_mut() {
            Some(object) => {
                object.insert("workspace".to_owned(), json!(workspace));
            }
            None => {
                return Err(Failure::usage(format!(
                    "аргументы инструмента {name} должны быть объектом"
                )))
            }
        }
    }
    tools::call(core, name, &arguments).map_err(|error| Failure::from_core(error))
}

fn wait_for_index(core: &Core, workspace: &str) {
    if INDEX_READY.load(Ordering::Relaxed) {
        return;
    }
    let _ = core.search.prepare(workspace);
    let deadline = Instant::now() + INDEX_TIMEOUT;
    while Instant::now() < deadline {
        if !core.search.status(None).updating {
            INDEX_READY.store(true, Ordering::Relaxed);
            return;
        }
        std::thread::sleep(INDEX_POLL);
    }
}

pub fn optional(arguments: &mut Value, key: &str, value: Option<Value>) {
    if let (Some(object), Some(value)) = (arguments.as_object_mut(), value) {
        object.insert(key.to_owned(), value);
    }
}
