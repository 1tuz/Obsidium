mod connections;
mod context;
mod frontmatter;
mod history;
mod links;
mod notes;
mod review;
mod search;
mod search_context;
mod tasks;
mod transaction;
mod trash;
mod workspace;
mod workspace_locator;

#[cfg(test)]
mod contract;

use super::vault::Vault;
use crate::app_core::Core;
use crate::files::document::read_file_snapshot_impl;
use crate::files::error::FileCommandError;
use crate::files::gate;
use crate::history::Source;
use serde_json::{json, Value};
use std::path::Path;

pub use crate::files::gate::require_write;

const WRITE_CONFLICT_RETRIES: usize = 1;

pub const INSTRUCTIONS: &str = concat!(
    "Obsidium — локальная база знаний из markdown-файлов. ",
    "Заметки адресуются относительным путём от корня базы (например «Проекты/Obsidium.md») ",
    "или точным названием. Абсолютные пути не нужны. ",
    "Если пользователь говорит «текущая заметка» или «эта заметка», сначала вызовите ",
    "get_workspace и возьмите путь из поля activeNote. ",
    "Перед выводами о содержимом базы проверяйте поле indexing: пока индекс строится, ",
    "поиск может вернуть неполный результат.\n",
    "Порядок работы: начните с search_context — он возвращает готовые фрагменты с путём, заголовком и номерами строк, ",
    "поэтому читать заметки целиком для поиска не нужно. Уточняйте чтение через get_note_context (heading, lineStart/lineEnd) ",
    "или read_note с heading. Если тема разбросана по заметкам и нужны связи между ними — discover_connections. ",
    "Актуализацию базы начинайте с review_knowledge: он отдаёт кандидатов на проверку с причиной и фрагментом, ",
    "а проверку фактов по внешним источникам выполняете вы сами.\n",
    "Порядок работы в незнакомой базе: search_context по теме, затем точечное чтение нужных источников, затем связи — только если они правда нужны; ",
    "не начинайте с list_notes или обхода всех файлов. Длинную заметку читайте не целиком, а через note_outline и нужный раздел; правьте разделом, а не всей заметкой.\n",
    "Для согласованной правки нескольких заметок используйте preview_transaction → apply_transaction; ",
    "сохраняйте transactionId, чтобы при необходимости вызвать rollback_transaction.\n",
    "Фоновая работа с другой базой знаний: передайте её address из list_workspaces аргументом workspace — ",
    "поиск, чтение и правка пойдут в фоновом гостевом индексе, а у пользователя на экране ничего не переключится. ",
    "Запрещено вызывать switch_workspace и open_note для чтения или записи — они переключают видимое окно пользователя! ",
    "switch_workspace и open_note вызываются ИСКЛЮЧИТЕЛЬНО по прямой просьбе пользователя показать/открыть базу или заметку на экране. ",
    "Запись (create_note, update_note, set_frontmatter, restore_version) по умолчанию не открывает вкладку: open: true передавайте только тогда, когда пользователь попросил показать результат."
);

pub fn definitions() -> Vec<Value> {
    let mut all = search_context::definitions();
    all.extend(search::definitions());
    all.extend(notes::definitions());
    all.extend(frontmatter::definitions());
    all.extend(context::definitions());
    all.extend(connections::definitions());
    all.extend(review::definitions());
    all.extend(links::definitions());
    all.extend(tasks::definitions());
    all.extend(transaction::definitions());
    all.extend(trash::definitions());
    all.extend(history::definitions());
    all.extend(workspace::definitions());
    all
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Result<Value, String> {
    search_context::call(core, name, arguments)
        .or_else(|| search::call(core, name, arguments))
        .or_else(|| notes::call(core, name, arguments))
        .or_else(|| frontmatter::call(core, name, arguments))
        .or_else(|| context::call(core, name, arguments))
        .or_else(|| connections::call(core, name, arguments))
        .or_else(|| review::call(core, name, arguments))
        .or_else(|| links::call(core, name, arguments))
        .or_else(|| tasks::call(core, name, arguments))
        .or_else(|| transaction::call(core, name, arguments))
        .or_else(|| trash::call(core, name, arguments))
        .or_else(|| history::call(core, name, arguments))
        .or_else(|| workspace::call(core, name, arguments))
        .unwrap_or_else(|| Err(format!("Неизвестный инструмент: {name}")))
}

pub fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    tool_with(name, description, properties, required, json!({}))
}

pub fn tool_with(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    keywords: Value,
) -> Value {
    let both_names = properties.get("note").is_some() && properties.get("path").is_some();
    let required_a_note = required
        .iter()
        .any(|field| matches!(*field, "note" | "path"));
    let required = required
        .iter()
        .copied()
        .filter(|field| !(both_names && matches!(*field, "note" | "path")))
        .collect::<Vec<_>>();
    let mut input = json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    });
    if let (Some(input), Some(keywords)) = (input.as_object_mut(), keywords.as_object()) {
        for (keyword, value) in keywords {
            input.insert(keyword.clone(), value.clone());
        }
        if both_names && required_a_note && !input.contains_key("anyOf") {
            input.insert(
                "anyOf".to_owned(),
                json!([{ "required": ["note"] }, { "required": ["path"] }]),
            );
        }
    }
    json!({
        "name": name,
        "description": description,
        "inputSchema": input,
    })
}

pub fn version_name_property() -> Value {
    json!({ "type": "string", "description": "Название версии, которую создаст эта правка: в истории заметки она сразу будет под этим именем" })
}

pub fn write_retrying(
    core: &Core,
    note: &Path,
    source: Source,
    version_name: Option<&str>,
    next: impl Fn(&str) -> Result<String, String>,
) -> Result<(bool, String), String> {
    write_retrying_with_hash(core, note, source, version_name, None, next)
}

pub fn write_retrying_with_hash(
    core: &Core,
    note: &Path,
    source: Source,
    version_name: Option<&str>,
    expected_hash: Option<&str>,
    next: impl Fn(&str) -> Result<String, String>,
) -> Result<(bool, String), String> {
    let mut conflicts = 0;
    loop {
        let snapshot = read_file_snapshot_impl(note).map_err(|error| error.to_string())?;
        if let Some(expected) = expected_hash {
            if expected != snapshot.hash {
                return Err(
                    "Заметка изменилась после чтения: hash не совпал — перечитайте её и повторите правку"
                        .to_owned(),
                );
            }
        }
        let content = next(&snapshot.content)?;
        if content == snapshot.content {
            return Ok((false, content));
        }
        match gate::write(
            core,
            note,
            &content,
            Some(&snapshot.hash),
            source,
            version_name,
        ) {
            Ok(_) => return Ok((true, content)),
            Err(FileCommandError::Conflict { .. }) if conflicts < WRITE_CONFLICT_RETRIES => {
                conflicts += 1;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

pub fn open_after_write(core: &Core, vault: &Vault, note: &Path, arguments: &Value) {
    if vault.visible && flag(arguments, "open", false) && !core.active_note.is(note) {
        super::bridge::open_note_after_write(core, note);
    }
}

pub fn workspace_property() -> Value {
    json!({ "type": "string", "description": "База знаний, если не текущая: address из list_workspaces или полный путь" })
}

pub fn text(arguments: &Value, key: &str) -> Result<String, String> {
    optional_text(arguments, key)
        .or_else(|| alias(key).and_then(|other| optional_text(arguments, other)))
        .ok_or_else(|| missing(arguments, key))
}

fn alias(key: &str) -> Option<&'static str> {
    match key {
        "note" => Some("path"),
        "path" => Some("note"),
        _ => None,
    }
}

pub fn optional_text(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub fn content(arguments: &Value, key: &str) -> Result<String, String> {
    optional_content(arguments, key).ok_or_else(|| missing(arguments, key))
}

pub fn optional_content(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn missing(arguments: &Value, key: &str) -> String {
    let given = arguments
        .as_object()
        .map(|fields| fields.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if given.is_empty() {
        return format!("Не заполнен аргумент «{key}»: аргументов не передано вовсе");
    }
    format!(
        "Не заполнен аргумент «{key}»; переданы: {}",
        given.join(", ")
    )
}

pub fn optional_names(arguments: &Value, key: &str) -> Result<Option<Vec<String>>, String> {
    let Some(value) = arguments.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let list = value
        .as_array()
        .ok_or_else(|| format!("Аргумент «{key}» должен быть списком строк"))?;
    if list.is_empty() {
        return Err(format!("Список «{key}» пуст"));
    }
    list.iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("Аргумент «{key}»: строки списка не могут быть пустыми"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

pub fn flag(arguments: &Value, key: &str, fallback: bool) -> bool {
    arguments
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

pub fn offset(arguments: &Value) -> usize {
    arguments
        .get("offset")
        .and_then(Value::as_u64)
        .map_or(0, |value| usize::try_from(value).unwrap_or(usize::MAX))
}

pub fn limit(arguments: &Value, fallback: usize, maximum: usize) -> usize {
    arguments
        .get("limit")
        .and_then(Value::as_u64)
        .map_or(fallback, |value| value as usize)
        .clamp(1, maximum)
}

pub fn shorten(value: &str, maximum: usize) -> String {
    if value.chars().count() <= maximum {
        return value.to_owned();
    }
    let head = value.chars().take(maximum).collect::<String>();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::{optional_names, require_write, text, INSTRUCTIONS};
    use crate::app_core::{Core, EventSink};
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn path_from_a_search_result_works_as_note() {
        let found = json!({ "path": "Base/Заметка.md" });
        assert_eq!(text(&found, "note").unwrap(), "Base/Заметка.md");
        assert_eq!(
            text(&json!({ "note": "Заметка" }), "path").unwrap(),
            "Заметка"
        );
    }

    #[test]
    fn the_named_argument_wins_over_its_alias() {
        let both = json!({ "note": "Своя.md", "path": "Чужая.md" });
        assert_eq!(text(&both, "note").unwrap(), "Своя.md");
    }

    #[test]
    fn the_error_lists_the_arguments_that_did_arrive() {
        let error = text(&json!({ "heading": "Раздел" }), "note").unwrap_err();
        assert!(error.contains("note"), "названо недостающее поле: {error}");
        assert!(
            error.contains("heading"),
            "названо переданное поле: {error}"
        );
        assert!(text(&json!({}), "note")
            .unwrap_err()
            .contains("не передано"));
    }

    #[test]
    fn a_list_argument_is_absent_empty_or_valid() {
        assert!(optional_names(&json!({}), "notes").unwrap().is_none());
        assert!(optional_names(&json!({ "notes": null }), "notes")
            .unwrap()
            .is_none());
        assert!(optional_names(&json!({ "notes": [] }), "notes").is_err());
        assert!(optional_names(&json!({ "notes": "одна" }), "notes").is_err());
        assert!(optional_names(&json!({ "notes": ["a", " "] }), "notes").is_err());
        assert_eq!(
            optional_names(&json!({ "notes": ["a", " b "] }), "notes").unwrap(),
            Some(vec!["a".to_owned(), "b".to_owned()])
        );
    }

    #[test]
    fn mcp_user_messages_use_the_obsidium_name() {
        assert!(INSTRUCTIONS.contains("Проекты/Obsidium.md"));
        assert!(!INSTRUCTIONS.to_lowercase().contains(crate::legacy_name::LEGACY_APP_NAME));

        let directory = tempfile::tempdir().unwrap();
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let data = directory.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let core = Core::open(&data, events);
        let mut config = core.settings.get_config();
        config.mcp.allow_write = false;
        core.settings.update_config(config).unwrap();
        let error = require_write(&core).unwrap_err();
        core.shutdown();
        assert!(error.contains("Obsidium"), "{error}");
        assert!(!error.to_lowercase().contains(crate::legacy_name::LEGACY_APP_NAME), "{error}");
    }
}
