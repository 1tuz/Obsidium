use crate::app_core::Core;
use serde_json::Value;

pub fn definitions() -> Vec<Value> {
    Vec::new()
}

pub fn call(_core: &Core, _name: &str, _arguments: &Value) -> Option<Result<Value, String>> {
    None
}
