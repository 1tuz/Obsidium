use super::{SchemaRegistry, SchemaStore};
use crate::schema::model::{note_type, ObjectSchema};
use crate::schema::SchemaError;
use crate::search::fields::note_fields;
use std::sync::Arc;

const BOOK: &str = r##"{
  "version": 1,
  "types": [
    {
      "name": "Book",
      "icon": "book",
      "color": "#c0a",
      "properties": [
        { "name": "author", "kind": "text", "required": true },
        { "name": "rating", "kind": "number" }
      ]
    }
  ]
}"##;

const FULL: &str = r##"{
  "version": 1,
  "types": [
    {
      "name": "Entry",
      "properties": [{ "name": "rating", "kind": "number", "default": 0 }]
    },
    {
      "name": "Book",
      "extends": "Entry",
      "icon": "book",
      "color": "#c0a",
      "properties": [
        { "name": "author", "kind": "text", "required": true },
        { "name": "published", "kind": "date", "format": "YYYY-MM-DD" },
        { "name": "tags", "kind": "tags", "default": ["fiction"] },
        { "name": "status", "kind": "select", "options": ["reading", "done"], "default": "reading" },
        { "name": "links", "kind": "multiSelect", "options": ["a", "b"] },
        { "name": "finished", "kind": "checkbox", "default": false },
        { "name": "site", "kind": "url", "default": "https://obsidian.md" },
        { "name": "phone", "kind": "phone", "default": "+7 (999) 123-45-67" },
        { "name": "email", "kind": "email", "default": "reader@example.com" }
      ]
    }
  ]
}"##;

fn schema(json: &str) -> ObjectSchema {
    serde_json::from_str(json).unwrap()
}

#[test]
fn a_vault_without_schema_has_no_types_and_every_note_is_note() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();

    let empty = registry.schema().unwrap();
    assert_eq!(empty.version, 1);
    assert!(empty.types.is_empty());
    assert_eq!(
        registry.path(),
        dir.path().join(".obsidium").join("schema.json")
    );
    assert!(!registry.path().exists());

    let fields = note_fields("---\ntitle: Идея\nauthor: кто угодно\n---\nтело\n");
    assert_eq!(registry.type_of(&fields).unwrap(), vec![note_type()]);
    assert!(registry.validate_note(&empty, &fields).is_empty());

    let book = note_fields("---\ntype: book\ncover: true\n---\nтело\n");
    assert_eq!(registry.type_of(&book).unwrap(), vec![note_type()]);
    assert!(registry.validate_note(&empty, &book).is_empty());
}

#[test]
fn save_writes_the_file_and_load_reads_it_back_without_loss() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();
    let original = schema(FULL);

    registry.save(&original).unwrap();

    assert!(dir.path().join(".obsidium").is_dir());
    let text = std::fs::read_to_string(registry.path()).unwrap();
    assert!(text.ends_with('\n'));
    assert!(text.contains("\"multiSelect\""));
    assert!(text.contains("\"extends\": \"Entry\""));

    let reloaded = SchemaRegistry::load(dir.path()).unwrap();
    assert_eq!(reloaded.schema().unwrap(), original);
    assert_eq!(reloaded.schema().unwrap().types.len(), 2);
}

#[test]
fn an_invalid_schema_is_reported_and_never_written() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();
    let broken = schema(
        r#"{"version":1,"types":[{"name":"Book","properties":[]},{"name":"Book","properties":[]}]}"#,
    );

    let error = registry.save(&broken).unwrap_err();

    assert!(matches!(error, SchemaError::Invalid { .. }));
    assert!(error.to_string().contains("дважды"), "{error}");
    assert!(!registry.path().exists());
}

#[test]
fn a_broken_file_is_an_error_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".obsidium")).unwrap();
    std::fs::write(dir.path().join(".obsidium").join("schema.json"), "{").unwrap();

    let error = SchemaRegistry::load(dir.path()).unwrap_err();

    assert!(matches!(error, SchemaError::Invalid { .. }));
    assert!(error.to_string().contains("schema.json"), "{error}");
}

#[test]
fn a_schema_broken_after_a_successful_load_reports_the_error() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();
    registry.save(&schema(BOOK)).unwrap();
    assert_eq!(registry.schema().unwrap().types.len(), 1);

    std::fs::write(registry.path(), "не json").unwrap();

    assert!(registry.schema().is_err());
}

#[test]
fn the_cache_follows_the_file_mtime_and_size() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();
    registry.save(&schema(BOOK)).unwrap();
    assert_eq!(registry.schema().unwrap().types[0].name, "Book");

    std::fs::write(registry.path(), r#"{"version":1,"types":[]}"#).unwrap();
    assert!(registry.schema().unwrap().types.is_empty());

    std::fs::write(
        registry.path(),
        r#"{"version":1,"types":[{"name":"Idea","properties":[]}]}"#,
    )
    .unwrap();
    assert_eq!(registry.schema().unwrap().types[0].name, "Idea");

    std::fs::remove_file(registry.path()).unwrap();
    assert!(registry.schema().unwrap().types.is_empty());
}

#[test]
fn type_of_resolves_declared_types_and_ignores_unknown_ones() {
    let dir = tempfile::tempdir().unwrap();
    let registry = SchemaRegistry::load(dir.path()).unwrap();
    registry.save(&schema(FULL)).unwrap();

    let book = note_fields("---\ntype: Book\n---\n");
    let found = registry.type_of(&book).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "Book");
    assert_eq!(
        found[0].properties.len(),
        10,
        "наследованное rating на месте"
    );

    let unknown = note_fields("---\ntype: Ghost\n---\n");
    assert!(registry.type_of(&unknown).unwrap().is_empty());
}

#[test]
fn the_store_reuses_one_registry_per_vault_root() {
    let dir = tempfile::tempdir().unwrap();
    let store = SchemaStore::new();

    let first = store.registry(dir.path()).unwrap();
    let second = store.registry(&dir.path().join(".")).unwrap();

    assert!(Arc::ptr_eq(&first, &second));
}
