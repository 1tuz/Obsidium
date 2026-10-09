use super::tools;
use serde::Deserialize;
use serde_json::{json, Value};

pub type ToolCaller<'a> = &'a dyn Fn(&str, &Value) -> Result<Value, String>;

const LEGACY_PROTOCOL_VERSION: &str = "2025-06-18";
const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";
const SERVER_NAME: &str = "obsidium";
const LEGACY_PROTOCOL_VERSIONS: &[&str] = &[
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS: i32 = -32602;
const UNSUPPORTED_PROTOCOL_VERSION: i32 = -32022;
const PARSE_ERROR: i32 = -32700;

#[derive(Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Deserialize)]
struct ToolCall {
    name: String,
    #[serde(default)]
    arguments: Value,
}

pub fn handle_message(body: &str, call: ToolCaller<'_>) -> Option<String> {
    let message = match serde_json::from_str::<Value>(body) {
        Ok(value) => value,
        Err(error) => {
            return Some(failure(Value::Null, PARSE_ERROR, &error.to_string()).to_string())
        }
    };

    match message {
        Value::Array(items) => {
            let responses = items
                .into_iter()
                .filter_map(|item| handle_single(item, call))
                .collect::<Vec<_>>();
            (!responses.is_empty()).then(|| Value::Array(responses).to_string())
        }
        single => handle_single(single, call).map(|value| value.to_string()),
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum ProtocolEra {
    Legacy,
    Modern,
}

fn handle_single(message: Value, call: ToolCaller<'_>) -> Option<Value> {
    let request = match serde_json::from_value::<RpcRequest>(message) {
        Ok(request) => request,
        Err(error) => return Some(failure(Value::Null, PARSE_ERROR, &error.to_string())),
    };
    let id = request.id.filter(|id| !id.is_null())?;
    let declared = request_protocol_version(request.params.as_ref());
    if let Some(version) = declared {
        if version != MODERN_PROTOCOL_VERSION {
            return Some(failure_with_data(
                id,
                UNSUPPORTED_PROTOCOL_VERSION,
                "Неподдерживаемая версия MCP",
                json!({ "supported": [MODERN_PROTOCOL_VERSION], "requested": version }),
            ));
        }
    }
    let era = if request.method == "server/discover" || declared.is_some() {
        ProtocolEra::Modern
    } else {
        ProtocolEra::Legacy
    };

    Some(match dispatch(&request.method, request.params, call, era) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => failure(id, code, &message),
    })
}

fn request_protocol_version(params: Option<&Value>) -> Option<&str> {
    params?
        .get("_meta")?
        .get("io.modelcontextprotocol/protocolVersion")?
        .as_str()
}

fn server_info() -> Value {
    json!({ "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") })
}

fn modern_result(mut result: Value, cacheable: bool) -> Value {
    let Some(object) = result.as_object_mut() else {
        return result;
    };
    object.insert("resultType".to_owned(), Value::String("complete".to_owned()));
    object.insert(
        "_meta".to_owned(),
        json!({ "io.modelcontextprotocol/serverInfo": server_info() }),
    );
    if cacheable {
        object.insert("ttlMs".to_owned(), Value::from(0));
        object.insert("cacheScope".to_owned(), Value::String("private".to_owned()));
    }
    result
}

fn discover_result() -> Value {
    modern_result(json!({
        "supportedVersions": [MODERN_PROTOCOL_VERSION],
        "capabilities": { "tools": { "listChanged": false } },
        "instructions": tools::INSTRUCTIONS,
    }), true)
}

fn dispatch(
    method: &str,
    params: Option<Value>,
    call: ToolCaller<'_>,
    era: ProtocolEra,
) -> Result<Value, (i32, String)> {
    match method {
        "server/discover" if era == ProtocolEra::Modern => Ok(discover_result()),
        "initialize" if era == ProtocolEra::Legacy => {
            let requested = params
                .as_ref()
                .and_then(|value| value.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or(LEGACY_PROTOCOL_VERSION);
            let version = if LEGACY_PROTOCOL_VERSIONS.contains(&requested) {
                requested
            } else {
                LEGACY_PROTOCOL_VERSION
            };
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": server_info(),
                "instructions": tools::INSTRUCTIONS,
            }))
        }
        "ping" if era == ProtocolEra::Legacy => Ok(json!({})),
        "tools/list" => {
            let result = json!({ "tools": tools::definitions() });
            Ok(if era == ProtocolEra::Modern { modern_result(result, true) } else { result })
        }
        "tools/call" => {
            let request = serde_json::from_value::<ToolCall>(params.unwrap_or(Value::Null))
                .map_err(|error| (INVALID_PARAMS, error.to_string()))?;
            let result = tool_result(call(&request.name, &request.arguments));
            Ok(if era == ProtocolEra::Modern { modern_result(result, false) } else { result })
        }
        _ => Err((METHOD_NOT_FOUND, format!("Неизвестный метод: {method}"))),
    }
}

fn tool_result(outcome: Result<Value, String>) -> Value {
    match outcome {
        Ok(value) => {
            let text = serde_json::to_string(&value).unwrap_or_else(|error| error.to_string());
            json!({
                "content": [{ "type": "text", "text": text }],
                "structuredContent": value,
                "isError": false,
            })
        }
        Err(message) => json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        }),
    }
}

fn failure(id: Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    })
}

fn failure_with_data(id: Value, code: i32, message: &str, data: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message, "data": data },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_tools(_name: &str, _arguments: &Value) -> Result<Value, String> {
        Err("не должно вызываться".to_owned())
    }

    fn handle(body: &str) -> Option<Value> {
        handle_message(body, &no_tools).map(|value| serde_json::from_str(&value).unwrap())
    }

    #[test]
    fn answers_initialize_with_protocol_version_and_tools_capability() {
        let response = handle(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#,
        )
        .unwrap();
        assert_eq!(response["result"]["protocolVersion"], "2025-03-26");
        assert!(response["result"]["capabilities"]["tools"].is_object());
        assert_eq!(response["result"]["serverInfo"]["name"], SERVER_NAME);
    }

    #[test]
    fn discovers_the_modern_stateless_protocol() {
        let response = handle(
            r#"{"jsonrpc":"2.0","id":"d","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}"#,
        ).unwrap();
        assert_eq!(response["result"]["resultType"], "complete");
        assert_eq!(response["result"]["supportedVersions"][0], MODERN_PROTOCOL_VERSION);
        assert_eq!(response["result"]["ttlMs"], 0);
        assert_eq!(response["result"]["cacheScope"], "private");
        assert_eq!(response["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], SERVER_NAME);
    }

    #[test]
    fn modern_tool_lists_are_self_describing_and_cacheable() {
        let response = handle(
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}"#,
        ).unwrap();
        assert_eq!(response["result"]["resultType"], "complete");
        assert_eq!(response["result"]["ttlMs"], 0);
        assert_eq!(response["result"]["cacheScope"], "private");
        assert!(response["result"]["tools"].as_array().is_some());
    }

    #[test]
    fn rejects_unknown_modern_protocol_revisions_with_supported_versions() {
        let response = handle(
            r#"{"jsonrpc":"2.0","id":9,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2027-01-01"}}}"#,
        ).unwrap();
        assert_eq!(response["error"]["code"], UNSUPPORTED_PROTOCOL_VERSION);
        assert_eq!(response["error"]["data"]["requested"], "2027-01-01");
        assert_eq!(response["error"]["data"]["supported"][0], MODERN_PROTOCOL_VERSION);
    }

    #[test]
    fn keeps_silent_on_notifications() {
        assert!(handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
        assert!(handle(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#).is_none());
    }

    #[test]
    fn reports_unknown_method_as_rpc_error() {
        let response = handle(r#"{"jsonrpc":"2.0","id":7,"method":"resources/list"}"#).unwrap();
        assert_eq!(response["error"]["code"], -32601);
        assert_eq!(response["id"], 7);
    }

    #[test]
    fn reports_broken_json_without_panicking() {
        let response = handle("{ не json").unwrap();
        assert_eq!(response["error"]["code"], -32700);
    }

    #[test]
    fn answers_every_request_of_a_batch_and_skips_notifications() {
        let response = handle(
            r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},
                {"jsonrpc":"2.0","method":"notifications/initialized"},
                {"jsonrpc":"2.0","id":2,"method":"tools/list"}]"#,
        )
        .unwrap();
        let items = response.as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[1]["result"]["tools"].as_array().unwrap().len() > 10);
    }

    #[test]
    fn returns_tool_failure_as_result_with_error_flag() {
        let failing = |_name: &str, _arguments: &Value| Err("Заметка не найдена".to_owned());
        let raw = handle_message(
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_note","arguments":{}}}"#,
            &failing,
        )
        .unwrap();
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["result"]["isError"], true);
        assert_eq!(response["result"]["content"][0]["text"], "Заметка не найдена");
        assert!(response["error"].is_null());
    }

    #[test]
    fn successful_tool_calls_expose_structured_content() {
        let successful = |_name: &str, _arguments: &Value| Ok(json!({ "path": "Note.md", "changed": true }));
        let raw = handle_message(
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"update_note","arguments":{}}}"#,
            &successful,
        )
        .unwrap();
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["result"]["structuredContent"]["path"], "Note.md");
        assert_eq!(response["result"]["structuredContent"]["changed"], true);
        assert_eq!(response["result"]["isError"], false);
    }

    #[test]
    fn every_tool_declares_a_json_schema() {
        for tool in tools::definitions() {
            assert!(tool["name"].as_str().is_some_and(|name| !name.is_empty()));
            assert!(tool["description"].as_str().is_some_and(|value| !value.is_empty()));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }
}
