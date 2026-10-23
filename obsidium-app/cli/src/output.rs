use crate::error::{CliResult, Failure};
use serde_json::Value;

const VERBOSE: [&str; 3] = ["frontmatter", "content", "snippet"];
const LIST_KEYS: [&str; 9] = [
    "results",
    "versions",
    "tasks",
    "workspaces",
    "notes",
    "changes",
    "nodes",
    "rows",
    "items",
];

pub struct Options {
    pub json: bool,
    pub compact: bool,
    pub stdin: bool,
}

pub fn emit(value: &Value, options: &Options) -> CliResult<()> {
    let value = if options.compact {
        compacted(value)
    } else {
        value.clone()
    };
    if !options.json {
        if let Some(content) = value.get("content").and_then(Value::as_str) {
            print!("{content}");
            return Ok(());
        }
    }
    let text = if options.json {
        render_json(&value, options.compact)?
    } else {
        render_human(&value)?
    };
    println!("{text}");
    Ok(())
}

fn render_json(value: &Value, compact: bool) -> CliResult<String> {
    let rendered = if compact {
        serde_json::to_string(value)
    } else {
        serde_json::to_string_pretty(value)
    };
    rendered.map_err(|error| Failure::execution(format!("не удалось собрать JSON: {error}")))
}

fn render_human(value: &Value) -> CliResult<String> {
    let paths = list_of(value)
        .filter(|items| !items.is_empty())
        .and_then(|items| {
            items
                .iter()
                .map(|item| item.get("path").and_then(Value::as_str))
                .collect::<Option<Vec<_>>>()
        });
    if let Some(paths) = paths {
        return Ok(paths.join("\n"));
    }
    render_json(value, false)
}

fn list_of(value: &Value) -> Option<&Vec<Value>> {
    LIST_KEYS
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_array))
}

fn compacted(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| !VERBOSE.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), compacted(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(compacted).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::compacted;
    use serde_json::json;

    #[test]
    fn compact_mode_drops_verbose_fields_at_any_depth() {
        let value = json!({
            "path": "Идея.md",
            "content": "текст",
            "frontmatter": { "tags": ["a"] },
            "results": [{ "path": "a.md", "snippet": "фрагмент" }],
        });
        let compact = compacted(&value);
        assert!(compact.get("content").is_none());
        assert!(compact.get("frontmatter").is_none());
        assert!(compact["results"][0].get("snippet").is_none());
        assert_eq!(compact["results"][0]["path"], "a.md");
        assert_eq!(compact["path"], "Идея.md");
    }
}
