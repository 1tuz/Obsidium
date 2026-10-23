use super::frontmatter;
use super::workspace::indexed_vault;
use super::{flag, limit, text, tool, workspace_property};
use crate::app_core::Core;
use crate::files::document::{read_file_snapshot_impl, read_text};
use crate::mcp::vault::Vault;
use crate::search::analysis::models::AnalysisMethod;
use crate::search::headings;
use crate::search::paths::canonical_path;
use crate::search::tasks::repository::{self, TaskFilter};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::path::Path;

const DEFAULT_LIMIT: usize = 20_000;
const MIN_LIMIT: usize = 1_000;
const MAX_LIMIT: usize = 60_000;
const RELATED_LIMIT: usize = 10;
const ALL_SECTIONS: [&str; 7] = [
    "frontmatter",
    "outline",
    "content",
    "tasks",
    "backlinks",
    "outgoing",
    "related",
];
const DROP_ORDER: [&str; 7] = [
    "content",
    "related",
    "backlinks",
    "outgoing",
    "tasks",
    "outline",
    "frontmatter",
];

pub fn definitions() -> Vec<Value> {
    vec![
        tool(
            "get_note_context",
            "Всё нужное о заметке за один вызов: frontmatter, оглавление с размером разделов, текст, задачи, входящие и исходящие ссылки, похожие заметки. Аргумент sections оставляет только перечисленные разделы. Ответ не превышает limit символов JSON: при нехватке места сначала убирается content, затем related и backlinks, а в полях truncated и omitted видно, что выпало.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "path": { "type": "string", "description": "Синоним note: путь заметки" },
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ALL_SECTIONS,
                    },
                    "description": "Какие разделы вернуть: frontmatter, outline, content, tasks, backlinks, outgoing, related; по умолчанию все",
                },
                "content": { "type": "boolean", "description": "Включать текст заметки; по умолчанию true" },
                "limit": { "type": "integer", "description": "Предел размера ответа в символах JSON, по умолчанию 20000, от 1000 до 60000" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
        tool(
            "query_notes",
            "Выполнить запрос dataview по заметкам базы: LIST, TABLE, TASK, FROM, WHERE, SORT, GROUP BY, FLATTEN и функции. Возвращает готовую таблицу или список. Справку по синтаксису даёт dataview_syntax.",
            json!({
                "query": { "type": "string", "description": "Текст запроса dataview, например LIST FROM \"Проекты\"" },
                "workspace": workspace_property(),
            }),
            &["query"],
        ),
    ]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "get_note_context" => get_note_context(core, arguments),
        "query_notes" => query_notes(core, arguments),
        _ => return None,
    })
}

fn get_note_context(core: &Core, arguments: &Value) -> Result<Value, String> {
    let name = text(arguments, "note")?;
    let vault = indexed_vault(core, arguments)?;
    let note = vault.note(core, &name)?;
    let snapshot = read_file_snapshot_impl(&note).map_err(|error| error.to_string())?;
    let body = snapshot.content;
    let limit = limit(arguments, DEFAULT_LIMIT, MAX_LIMIT).max(MIN_LIMIT);
    let chars = body.chars().count();

    let mut included = requested_sections(arguments)?;
    if !flag(arguments, "content", true) {
        included.retain(|section| *section != "content");
    }

    let mut fields = Map::new();
    fields.insert("path".to_owned(), json!(vault.relative(&note)));
    fields.insert("hash".to_owned(), json!(snapshot.hash));
    for section in &included {
        let value = match *section {
            "frontmatter" => frontmatter::map(&body),
            "outline" => outline(&body),
            "content" => Value::String(body.clone()),
            "tasks" => tasks(core, &vault, &note)?,
            "backlinks" => backlinks(core, &vault, &note)?,
            "outgoing" => outgoing(core, &vault, &note)?,
            "related" => related(core, &vault, &note)?,
            _ => unreachable!(),
        };
        fields.insert((*section).to_owned(), value);
    }
    fields.insert("chars".to_owned(), json!(chars));
    let mut answer = Value::Object(fields);

    let mut omitted = Vec::new();
    loop {
        let Some(fields) = answer.as_object_mut() else {
            return Err("Ответ контекста должен быть объектом".to_owned());
        };
        fields.insert("truncated".to_owned(), json!(!omitted.is_empty()));
        fields.insert("sections".to_owned(), json!(included));
        if omitted.is_empty() {
            fields.remove("omitted");
        } else {
            fields.insert("omitted".to_owned(), json!(omitted));
        }
        if json_chars(&answer)? <= limit {
            return Ok(answer);
        }
        let mut dropped = None;
        for name in DROP_ORDER {
            if included.contains(&name) {
                dropped = Some(name);
                break;
            }
        }
        let Some(dropped) = dropped else {
            return Err(format!(
                "Ответ не помещается в limit {limit}: уберите разделы из sections"
            ));
        };
        let Some(fields) = answer.as_object_mut() else {
            return Err("Ответ контекста должен быть объектом".to_owned());
        };
        fields.remove(dropped);
        included.retain(|section| *section != dropped);
        omitted.push(dropped);
    }
}

fn query_notes(core: &Core, arguments: &Value) -> Result<Value, String> {
    let query = text(arguments, "query")?;
    let vault = indexed_vault(core, arguments)?;
    let origin = core
        .active_note
        .get()
        .filter(|note| note.starts_with(&vault.root))
        .map(|note| vault.relative(&note))
        .unwrap_or_default();
    let output = core
        .search
        .run_dataview_query(&vault.root.to_string_lossy(), &origin, &query, 0)
        .map_err(|error| describe_error(&query, error.to_string()))?;
    serde_json::to_value(output).map_err(|error| error.to_string())
}

fn requested_sections(arguments: &Value) -> Result<Vec<&'static str>, String> {
    let Some(value) = arguments.get("sections") else {
        return Ok(ALL_SECTIONS.to_vec());
    };
    if value.is_null() {
        return Ok(ALL_SECTIONS.to_vec());
    }
    let list = value
        .as_array()
        .ok_or_else(|| "Аргумент «sections» должен быть списком строк".to_owned())?;
    let mut sections = Vec::new();
    for item in list {
        let name = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Аргумент «sections»: строки списка не могут быть пустыми".to_owned())?;
        let section = ALL_SECTIONS
            .iter()
            .copied()
            .find(|section| *section == name)
            .ok_or_else(|| {
                format!(
                    "Неизвестный раздел «{name}»; допустимо: {}",
                    ALL_SECTIONS.join(", ")
                )
            })?;
        if !sections.contains(&section) {
            sections.push(section);
        }
    }
    Ok(sections)
}

fn outline(body: &str) -> Value {
    Value::Array(
        headings::headings(body)
            .iter()
            .map(|heading| {
                json!({
                    "level": heading.level,
                    "title": heading.title,
                    "chars": body[heading.content.clone()].chars().count(),
                })
            })
            .collect(),
    )
}

fn tasks(core: &Core, vault: &Vault, note: &Path) -> Result<Value, String> {
    let filter = TaskFilter {
        paths: Some(vec![canonical_path(note).to_string_lossy().into_owned()]),
        done: None,
        text_contains: None,
        offset: None,
        limit: None,
    };
    let rows = core
        .search
        .with_metadata(&vault.root.to_string_lossy(), |_, connection| {
            repository::list(connection, &filter)
        })
        .map_err(|error| error.to_string())?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|row| {
                json!({
                    "taskId": row.task_id,
                    "line": row.line,
                    "done": row.done,
                    "text": row.text,
                })
            })
            .collect(),
    ))
}

fn backlinks(core: &Core, vault: &Vault, note: &Path) -> Result<Value, String> {
    let links = core
        .search
        .backlinks(&vault.root.to_string_lossy(), &note.to_string_lossy())
        .map_err(|error| error.to_string())?;
    let mut seen = Vec::<String>::new();
    let mut items = Vec::new();
    for link in links {
        if seen.contains(&link.path) {
            continue;
        }
        seen.push(link.path.clone());
        let (heading, context) = link_context(Path::new(&link.path), link.offset);
        items.push(json!({
            "path": vault.relative(Path::new(&link.path)),
            "heading": heading,
            "context": context,
        }));
    }
    Ok(Value::Array(items))
}

fn outgoing(core: &Core, vault: &Vault, note: &Path) -> Result<Value, String> {
    let links = core
        .search
        .outgoing_links(&vault.root.to_string_lossy(), &note.to_string_lossy())
        .map_err(|error| error.to_string())?;
    let mut seen = Vec::<String>::new();
    let mut items = Vec::new();
    for link in links {
        if seen.contains(&link.target) {
            continue;
        }
        seen.push(link.target.clone());
        let target = link.target;
        let path = link
            .path
            .as_deref()
            .map(|path| vault.relative(Path::new(path)));
        items.push(json!({ "target": target, "path": path }));
    }
    Ok(Value::Array(items))
}

struct RelatedItem {
    path: String,
    score: f64,
    reasons: Vec<String>,
    method: &'static str,
}

fn related(core: &Core, vault: &Vault, note: &Path) -> Result<Value, String> {
    let config = core.settings.get_config();
    let analysis = &config.analysis;
    let workspace = vault.root.to_string_lossy();
    let document = note.to_string_lossy();
    let mut merged = Vec::<RelatedItem>::new();
    for (method, label, enabled) in [
        (AnalysisMethod::Bm25f, "bm25f", analysis.enable_bm25f),
        (
            AnalysisMethod::AdamicAdar,
            "adamicAdar",
            analysis.enable_adamic_adar,
        ),
    ] {
        if !enabled {
            continue;
        }
        let results = core
            .search
            .analyze_document(&workspace, &document, method, Some(RELATED_LIMIT), &config)
            .map_err(|error| error.to_string())?;
        for result in results {
            let path = vault.relative(Path::new(&result.path));
            if let Some(position) = merged
                .iter()
                .position(|item| item.path.as_str() == path.as_str())
            {
                let item = &mut merged[position];
                if result.raw_score > item.score {
                    item.score = result.raw_score;
                    item.method = label;
                }
                for reason in result.reasons {
                    if !item.reasons.contains(&reason) {
                        item.reasons.push(reason);
                    }
                }
            } else {
                merged.push(RelatedItem {
                    path,
                    score: result.raw_score,
                    reasons: result.reasons,
                    method: label,
                });
            }
        }
    }
    merged.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.path.cmp(&right.path))
    });
    merged.truncate(RELATED_LIMIT);
    Ok(Value::Array(
        merged
            .into_iter()
            .map(|item| {
                json!({
                    "path": item.path,
                    "score": (item.score * 100.0).round() / 100.0,
                    "reasons": item.reasons,
                    "method": item.method,
                })
            })
            .collect(),
    ))
}

fn link_context(path: &Path, offset_utf16: usize) -> (Option<String>, Option<String>) {
    let Ok(text) = read_text(path) else {
        return (None, None);
    };
    let at = byte_at_utf16(&text, offset_utf16);
    let start = text[..at].rfind('\n').map_or(0, |index| index + 1);
    let end = text[at..].find('\n').map_or(text.len(), |index| at + index);
    let heading =
        headings::enclosing(&headings::headings(&text), at).map(|heading| heading.title.clone());
    (heading, Some(text[start..end].trim().to_owned()))
}

fn byte_at_utf16(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (byte, symbol) in text.char_indices() {
        if units >= offset {
            return byte;
        }
        units += symbol.len_utf16();
    }
    text.len()
}

fn json_chars(value: &Value) -> Result<usize, String> {
    serde_json::to_string(value)
        .map(|text| text.chars().count())
        .map_err(|error| error.to_string())
}

fn describe_error(query: &str, message: String) -> String {
    if message.contains("позиция") {
        return message;
    }
    let position = message
        .split_once('«')
        .and_then(|(_, rest)| rest.split_once('»'))
        .and_then(|(fragment, _)| query.find(fragment))
        .map(|byte| query[..byte].chars().count() + 1)
        .unwrap_or_else(|| query.chars().count() + 1);
    format!("{message} (позиция {position})")
}

#[cfg(test)]
mod tests {
    use super::call as dispatch;
    use crate::app_core::{Core, EventSink};
    use crate::search::models::SearchIndexState;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    fn call(core: &Core, name: &str, arguments: &Value) -> Result<Value, String> {
        dispatch(core, name, arguments)
            .unwrap_or_else(|| Err(format!("инструмент не зарегистрирован: {name}")))
    }

    const TARGET: &str = "---\nstatus: active\ntags: [проект]\n---\n# Обзор\n\nВводный текст.\n\n## Задачи\n\n- [ ] Первая\n- [x] Вторая\n\n## Связи\n\n[[Другая]]\n";

    fn fixture(files: &[(&str, &str)]) -> (tempfile::TempDir, Arc<Core>, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let root = directory.path().join("vault");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&root).unwrap();
        for (name, content) in files {
            let path = root.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let core = Core::open(&data, events);
        let root = crate::search::paths::canonical_path(&root);
        core.ui_state
            .resolve_workspace(&root.to_string_lossy(), 1)
            .unwrap();
        core.search.prepare(&root.to_string_lossy()).unwrap();
        wait_ready(&core, &root);
        (directory, core, root)
    }

    fn wait_ready(core: &Core, root: &Path) {
        let workspace = root.to_string_lossy().into_owned();
        for _ in 0..2000 {
            let status = core.search.status(Some(workspace.as_str()));
            if status.state == SearchIndexState::Ready && !status.updating {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("index did not finish the initial scan");
    }

    #[test]
    fn the_context_of_a_note_contains_every_requested_section() {
        let (_directory, core, _root) = fixture(&[
            ("Цель.md", TARGET),
            ("Источник.md", "Ссылка на [[Цель]] в тексте.\n"),
        ]);

        let answer = call(&core, "get_note_context", &json!({ "note": "Цель" })).unwrap();

        for section in [
            "frontmatter",
            "outline",
            "content",
            "tasks",
            "backlinks",
            "outgoing",
            "related",
        ] {
            assert!(
                answer.get(section).is_some(),
                "раздел {section} отсутствует: {answer}"
            );
        }
        assert_eq!(answer["frontmatter"]["status"], "active");
        assert_eq!(answer["outline"][0]["title"], "Обзор");
        assert_eq!(answer["tasks"].as_array().unwrap().len(), 2);
        assert!(answer["backlinks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["path"] == "Источник.md"));
        assert_eq!(answer["sections"].as_array().unwrap().len(), 7);
        core.shutdown();
    }

    #[test]
    fn sections_keep_only_the_named_parts() {
        let (_directory, core, _root) = fixture(&[("Цель.md", TARGET)]);

        let answer = call(
            &core,
            "get_note_context",
            &json!({ "note": "Цель", "sections": ["outline"] }),
        )
        .unwrap();

        assert_eq!(answer["sections"], json!(["outline"]));
        assert!(!answer["outline"].as_array().unwrap().is_empty());
        for section in [
            "frontmatter",
            "content",
            "tasks",
            "backlinks",
            "outgoing",
            "related",
        ] {
            assert!(
                answer.get(section).is_none(),
                "раздел {section} не запрашивали: {answer}"
            );
        }
        core.shutdown();
    }

    #[test]
    fn a_tiny_limit_drops_content_before_outline() {
        let long = format!("# Длинная\n\n{}\n", "текст ".repeat(500));
        let (_directory, core, _root) = fixture(&[("Длинная.md", long.as_str())]);

        let answer = call(
            &core,
            "get_note_context",
            &json!({ "note": "Длинная", "limit": 1000 }),
        )
        .unwrap();

        assert_eq!(answer["truncated"], true);
        assert!(answer.get("content").is_none(), "{answer}");
        assert!(answer.get("outline").is_some(), "{answer}");
        assert!(answer["omitted"]
            .as_array()
            .unwrap()
            .contains(&json!("content")));
        let size = serde_json::to_string(&answer).unwrap().chars().count();
        assert!(size <= 1000, "ответ больше limit: {size}");
        core.shutdown();
    }

    #[test]
    fn an_unknown_section_names_the_accepted_values() {
        let (_directory, core, _root) = fixture(&[("Цель.md", TARGET)]);

        let error = call(
            &core,
            "get_note_context",
            &json!({ "note": "Цель", "sections": ["outline", "нет"] }),
        )
        .unwrap_err();

        assert!(error.contains("нет"), "{error}");
        assert!(error.contains("frontmatter"), "{error}");
        assert!(error.contains("related"), "{error}");
        core.shutdown();
    }

    #[test]
    fn a_list_query_returns_the_indexed_rows() {
        let (_directory, core, _root) = fixture(&[("Первая.md", "# А\n"), ("Вторая.md", "# Б\n")]);

        let answer = call(&core, "query_notes", &json!({ "query": "LIST" })).unwrap();

        assert_eq!(answer["shape"], "list");
        assert_eq!(answer["total"], 2);
        assert!(answer["rows"].as_array().unwrap().len() >= 2);
        core.shutdown();
    }

    #[test]
    fn a_broken_query_reports_its_position() {
        let (_directory, core, _root) = fixture(&[("Первая.md", "# А\n")]);

        let error = call(&core, "query_notes", &json!({ "query": "LIST FROM" })).unwrap_err();

        assert!(error.contains("позиция"), "{error}");
        core.shutdown();
    }

    #[test]
    fn the_tools_are_registered_in_order() {
        let names = super::definitions()
            .iter()
            .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
            .collect::<Vec<_>>();
        assert_eq!(names, ["get_note_context", "query_notes"]);
    }
}
