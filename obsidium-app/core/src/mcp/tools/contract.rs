use super::workspace_locator::wait_until;
use super::{call, definitions};
use crate::app_core::{Core, CoreEvent, EventSink};
use crate::files::document::hash_bytes;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const NOTE_A: &str = "---\ntitle: A\n---\nтело\n";
const INDEX_TIMEOUT: Duration = Duration::from_secs(20);

struct Fixture {
    core: Arc<Core>,
    root: PathBuf,
    navigations: Arc<Mutex<Vec<String>>>,
    _directory: tempfile::TempDir,
}

fn fixture() -> Fixture {
    fixture_with([("A.md".to_owned(), NOTE_A.to_owned())])
}

fn fixture_with(notes: impl IntoIterator<Item = (String, String)>) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let data = directory.path().join("data");
    let root = directory.path().join("vault");
    fs::create_dir_all(&data).unwrap();
    fs::create_dir_all(&root).unwrap();
    for (name, content) in notes {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
    }

    let navigations = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&navigations);
    let events: Arc<dyn EventSink> = Arc::new(move |event: CoreEvent| {
        if event.name() == "mcp-navigate" {
            seen.lock().unwrap().push(event.name().to_owned());
        }
    });
    let core = Core::open(&data, events);
    let root = crate::search::paths::canonical_path(&root);
    let path = root.to_string_lossy().into_owned();
    core.ui_state.resolve_workspace(&path, 1).unwrap();
    core.search.prepare(&path).unwrap();
    Fixture {
        core,
        root,
        navigations,
        _directory: directory,
    }
}

impl Fixture {
    fn wait_for_index(&self) {
        assert!(
            wait_until(INDEX_TIMEOUT, || !self.core.search.status(None).updating),
            "индекс не построился за отведённое время"
        );
    }

    fn paths(&self, answer: &Value) -> Vec<String> {
        answer["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|result| result["path"].as_str().unwrap().to_owned())
            .collect()
    }
}

fn definition(name: &str) -> Value {
    definitions()
        .into_iter()
        .find(|definition| definition["name"] == name)
        .unwrap_or_else(|| panic!("инструмент «{name}» не зарегистрирован"))
}

#[test]
fn tool_names_are_unique_and_required_fields_are_declared() {
    let mut names = HashSet::new();
    for definition in definitions() {
        let name = definition["name"].as_str().unwrap().to_owned();
        assert!(
            names.insert(name.clone()),
            "инструмент объявлен дважды: {name}"
        );
        let properties = definition["inputSchema"]["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{name}: properties не объект"));
        for required in definition["inputSchema"]["required"].as_array().unwrap() {
            let required = required.as_str().unwrap();
            assert!(
                properties.contains_key(required),
                "{name}: обязательное поле «{required}» не объявлено в properties"
            );
        }
    }
}

#[test]
fn every_note_tool_accepts_note_or_path_and_rejects_neither() {
    let fixture = fixture();
    let mut checked = 0;
    for definition in definitions() {
        let name = definition["name"].as_str().unwrap();
        let schema = &definition["inputSchema"];
        let properties = schema["properties"].as_object().unwrap();
        if !properties.contains_key("note") || !properties.contains_key("path") {
            continue;
        }
        if schema.get("anyOf").is_none() {
            continue;
        }
        for name_field in ["note", "path"] {
            let mut probe = json!({ name_field: "A" });
            for required in schema["required"].as_array().unwrap() {
                let required = required.as_str().unwrap();
                let kind = properties
                    .get(required)
                    .and_then(|property| property["type"].as_str())
                    .unwrap_or("string");
                let placeholder = match kind {
                    "integer" | "number" => json!(1),
                    "boolean" => json!(true),
                    "array" => json!([]),
                    "object" => json!({}),
                    _ => json!("x"),
                };
                probe[name_field] = json!("A");
                probe
                    .as_object_mut()
                    .unwrap()
                    .insert(required.to_owned(), placeholder);
            }
            validate(schema, &probe)
                .unwrap_or_else(|error| panic!("{name}: {name_field} отклонён схемой: {error}"));
        }
        let error = call(&fixture.core, name, &json!({}))
            .expect_err(&format!("{name}: вызов без note и path должен падать"));
        let mut allowed = vec!["note", "path"];
        allowed.extend(
            schema["required"]
                .as_array()
                .map(|fields| {
                    fields
                        .iter()
                        .filter_map(|field| field.as_str())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        );
        assert!(
            allowed.iter().any(|field| error.contains(field)),
            "{name}: ошибка не называет пропущенный аргумент ({allowed:?}): {error}"
        );
        checked += 1;
    }
    assert!(
        checked >= 25,
        "проверено слишком мало инструментов: {checked}"
    );
    fixture.core.shutdown();
}

#[test]
fn every_tool_names_its_missing_required_field() {
    let fixture = fixture();
    for definition in definitions() {
        let name = definition["name"].as_str().unwrap();
        let required = definition["inputSchema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|field| field.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        if required.is_empty() {
            continue;
        }
        let error = call(&fixture.core, name, &json!({}))
            .expect_err(&format!("{name}: вызов без аргументов должен падать"));
        let names_note = error.contains("note") || error.contains("path");
        assert!(
            names_note || required.iter().any(|field| error.contains(field.as_str())),
            "{name}: ошибка не называет обязательное поле ({required:?}): {error}"
        );
    }
    fixture.core.shutdown();
}

#[test]
fn read_note_accepts_a_batch_and_its_schema_allows_it() {
    let fixture = fixture();
    let schema = definition("read_note")["inputSchema"].clone();

    validate(&schema, &json!({ "notes": ["A"] })).unwrap();
    validate(&schema, &json!({ "note": "A" })).unwrap();
    validate(&schema, &json!({ "path": "A" })).unwrap();
    assert!(
        validate(&schema, &json!({})).is_err(),
        "вызов без note и notes не проходит anyOf"
    );

    let answer = call(&fixture.core, "read_note", &json!({ "notes": ["A"] })).unwrap();
    let notes = answer["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0]["path"], "A.md");
    assert!(notes[0]["content"].as_str().unwrap().contains("тело"));
    assert!(notes[0]["hash"]
        .as_str()
        .is_some_and(|hash| !hash.is_empty()));
    fixture.core.shutdown();
}

#[test]
fn read_note_returns_the_raw_byte_hash_and_guards_updates() {
    let fixture = fixture_with([(
        "C.md".to_owned(),
        "---\r\ntitle: C\r\n---\r\nтело\r\n".to_owned(),
    )]);
    let note = fixture.root.join("C.md");
    let read = call(&fixture.core, "read_note", &json!({ "note": "C.md" })).unwrap();
    let expected = hash_bytes(&fs::read(&note).unwrap());
    assert_eq!(read["hash"], expected);

    let stale = call(
        &fixture.core,
        "update_note",
        &json!({ "note": "C.md", "mode": "replace", "content": "новое", "expectedHash": "чужой" }),
    )
    .unwrap_err();
    assert!(stale.contains("hash"), "ошибка называет hash: {stale}");
    assert_eq!(
        fs::read_to_string(&note).unwrap(),
        "---\r\ntitle: C\r\n---\r\nтело\r\n",
        "устаревший hash не перезаписывает файл"
    );

    call(
        &fixture.core,
        "update_note",
        &json!({ "note": "C.md", "mode": "replace", "content": "новое", "expectedHash": expected }),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&note).unwrap(), "новое");
    fixture.core.shutdown();
}

#[test]
fn search_notes_pages_through_folder_hits_beyond_the_first_window() {
    let mut notes = (0..15)
        .map(|index| (format!("A{index:02}.md"), "маркер\n".to_owned()))
        .collect::<Vec<_>>();
    notes.extend((1..=3).map(|index| (format!("Zeta/note{index}.md"), "маркер\n".to_owned())));
    let fixture = fixture_with(notes);
    fixture.wait_for_index();

    let first = call(
        &fixture.core,
        "search_notes",
        &json!({ "query": "маркер", "folder": "Zeta", "limit": 2 }),
    )
    .unwrap();
    let first_paths = fixture.paths(&first);
    assert_eq!(first_paths.len(), 2, "на странице две заметки: {first}");
    assert!(first["hasMore"].as_bool().unwrap(), "есть третья: {first}");
    assert!(first_paths.iter().all(|path| path.starts_with("Zeta/")));

    let second = call(
        &fixture.core,
        "search_notes",
        &json!({ "query": "маркер", "folder": "Zeta", "offset": 2, "limit": 2 }),
    )
    .unwrap();
    let second_paths = fixture.paths(&second);
    assert_eq!(second_paths.len(), 1, "третья страница: {second}");
    assert!(!second["hasMore"].as_bool().unwrap());

    let mut all = first_paths.clone();
    all.extend(second_paths);
    all.sort();
    all.dedup();
    assert_eq!(
        all,
        [
            "Zeta/note1.md".to_owned(),
            "Zeta/note2.md".to_owned(),
            "Zeta/note3.md".to_owned()
        ]
    );

    let repeated = call(
        &fixture.core,
        "search_notes",
        &json!({ "query": "маркер", "folder": "Zeta", "limit": 2 }),
    )
    .unwrap();
    assert_eq!(
        fixture.paths(&repeated),
        first_paths,
        "повторный запрос отдаёт тот же порядок"
    );
    fixture.core.shutdown();
}

#[test]
fn search_notes_pages_past_the_hundredth_hit_without_duplicates() {
    let notes = (0..140)
        .map(|index| (format!("Batch/{index:03}.md"), "маркер\n".to_owned()))
        .collect::<Vec<_>>();
    let fixture = fixture_with(notes);
    fixture.wait_for_index();

    let mut seen = Vec::new();
    let mut offset = 0;
    loop {
        let page = call(
            &fixture.core,
            "search_notes",
            &json!({ "query": "маркер", "offset": offset, "limit": 50 }),
        )
        .unwrap();
        let paths = fixture.paths(&page);
        assert!(paths.len() <= 50, "страница не больше лимита: {page}");
        seen.extend(paths);
        if !page["hasMore"].as_bool().unwrap() {
            break;
        }
        offset += 50;
        assert!(offset < 500, "выдача обязана закончиться");
    }

    let unique = seen.iter().collect::<std::collections::HashSet<_>>().len();
    assert_eq!(seen.len(), 140, "страницы не повторяют и не теряют заметки");
    assert_eq!(unique, 140, "дубликатов между страницами нет");
    fixture.core.shutdown();
}

#[test]
fn set_frontmatter_writes_and_removes_list_values() {
    let fixture = fixture_with([
        (
            "B.md".to_owned(),
            "---\ntitle: B\n# комментарий\ntags: [old]\nstatus: draft\n---\nтело\n".to_owned(),
        ),
        (
            "D.md".to_owned(),
            "---\ntags:\n  - old1\n  - old2\nauthor: X\n---\nbody\n".to_owned(),
        ),
    ]);

    let written = call(
        &fixture.core,
        "set_frontmatter",
        &json!({
            "note": "B.md",
            "fields": { "tags": ["a", "b"], "related": ["[[C]]"] }
        }),
    )
    .unwrap();
    assert_eq!(written["frontmatter"]["tags"], json!(["a", "b"]));
    assert_eq!(
        fs::read_to_string(fixture.root.join("B.md")).unwrap(),
        "---\ntitle: B\n# комментарий\ntags:\n  - \"a\"\n  - \"b\"\nstatus: draft\nrelated:\n  - \"[[C]]\"\n---\nтело\n"
    );

    call(
        &fixture.core,
        "set_frontmatter",
        &json!({ "note": "D.md", "fields": { "tags": "single" } }),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("D.md")).unwrap(),
        "---\ntags: \"single\"\nauthor: X\n---\nbody\n",
        "строки старого блочного списка не остаются"
    );

    let removed = call(
        &fixture.core,
        "set_frontmatter",
        &json!({ "note": "B.md", "fields": { "tags": null } }),
    )
    .unwrap();
    assert!(removed["frontmatter"].get("tags").is_none());
    let text = fs::read_to_string(fixture.root.join("B.md")).unwrap();
    assert!(!text.contains("tags"));
    assert!(text.contains("related:\n  - \"[[C]]\""));
    assert!(text.ends_with("---\nтело\n"), "тело не тронуто: {text}");
    fixture.core.shutdown();
}

#[test]
fn writes_do_not_navigate_without_an_explicit_open() {
    let fixture = fixture();
    call(
        &fixture.core,
        "create_note",
        &json!({ "path": "Новая.md", "content": "x" }),
    )
    .unwrap();
    call(
        &fixture.core,
        "update_note",
        &json!({ "note": "Новая.md", "content": "y" }),
    )
    .unwrap();
    call(
        &fixture.core,
        "set_frontmatter",
        &json!({ "note": "Новая.md", "fields": { "tags": ["a"] } }),
    )
    .unwrap();
    assert!(
        fixture.navigations.lock().unwrap().is_empty(),
        "по умолчанию запись не открывает вкладку"
    );
    fixture.core.shutdown();
}

fn validate(schema: &Value, instance: &Value) -> Result<(), String> {
    if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
        if !any_of
            .iter()
            .any(|option| validate(option, instance).is_ok())
        {
            return Err("ни одна ветка anyOf не подошла".to_owned());
        }
    }
    if let (Some(object), Some(required)) = (
        instance.as_object(),
        schema.get("required").and_then(Value::as_array),
    ) {
        for required in required {
            let required = required.as_str().unwrap_or_default();
            if !object.contains_key(required) {
                return Err(format!("нет обязательного поля «{required}»"));
            }
        }
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("object") => {
            let object = instance.as_object().ok_or("ожидался объект")?;
            let properties = schema.get("properties").and_then(Value::as_object);
            if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
                for key in object.keys() {
                    if !properties.is_some_and(|properties| properties.contains_key(key)) {
                        return Err(format!("лишнее поле «{key}»"));
                    }
                }
            }
            for (key, value) in object {
                if let Some(property) = properties.and_then(|properties| properties.get(key)) {
                    validate(property, value)?;
                }
            }
        }
        Some("array") => {
            let items = instance.as_array().ok_or("ожидался массив")?;
            if let Some(item_schema) = schema.get("items") {
                for item in items {
                    validate(item_schema, item)?;
                }
            }
        }
        Some("string") => {
            instance.as_str().ok_or("ожидалась строка")?;
        }
        Some("integer") => {
            if instance.as_i64().is_none() && instance.as_u64().is_none() {
                return Err("ожидалось целое".to_owned());
            }
        }
        Some("boolean") => {
            instance.as_bool().ok_or("ожидалось логическое значение")?;
        }
        Some("number") => {
            instance.as_f64().ok_or("ожидалось число")?;
        }
        _ => {}
    }
    Ok(())
}
