use super::super::vault::Vault;
use super::workspace::indexed_vault;
use super::{
    limit, offset, optional_text, require_write, text, tool, workspace_property,
    write_retrying_with_hash,
};
use crate::app_core::Core;
use crate::files::document::read_text;
use crate::history::Source;
use crate::search::paths::canonical_path;
use crate::search::tasks::edit::{self, Selector};
use crate::search::tasks::repository::{self, TaskFilter};
use serde_json::{json, Value};
use std::path::Path;

const LIST_LIMIT: usize = 100;
const LIST_MAXIMUM: usize = 500;

pub fn definitions() -> Vec<Value> {
    vec![
        tool(
            "list_tasks",
            "Задачи из чекбоксов заметок: можно взять одну заметку, папку или всю базу, отфильтровать по статусу и подстроке текста. taskId — устойчивый адрес задачи: он не меняется, когда выше появляются новые строки, и его принимают update_task, toggle_task и delete_task.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки, пусто — вся база или папка" },
                "folder": { "type": "string", "description": "Папка, пусто — вся база" },
                "status": { "type": "string", "enum": ["open", "done", "all"], "description": "open — незакрытые, done — закрытые, all — все (по умолчанию)" },
                "query": { "type": "string", "description": "Подстрока в тексте задачи" },
                "offset": { "type": "integer", "description": "Сколько задач пропустить, чтобы получить следующую страницу" },
                "limit": { "type": "integer", "description": "Сколько задач вернуть, по умолчанию 100, максимум 500" },
                "workspace": workspace_property(),
            }),
            &[],
        ),
        tool(
            "create_task",
            "Добавить задачу-чекбокс в заметку: в конец файла или первым пунктом указанного раздела. Служебные идентификаторы в markdown не пишутся — строка остаётся обычным «- [ ] Текст».",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "text": { "type": "string", "description": "Текст задачи" },
                "underHeading": { "type": "string", "description": "Заголовок раздела, куда вставить задачу; пусто — в конец заметки" },
                "expectedHash": { "type": "string", "description": "hash из read_note: если файл изменился, правка не применится" },
                "workspace": workspace_property(),
            }),
            &["note", "text"],
        ),
        tool(
            "update_task",
            "Изменить текст задачи, сохраняя отступ, маркер списка и состояние чекбокса. Задача адресуется taskId, а line — только подсказка: если по строке задача не совпала, поиск идёт по всему тексту заметки.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "taskId": { "type": "string", "description": "taskId из list_tasks; можно передать точный текст задачи" },
                "line": { "type": "integer", "description": "Номер строки (1-based) как подсказка, если taskId неизвестен" },
                "text": { "type": "string", "description": "Новый текст задачи" },
                "expectedHash": { "type": "string", "description": "hash из read_note: если файл изменился, правка не применится" },
                "workspace": workspace_property(),
            }),
            &["note", "text"],
        ),
        tool(
            "toggle_task",
            "Переключить чекбокс задачи: по умолчанию меняет «[ ]» на «[x]» и обратно, done задаёт состояние явно. Остальной текст строки не меняется.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "taskId": { "type": "string", "description": "taskId из list_tasks; можно передать точный текст задачи" },
                "line": { "type": "integer", "description": "Номер строки (1-based) как подсказка, если taskId неизвестен" },
                "done": { "type": "boolean", "description": "true — закрыть, false — открыть; пусто — переключить" },
                "expectedHash": { "type": "string", "description": "hash из read_note: если файл изменился, правка не применится" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
        tool(
            "delete_task",
            "Удалить строку задачи целиком; соседние строки и остальной файл остаются байт в байт. Задача адресуется taskId, line — только подсказка.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "taskId": { "type": "string", "description": "taskId из list_tasks; можно передать точный текст задачи" },
                "line": { "type": "integer", "description": "Номер строки (1-based) как подсказка, если taskId неизвестен" },
                "expectedHash": { "type": "string", "description": "hash из read_note: если файл изменился, правка не применится" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
    ]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "list_tasks" => list_tasks(core, arguments),
        "create_task" => create_task(core, arguments),
        "update_task" => update_task(core, arguments),
        "toggle_task" => toggle_task(core, arguments),
        "delete_task" => delete_task(core, arguments),
        _ => return None,
    })
}

fn list_tasks(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = indexed_vault(core, arguments)?;
    let status = optional_text(arguments, "status").unwrap_or_else(|| "all".to_owned());
    let done = match status.as_str() {
        "open" => Some(false),
        "done" => Some(true),
        "all" => None,
        other => {
            return Err(format!(
                "Неизвестный статус задач: {other}; допустимо open, done или all"
            ))
        }
    };
    let paths = match optional_text(arguments, "note") {
        Some(note) => Some(vec![canonical_path(&vault.note(core, &note)?)
            .to_string_lossy()
            .into_owned()]),
        None => match optional_text(arguments, "folder") {
            Some(folder) => {
                let folder = vault.folder(&folder)?;
                if !folder.is_dir() {
                    return Err(format!("Папка не найдена: {}", vault.relative(&folder)));
                }
                Some(
                    vault
                        .markdown_files()
                        .filter(|path| path.starts_with(&folder))
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect::<Vec<_>>(),
                )
            }
            None => None,
        },
    };
    let size = limit(arguments, LIST_LIMIT, LIST_MAXIMUM);
    let filter = TaskFilter {
        paths,
        done,
        text_contains: optional_text(arguments, "query"),
        offset: Some(offset(arguments)),
        limit: Some(size + 1),
    };
    let mut rows = core
        .search
        .with_metadata(&vault.root.to_string_lossy(), |_, connection| {
            repository::list(connection, &filter)
        })
        .map_err(|error| error.to_string())?;
    let has_more = rows.len() > size;
    rows.truncate(size);
    let tasks = rows
        .iter()
        .map(|row| {
            json!({
                "path": vault.relative(Path::new(&row.path)),
                "taskId": row.task_id,
                "line": row.line,
                "done": row.done,
                "text": row.text,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "tasks": tasks, "hasMore": has_more }))
}

fn create_task(core: &Core, arguments: &Value) -> Result<Value, String> {
    let task_text = text(arguments, "text")?;
    let heading = optional_text(arguments, "underHeading");
    mutate(core, arguments, move |body| {
        edit::create(body, &task_text, heading.as_deref()).map(|(next, _)| next)
    })
}

fn update_task(core: &Core, arguments: &Value) -> Result<Value, String> {
    let selector = selector(arguments);
    let new_text = text(arguments, "text")?;
    mutate(core, arguments, move |body| {
        edit::update(body, &selector, &new_text)
    })
}

fn toggle_task(core: &Core, arguments: &Value) -> Result<Value, String> {
    let selector = selector(arguments);
    let done = arguments.get("done").and_then(Value::as_bool);
    mutate(core, arguments, move |body| {
        edit::toggle(body, &selector, done)
    })
}

fn delete_task(core: &Core, arguments: &Value) -> Result<Value, String> {
    let selector = selector(arguments);
    mutate(core, arguments, move |body| edit::delete(body, &selector))
}

fn mutate(
    core: &Core,
    arguments: &Value,
    change: impl Fn(&str) -> Result<String, String>,
) -> Result<Value, String> {
    require_write(core)?;
    let vault = indexed_vault(core, arguments)?;
    let note = vault.note(core, &text(arguments, "note")?)?;
    let expected = optional_text(arguments, "expectedHash");
    let (changed, _) = write_retrying_with_hash(
        core,
        &note,
        Source::Agent,
        Some("Agent task"),
        expected.as_deref(),
        change,
    )?;
    let body = read_text(&note).map_err(|error| error.to_string())?;
    Ok(json!({
        "path": vault.relative(&note),
        "changed": changed,
        "tasks": tasks_json(&vault, &note, &body),
    }))
}

fn tasks_json(vault: &Vault, note: &Path, body: &str) -> Value {
    let tasks = edit::tasks_with_ids(body)
        .into_iter()
        .map(|(task, id)| {
            json!({
                "path": vault.relative(note),
                "taskId": id,
                "line": task.line,
                "done": task.done,
                "text": task.text,
            })
        })
        .collect::<Vec<_>>();
    Value::Array(tasks)
}

fn selector(arguments: &Value) -> Selector {
    Selector {
        task_id: optional_text(arguments, "taskId"),
        line: arguments
            .get("line")
            .and_then(Value::as_u64)
            .map(|value| value as usize),
    }
}

#[cfg(test)]
mod tests {
    use super::{definitions, selector};
    use serde_json::json;

    #[test]
    fn the_task_tools_are_registered_in_order() {
        let tools = definitions();
        let names = tools
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            [
                "list_tasks",
                "create_task",
                "update_task",
                "toggle_task",
                "delete_task"
            ]
        );
    }

    #[test]
    fn a_selector_keeps_the_id_and_the_line_hint() {
        let value = selector(&json!({ "taskId": "abc:1", "line": 4 }));
        assert_eq!(value.task_id.as_deref(), Some("abc:1"));
        assert_eq!(value.line, Some(4));
    }
}
