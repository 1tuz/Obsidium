use super::validate::{note_violations, resolve, type_of, validate_schema};
use super::{note_type, ObjectSchema, Violation, NOTE_TYPE};
use crate::search::fields::note_fields;

const LIBRARY: &str = r#"{
  "version": 1,
  "types": [
    {
      "name": "Entry",
      "properties": [{ "name": "rating", "kind": "number", "required": true }]
    },
    {
      "name": "Book",
      "extends": "Entry",
      "properties": [
        { "name": "author", "kind": "text", "required": true },
        { "name": "status", "kind": "select", "options": ["reading", "done"] },
        { "name": "tags", "kind": "tags" },
        { "name": "published", "kind": "date" },
        { "name": "links", "kind": "multiSelect", "options": ["a", "b"] },
        { "name": "finished", "kind": "checkbox" },
        { "name": "site", "kind": "url" },
        { "name": "phone", "kind": "phone" },
        { "name": "email", "kind": "email" }
      ]
    }
  ]
}"#;

fn schema(json: &str) -> ObjectSchema {
    serde_json::from_str(json).unwrap()
}

fn checked(json: &str) -> ObjectSchema {
    let schema = schema(json);
    validate_schema(&schema).unwrap();
    schema
}

fn violations(json: &str, note: &str) -> Vec<Violation> {
    note_violations(&checked(json), &note_fields(note))
}

fn reasons(found: &[Violation], property: &str) -> Vec<String> {
    found
        .iter()
        .filter(|violation| violation.property == property)
        .map(|violation| violation.reason.clone())
        .collect()
}

#[test]
fn the_built_in_note_type_has_no_properties() {
    assert_eq!(note_type().name, NOTE_TYPE);
    assert!(note_type().properties.is_empty());
}

#[test]
fn a_note_without_type_gets_note_and_no_violations() {
    let schema = checked(LIBRARY);
    let fields = note_fields("---\nauthor: кто угодно\nrating: не число\n---\n");

    assert_eq!(type_of(&schema, &fields), vec![note_type()]);
    assert!(note_violations(&schema, &fields).is_empty());
}

#[test]
fn a_note_is_checked_against_every_declared_type() {
    let schema = checked(LIBRARY);
    let fields = note_fields("---\ntype: [Book, Entry]\n---\n");

    let found = note_violations(&schema, &fields);

    assert_eq!(
        reasons(&found, "author"),
        vec!["обязательное свойство не заполнено"]
    );
    assert_eq!(
        reasons(&found, "rating"),
        vec!["обязательное свойство не заполнено"]
    );
    assert_eq!(found.len(), 2, "дубликат типа проверен один раз: {found:?}");
}

#[test]
fn an_unknown_type_is_a_violation_on_type() {
    let found = violations(LIBRARY, "---\ntype: Ghost\n---\n");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].property, "type");
    assert!(found[0].reason.contains("Ghost"), "{}", found[0].reason);
}

#[test]
fn required_properties_accept_a_filled_value_regardless_of_case() {
    let note = "---\ntype: Book\nAuthor: Иван Ефремов\nRating: 5\n---\n";

    assert!(violations(LIBRARY, note).is_empty());
}

#[test]
fn an_empty_schema_accepts_every_note_as_note() {
    let schema = ObjectSchema::default();
    let fields = note_fields("---\ntype: book\nauthor: кто угодно\n---\n");

    assert_eq!(type_of(&schema, &fields), vec![note_type()]);
    assert!(note_violations(&schema, &fields).is_empty());
}

#[test]
fn type_names_match_regardless_of_case() {
    let found = violations(LIBRARY, "---\ntype: book\nauthor: A\nrating: 5\n---\n");

    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn an_empty_required_value_counts_as_missing() {
    let note = "---\ntype: Book\nauthor:\nrating: 5\n---\n";

    let found = violations(LIBRARY, note);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].property, "author");
}

#[test]
fn a_number_property_rejects_text_and_accepts_a_decimal() {
    let text = violations(LIBRARY, "---\ntype: Book\nauthor: A\nrating: много\n---\n");
    assert_eq!(
        reasons(&text, "rating"),
        vec!["ожидалось число, получено «много»"]
    );

    assert!(violations(LIBRARY, "---\ntype: Book\nauthor: A\nrating: 4.5\n---\n").is_empty());
}

#[test]
fn a_text_property_rejects_a_list() {
    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: [Иван, Пётр]\nrating: 5\n---\n",
    );

    assert_eq!(
        reasons(&found, "author"),
        vec!["ожидался текст, получен список"]
    );
}

#[test]
fn a_select_property_only_accepts_its_options() {
    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nstatus: paused\n---\n",
    );
    assert_eq!(found.len(), 1);
    assert!(found[0].reason.contains("paused"), "{}", found[0].reason);

    assert!(violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nstatus: reading\n---\n"
    )
    .is_empty());
}

#[test]
fn a_multi_select_reports_the_value_outside_options() {
    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nlinks: [a, c]\n---\n",
    );

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].property, "links");
    assert!(found[0].reason.contains("«c»"), "{}", found[0].reason);
}

#[test]
fn a_checkbox_accepts_yaml_booleans_only() {
    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nfinished: maybe\n---\n",
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].property, "finished");

    assert!(violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nfinished: false\n---\n"
    )
    .is_empty());
}

#[test]
fn url_phone_and_email_have_their_own_shapes() {
    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\nsite: ftp://example\nphone: 12\nemail: nope\n---\n",
    );
    assert_eq!(reasons(&found, "site").len(), 1);
    assert_eq!(reasons(&found, "phone").len(), 1);
    assert_eq!(reasons(&found, "email").len(), 1);

    let good = "---\ntype: Book\nauthor: A\nrating: 5\nsite: https://obsidian.md\nphone: +7 (999) 123-45-67\nemail: reader@example.com\n---\n";
    assert!(violations(LIBRARY, good).is_empty());
}

#[test]
fn a_date_accepts_the_shared_grammar() {
    assert!(violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\npublished: 2026-10-25\n---\n"
    )
    .is_empty());
    assert!(violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\npublished: 25.10.2026\n---\n"
    )
    .is_empty());

    let found = violations(
        LIBRARY,
        "---\ntype: Book\nauthor: A\nrating: 5\npublished: 2026-02-31\n---\n",
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].property, "published");
}

#[test]
fn a_date_format_is_checked_when_declared() {
    const FORMATTED: &str = r#"{
      "version": 1,
      "types": [{ "name": "Book", "properties": [
        { "name": "published", "kind": "date", "format": "DD.MM.YYYY" }
      ]}]
    }"#;

    assert!(violations(FORMATTED, "---\ntype: Book\npublished: 25.10.2026\n---\n").is_empty());

    let found = violations(FORMATTED, "---\ntype: Book\npublished: 2026-10-25\n---\n");
    assert_eq!(found.len(), 1);
    assert!(
        found[0].reason.contains("DD.MM.YYYY"),
        "{}",
        found[0].reason
    );
}

#[test]
fn a_child_inherits_parent_properties_and_may_override_them() {
    const TYPES: &str = r#"{
      "version": 1,
      "types": [
        { "name": "Base", "properties": [
          { "name": "title", "kind": "text", "required": true },
          { "name": "rating", "kind": "number" }
        ]},
        { "name": "Child", "extends": "Base", "properties": [
          { "name": "title", "kind": "text", "required": false }
        ]}
      ]
    }"#;

    let schema = checked(TYPES);
    let child = resolve(&schema, "Child").unwrap();

    assert_eq!(child.properties.len(), 2);
    assert!(
        !child.properties[0].required,
        "свойство ребёнка переопределяет родителя"
    );
    assert_eq!(child.properties[1].name, "rating");
    assert!(note_violations(&schema, &note_fields("---\ntype: Child\n---\n")).is_empty());
    assert_eq!(
        reasons(
            &note_violations(&schema, &note_fields("---\ntype: Base\n---\n")),
            "title"
        ),
        vec!["обязательное свойство не заполнено"]
    );
}

#[test]
fn duplicate_type_names_are_rejected() {
    let error = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","properties":[]},{"name":"A","properties":[]}]}"#,
    ))
    .unwrap_err();

    assert!(error.to_string().contains("дважды"), "{error}");
}

#[test]
fn the_built_in_note_type_cannot_be_redefined() {
    let error = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"Note","properties":[]}]}"#,
    ))
    .unwrap_err();

    assert!(error.to_string().contains("встроенный"), "{error}");
}

#[test]
fn a_missing_parent_is_rejected() {
    let error = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","extends":"Ghost","properties":[]}]}"#,
    ))
    .unwrap_err();

    assert!(error.to_string().contains("Ghost"), "{error}");
}

#[test]
fn a_cycle_and_self_inheritance_are_rejected() {
    let cycle = validate_schema(&schema(
        r#"{"version":1,"types":[
            {"name":"A","extends":"B","properties":[]},
            {"name":"B","extends":"A","properties":[]}
        ]}"#,
    ))
    .unwrap_err();
    assert!(cycle.to_string().contains("зациклено"), "{cycle}");

    let itself = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","extends":"A","properties":[]}]}"#,
    ))
    .unwrap_err();
    assert!(itself.to_string().contains("сам себя"), "{itself}");
}

#[test]
fn duplicate_properties_and_missing_options_are_rejected() {
    let duplicate = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","properties":[
            {"name":"title","kind":"text"},
            {"name":"Title","kind":"number"}
        ]}]}"#,
    ))
    .unwrap_err();
    assert!(
        duplicate.to_string().contains("описано дважды"),
        "{duplicate}"
    );

    let select = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","properties":[
            {"name":"status","kind":"select"}
        ]}]}"#,
    ))
    .unwrap_err();
    assert!(select.to_string().contains("options"), "{select}");

    let text = validate_schema(&schema(
        r#"{"version":1,"types":[{"name":"A","properties":[
            {"name":"title","kind":"text","options":["a"]}
        ]}]}"#,
    ))
    .unwrap_err();
    assert!(text.to_string().contains("options"), "{text}");
}

#[test]
fn defaults_must_match_their_kind() {
    let cases = [
        r#"{"name":"n","kind":"number","default":"5"}"#,
        r#"{"name":"d","kind":"date","default":"завтра"}"#,
        r#"{"name":"c","kind":"checkbox","default":"yes"}"#,
        r#"{"name":"t","kind":"tags","default":5}"#,
        r#"{"name":"s","kind":"select","options":["a"],"default":"b"}"#,
        r#"{"name":"m","kind":"multiSelect","options":["a"],"default":["b"]}"#,
        r#"{"name":"u","kind":"url","default":"ftp://example"}"#,
        r#"{"name":"p","kind":"phone","default":"12"}"#,
        r#"{"name":"e","kind":"email","default":"nope"}"#,
    ];
    for property in cases {
        let json = format!(r#"{{"version":1,"types":[{{"name":"A","properties":[{property}]}}]}}"#);
        let error = validate_schema(&schema(&json)).unwrap_err();
        assert!(
            error.to_string().contains("значение по умолчанию"),
            "{property}: {error}"
        );
    }

    let good = r#"{"version":1,"types":[{"name":"A","properties":[
        {"name":"n","kind":"number","default":5},
        {"name":"d","kind":"date","format":"DD.MM.YYYY","default":"25.10.2026"},
        {"name":"c","kind":"checkbox","default":false},
        {"name":"t","kind":"tags","default":["a","b"]},
        {"name":"s","kind":"select","options":["a"],"default":"a"},
        {"name":"m","kind":"multiSelect","options":["a"],"default":["a"]},
        {"name":"u","kind":"url","default":"https://obsidian.md"},
        {"name":"p","kind":"phone","default":"+7 999 123-45-67"},
        {"name":"e","kind":"email","default":"reader@example.com"}
    ]}]}"#;
    validate_schema(&schema(good)).unwrap();
}

#[test]
fn an_unsupported_version_and_unknown_json_fields_are_rejected() {
    let version = validate_schema(&schema(r#"{"version":2,"types":[]}"#)).unwrap_err();
    assert!(version.to_string().contains("версия"), "{version}");

    assert!(
        serde_json::from_str::<ObjectSchema>(r#"{"version":1,"types":[],"extra":true}"#).is_err()
    );
    assert!(serde_json::from_str::<ObjectSchema>(
        r#"{"version":1,"types":[{"name":"A","properties":[{"name":"x","kind":"multi-select"}]}]}"#
    )
    .is_err());
}
