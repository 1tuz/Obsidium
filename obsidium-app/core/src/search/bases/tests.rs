use super::*;
use serde_json::json;

const ROOT: &str = "/vault";

fn rows() -> Vec<(String, Map<String, Value>)> {
    vec![
        row(
            "/vault/Projects/A.md",
            json!({ "status": "doing", "priority": "2", "tags": ["project", "rust"] }),
        ),
        row(
            "/vault/Projects/B.md",
            json!({ "status": "done", "priority": "10", "tags": ["archive"] }),
        ),
    ]
}

fn row(path: &str, fields: Value) -> (String, Map<String, Value>) {
    (
        path.to_owned(),
        fields.as_object().cloned().unwrap_or_default(),
    )
}

fn query(value: Value) -> BaseQuery {
    serde_json::from_value(value).unwrap()
}

fn evaluation(
    filters: Value,
    sort: Value,
    rows: Vec<(String, Map<String, Value>)>,
) -> BaseEvaluation {
    let query = query(json!({
        "definition": {
            "filters": filters,
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name"] }],
        },
        "viewIndex": 0,
        "sort": sort,
    }));
    evaluate(Path::new(ROOT), rows, &query, None)
}

fn formulas_query(formulas: Value, view: Value, sort: Value) -> BaseQuery {
    query(json!({
        "definition": { "formulas": formulas, "views": [view] },
        "viewIndex": 0,
        "sort": sort,
    }))
}

fn paths(evaluation: &BaseEvaluation) -> Vec<&str> {
    evaluation
        .rows
        .iter()
        .map(|row| row.path.as_str())
        .collect()
}

#[test]
fn recursive_filters_and_file_helpers_match_the_typescript_cases() {
    let result = evaluation(
        json!({ "and": [
            "status != \"done\"",
            "file.hasTag(\"project\")",
            "file.inFolder(\"Projects\")",
        ] }),
        json!([]),
        rows(),
    );
    assert_eq!(paths(&result), vec!["/vault/Projects/A.md"]);
    assert!(!result.unsupported);
}

#[test]
fn unknown_expressions_keep_rows_visible_and_report_them() {
    let result = evaluation(json!("file.hasLink(\"Note\")"), json!([]), rows());
    assert_eq!(result.rows.len(), 2);
    assert!(result.unsupported);
}

#[test]
fn numeric_fields_sort_numerically() {
    let result = evaluation(
        json!(null),
        json!([{ "property": "priority", "direction": "DESC" }]),
        rows(),
    );
    assert_eq!(
        paths(&result),
        vec!["/vault/Projects/B.md", "/vault/Projects/A.md"]
    );
}

#[test]
fn file_properties_resolve_like_the_frontend_helper() {
    let name = evaluation(json!("file.name == \"A\""), json!([]), rows());
    assert_eq!(paths(&name), vec!["/vault/Projects/A.md"]);

    let path = evaluation(json!("file.path == \"Projects/A.md\""), json!([]), rows());
    assert_eq!(paths(&path), vec!["/vault/Projects/A.md"]);

    let folder = evaluation(json!("file.folder == \"Projects\""), json!([]), rows());
    assert_eq!(folder.rows.len(), 2);

    let extension = evaluation(json!("file.ext == \"md\""), json!([]), rows());
    assert_eq!(extension.rows.len(), 2);

    let missing = evaluation(json!("file.ext == \"base\""), json!([]), rows());
    assert!(missing.rows.is_empty());
}

#[test]
fn arrays_compare_by_membership() {
    let included = evaluation(json!("tags == \"rust\""), json!([]), rows());
    assert_eq!(paths(&included), vec!["/vault/Projects/A.md"]);

    let excluded = evaluation(json!("tags != \"rust\""), json!([]), rows());
    assert_eq!(paths(&excluded), vec!["/vault/Projects/B.md"]);
}

#[test]
fn numbers_compare_numerically_and_strings_ignore_case() {
    let numeric = evaluation(json!("priority >= 9"), json!([]), rows());
    assert_eq!(paths(&numeric), vec!["/vault/Projects/B.md"]);

    let exact = evaluation(json!("priority == 10"), json!([]), rows());
    assert_eq!(paths(&exact), vec!["/vault/Projects/B.md"]);

    let insensitive = evaluation(json!("status == \"DONE\""), json!([]), rows());
    assert_eq!(paths(&insensitive), vec!["/vault/Projects/B.md"]);

    let ordered = evaluation(json!("status < \"done\""), json!([]), rows());
    assert_eq!(paths(&ordered), vec!["/vault/Projects/A.md"]);
}

#[test]
fn note_prefix_reads_the_frontmatter_field() {
    let result = evaluation(json!("note.status == \"done\""), json!([]), rows());
    assert_eq!(paths(&result), vec!["/vault/Projects/B.md"]);
}

#[test]
fn or_and_not_combine_recursively() {
    let either = evaluation(
        json!({ "or": ["status == \"done\"", "priority == 2"] }),
        json!([]),
        rows(),
    );
    assert_eq!(either.rows.len(), 2);

    let negated = evaluation(json!({ "not": "status == \"done\"" }), json!([]), rows());
    assert_eq!(paths(&negated), vec!["/vault/Projects/A.md"]);

    let nested = evaluation(
        json!({ "not": [{ "or": ["status == \"done\"", "status == \"doing\""] }] }),
        json!([]),
        rows(),
    );
    assert!(nested.rows.is_empty());
    assert!(!nested.unsupported);
}

#[test]
fn unknown_operators_keep_rows_and_report_unsupported() {
    let result = evaluation(json!({ "file.hasLink": "Note" }), json!([]), rows());
    assert_eq!(result.rows.len(), 2);
    assert!(result.unsupported);
}

#[test]
fn unsupported_nested_operand_still_keeps_the_row_visible() {
    let result = evaluation(
        json!({ "or": ["status == \"doing\"", "file.hasLink(\"Note\")"] }),
        json!([]),
        rows(),
    );
    assert_eq!(result.rows.len(), 2);
    assert!(result.unsupported);

    let negated = evaluation(
        json!({ "not": "file.hasLink(\"Note\")" }),
        json!([]),
        rows(),
    );
    assert_eq!(negated.rows.len(), 2);
    assert!(negated.unsupported);
}

#[test]
fn contains_matches_scalars_and_array_items() {
    let scalar = evaluation(json!("status.contains(\"OI\")"), json!([]), rows());
    assert_eq!(paths(&scalar), vec!["/vault/Projects/A.md"]);

    let array = evaluation(json!("tags.contains(\"rus\")"), json!([]), rows());
    assert_eq!(paths(&array), vec!["/vault/Projects/A.md"]);
}

#[test]
fn has_tag_matches_nested_tags() {
    let result = evaluation(
        json!("file.hasTag(\"project\")"),
        json!([]),
        vec![row("/vault/N.md", json!({ "tags": ["#board/доска"] }))],
    );
    assert!(result.rows.is_empty());

    let nested = evaluation(
        json!("file.hasTag(\"#board\")"),
        json!([]),
        vec![row("/vault/N.md", json!({ "tags": "#board/доска" }))],
    );
    assert_eq!(paths(&nested), vec!["/vault/N.md"]);
}

#[test]
fn view_filters_combine_with_global_filters() {
    let query = query(json!({
        "definition": {
            "filters": "status != \"done\"",
            "views": [{
                "type": "table",
                "name": "Overview",
                "order": ["file.name"],
                "filters": "priority == 2",
            }],
        },
        "viewIndex": 0,
    }));
    let result = evaluate(Path::new(ROOT), rows(), &query, None);
    assert_eq!(paths(&result), vec!["/vault/Projects/A.md"]);
}

#[test]
fn unsupported_definition_keys_and_formula_columns_flag_the_result() {
    let keys = query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name"] }],
            "unsupportedKeys": ["pluginField"],
        },
        "viewIndex": 0,
    }));
    assert!(evaluate(Path::new(ROOT), rows(), &keys, None).unsupported);

    let formula = query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name", "formula.total"] }],
        },
        "viewIndex": 0,
    }));
    let result = evaluate(Path::new(ROOT), rows(), &formula, None);
    assert!(!result.unsupported);
    assert!(result.columns.contains(&"formula.total".to_owned()));
}

#[test]
fn columns_follow_the_view_order_or_the_first_discovered_properties() {
    let ordered = query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name", "status"] }],
        },
        "viewIndex": 0,
    }));
    assert_eq!(
        evaluate(Path::new(ROOT), rows(), &ordered, None).columns,
        vec!["file.name", "status"]
    );

    let discovered = query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview" }],
        },
        "viewIndex": 0,
    }));
    let columns = evaluate(Path::new(ROOT), rows(), &discovered, None).columns;
    assert_eq!(columns.first().map(String::as_str), Some("file.name"));
    let mut rest = columns[1..].to_vec();
    rest.sort();
    assert_eq!(rest, vec!["priority", "status", "tags"]);
}

#[test]
fn limit_applies_after_sorting() {
    let query = query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name"], "limit": 1 }],
        },
        "viewIndex": 0,
    }));
    let result = evaluate(Path::new(ROOT), rows(), &query, None);
    assert_eq!(paths(&result), vec!["/vault/Projects/A.md"]);
}

#[test]
fn default_sort_uses_natural_file_names() {
    let result = evaluation(
        json!(null),
        json!([]),
        vec![
            row("/vault/note 10.md", json!({})),
            row("/vault/note 2.md", json!({})),
            row("/vault/Note 1.md", json!({})),
        ],
    );
    assert_eq!(
        paths(&result),
        vec!["/vault/Note 1.md", "/vault/note 2.md", "/vault/note 10.md"]
    );
}

#[test]
fn missing_values_sort_first_and_descending_reverses() {
    let data = vec![
        row("/vault/A.md", json!({ "status": "beta" })),
        row("/vault/B.md", json!({})),
        row("/vault/C.md", json!({ "status": "alpha" })),
    ];
    let ascending = evaluation(
        json!(null),
        json!([{ "property": "status", "direction": "ASC" }]),
        data.clone(),
    );
    assert_eq!(
        paths(&ascending),
        vec!["/vault/B.md", "/vault/C.md", "/vault/A.md"]
    );

    let descending = evaluation(
        json!(null),
        json!([{ "property": "status", "direction": "DESC" }]),
        data,
    );
    assert_eq!(
        paths(&descending),
        vec!["/vault/A.md", "/vault/C.md", "/vault/B.md"]
    );
}

#[test]
fn groups_follow_the_configured_order_then_the_label() {
    let data = vec![
        row("/vault/A.md", json!({ "status": "doing" })),
        row("/vault/B.md", json!({ "status": "done" })),
        row("/vault/C.md", json!({})),
        row("/vault/D.md", json!({ "status": "todo" })),
    ];
    let query = query(json!({
        "definition": {
            "views": [{
                "type": "table",
                "name": "Overview",
                "order": ["file.name"],
                "groupBy": { "property": "status", "direction": "ASC" },
                "groupOrder": ["done", "todo"],
            }],
        },
        "viewIndex": 0,
    }));
    let result = evaluate(Path::new(ROOT), data, &query, None);
    assert_eq!(
        paths(&result),
        vec!["/vault/B.md", "/vault/D.md", "/vault/C.md", "/vault/A.md",]
    );
    let labels = result
        .groups
        .iter()
        .map(|group| group.label.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(labels, vec!["done", "todo", "", "doing"]);
    assert_eq!(
        result
            .groups
            .iter()
            .map(|group| (group.start, group.end))
            .collect::<Vec<_>>(),
        vec![(0, 1), (1, 2), (2, 3), (3, 4)]
    );
}

#[test]
fn descending_groups_reverse_only_the_observed_labels() {
    let data = vec![
        row("/vault/A.md", json!({ "status": "doing" })),
        row("/vault/B.md", json!({ "status": "done" })),
        row("/vault/C.md", json!({})),
        row("/vault/D.md", json!({ "status": "todo" })),
    ];
    let query = query(json!({
        "definition": {
            "views": [{
                "type": "table",
                "name": "Overview",
                "order": ["file.name"],
                "groupBy": { "property": "status", "direction": "DESC" },
            }],
        },
        "viewIndex": 0,
    }));
    let labels = evaluate(Path::new(ROOT), data, &query, None)
        .groups
        .iter()
        .map(|group| group.label.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(labels, vec!["todo", "done", "doing", ""]);
}

#[test]
fn a_view_without_grouping_returns_a_single_range() {
    let result = evaluation(json!(null), json!([]), rows());
    assert_eq!(result.groups.len(), 1);
    assert!(result.groups[0].label.is_none());
    assert_eq!(result.groups[0].start, 0);
    assert_eq!(result.groups[0].end, 2);
}

#[test]
fn empty_definitions_and_out_of_range_views_stay_safe() {
    let empty = query(json!({ "definition": { "views": [] }, "viewIndex": 0 }));
    let result = evaluate(Path::new(ROOT), rows(), &empty, None);
    assert!(result.rows.is_empty());
    assert!(result.groups.is_empty());
    assert!(result.columns.is_empty());

    let clamped = query(json!({
        "definition": {
            "views": [
                { "type": "table", "name": "First", "order": ["file.name"], "filters": "status == \"done\"" },
                { "type": "table", "name": "Second", "order": ["status"], "filters": "status == \"doing\"" },
            ],
        },
        "viewIndex": 9,
    }));
    let result = evaluate(Path::new(ROOT), rows(), &clamped, None);
    assert_eq!(paths(&result), vec!["/vault/Projects/A.md"]);
    assert_eq!(result.columns, vec!["status"]);
}

#[test]
fn numeric_literals_accept_decimals_but_not_exponents() {
    let data = vec![row("/vault/A.md", json!({ "score": "1.5" }))];
    let decimal = evaluation(json!("score > 1.4"), json!([]), data.clone());
    assert_eq!(decimal.rows.len(), 1);

    let exponent = evaluation(json!("score == 1e5"), json!([]), data);
    assert!(exponent.rows.is_empty());
    assert!(!exponent.unsupported);
}

#[test]
fn formulas_compute_arithmetic_for_every_row() {
    let result = evaluate(
        Path::new(ROOT),
        rows(),
        &formulas_query(
            json!({ "total": "priority * 2" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.total"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert!(result.errors.is_empty());
    let totals = result
        .rows
        .iter()
        .map(|row| row.fields.get("formula.total").and_then(Value::as_f64))
        .collect::<Vec<_>>();
    assert_eq!(totals, vec![Some(4.0), Some(20.0)]);
}

#[test]
fn formulas_pick_the_if_branch_and_evaluate_it_lazily() {
    let data = vec![
        row("/vault/A.md", json!({ "priority": "2" })),
        row("/vault/B.md", json!({ "priority": "high" })),
    ];
    let result = evaluate(
        Path::new(ROOT),
        data,
        &formulas_query(
            json!({ "risk": "if(priority == \"high\", 1, 0)" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.risk"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let risks = result
        .rows
        .iter()
        .map(|row| row.fields.get("formula.risk").and_then(Value::as_f64))
        .collect::<Vec<_>>();
    assert_eq!(risks, vec![Some(0.0), Some(1.0)]);

    let lazy = evaluate(
        Path::new(ROOT),
        vec![row("/vault/A.md", json!({ "priority": "2" }))],
        &formulas_query(
            json!({ "value": "if(true, 1, nosuchfunction(1))" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.value"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!lazy.unsupported);
    assert!(lazy.errors.is_empty());
    assert_eq!(
        lazy.rows[0]
            .fields
            .get("formula.value")
            .and_then(Value::as_f64),
        Some(1.0)
    );
}

#[test]
fn formulas_call_string_functions() {
    let result = evaluate(
        Path::new(ROOT),
        rows(),
        &formulas_query(
            json!({ "label": "upper(status)" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.label"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert!(result.errors.is_empty());
    let labels = result
        .rows
        .iter()
        .map(|row| row.fields.get("formula.label").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(labels, vec![Some("DOING"), Some("DONE")]);
}

#[test]
fn formulas_treat_missing_properties_as_null() {
    let result = evaluate(
        Path::new(ROOT),
        rows(),
        &formulas_query(
            json!({ "double": "missing_prop * 2" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.double"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert!(result.errors.is_empty());
    for row in &result.rows {
        assert_eq!(row.fields.get("formula.double"), Some(&Value::Null));
    }
}

#[test]
fn broken_formulas_become_null_and_report_one_error_each() {
    let result = evaluate(
        Path::new(ROOT),
        rows(),
        &formulas_query(
            json!({ "bad": "nosuchfunction(1)", "broken": "1 +" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name", "formula.bad", "formula.broken"],
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert_eq!(result.rows.len(), 2);
    for row in &result.rows {
        assert_eq!(row.fields.get("formula.bad"), Some(&Value::Null));
        assert_eq!(row.fields.get("formula.broken"), Some(&Value::Null));
    }
    assert_eq!(result.errors.len(), 2);
    assert!(result.errors.iter().any(|error| error.formula == "bad"));
    assert!(result
        .errors
        .iter()
        .any(|error| error.formula == "broken" && error.path.is_empty()));
}

#[test]
fn sorting_by_a_formula_property_orders_computed_values() {
    let data = vec![
        row("/vault/A.md", json!({ "priority": "2" })),
        row("/vault/B.md", json!({ "priority": "high" })),
    ];
    let result = evaluate(
        Path::new(ROOT),
        data,
        &formulas_query(
            json!({ "risk": "if(priority == \"high\", 1, 0)" }),
            json!({ "type": "table", "name": "Overview", "order": ["file.name"] }),
            json!([{ "property": "formula.risk", "direction": "DESC" }]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert_eq!(paths(&result), vec!["/vault/B.md", "/vault/A.md"]);
}

#[test]
fn filtering_by_a_formula_property_uses_the_computed_value() {
    let data = vec![
        row("/vault/A.md", json!({ "priority": "2" })),
        row("/vault/B.md", json!({ "priority": "high" })),
    ];
    let result = evaluate(
        Path::new(ROOT),
        data,
        &formulas_query(
            json!({ "risk": "if(priority == \"high\", 1, 0)" }),
            json!({
                "type": "table",
                "name": "Overview",
                "order": ["file.name"],
                "filters": "formula.risk == 1",
            }),
            json!([]),
        ),
        None,
    );
    assert!(!result.unsupported);
    assert_eq!(paths(&result), vec!["/vault/B.md"]);
}
fn wiki_connection(documents: &[(&str, &str)]) -> rusqlite::Connection {
    let mut connection = rusqlite::Connection::open_in_memory().unwrap();
    crate::search::wiki::open_schema(&connection).unwrap();
    let transaction = connection.transaction().unwrap();
    for (path, body) in documents {
        crate::search::wiki::index_document(&transaction, Path::new(ROOT), Path::new(path), body)
            .unwrap();
    }
    transaction.commit().unwrap();
    connection
}

fn summary_query(summaries: Value) -> BaseQuery {
    query(json!({
        "definition": {
            "views": [{ "type": "table", "name": "Overview", "order": ["file.name"] }],
            "summaries": summaries,
        },
        "viewIndex": 0,
    }))
}

fn summary<'a>(evaluation: &'a BaseEvaluation, path: &str, name: &str) -> &'a Value {
    evaluation
        .rows
        .iter()
        .find(|row| row.path == path)
        .unwrap()
        .fields
        .get(&format!("summary.{name}"))
        .unwrap()
}

const LIST: &str = "/vault/List.md";
const BOOK_A: &str = "/vault/Books/A.md";
const BOOK_B: &str = "/vault/Books/B.md";
const BOOK_C: &str = "/vault/Books/C.md";

fn book_rows() -> Vec<(String, Map<String, Value>)> {
    vec![
        row(LIST, json!({})),
        row(BOOK_A, json!({ "price": 10 })),
        row(BOOK_B, json!({ "price": 20 })),
        row(BOOK_C, json!({ "price": 30 })),
    ]
}

fn book_connection() -> rusqlite::Connection {
    wiki_connection(&[
        (LIST, "[[Books/A]] [[Books/B]] [[Books/C]]"),
        (BOOK_A, "a"),
        (BOOK_B, "b"),
        (BOOK_C, "c"),
    ])
}

#[test]
fn summaries_aggregate_all_formulas_over_links() {
    let connection = book_connection();
    let query = summary_query(json!([
        { "name": "total", "source": "file.links", "property": "price", "formula": "sum" },
        { "name": "mean", "source": "file.links", "property": "price", "formula": "avg" },
        { "name": "low", "source": "file.links", "property": "price", "formula": "min" },
        { "name": "high", "source": "file.links", "property": "price", "formula": "max" },
        { "name": "amount", "source": "file.links", "property": "price", "formula": "count" },
        { "name": "prices", "source": "file.links", "property": "price", "formula": "list" },
    ]));
    let result = evaluate(Path::new(ROOT), book_rows(), &query, Some(&connection));
    assert!(!result.unsupported);
    assert_eq!(summary(&result, LIST, "total"), &json!(60.0));
    assert_eq!(summary(&result, LIST, "mean"), &json!(20.0));
    assert_eq!(summary(&result, LIST, "low"), &json!(10.0));
    assert_eq!(summary(&result, LIST, "high"), &json!(30.0));
    assert_eq!(summary(&result, LIST, "amount"), &json!(3.0));
    assert_eq!(summary(&result, LIST, "prices"), &json!([10, 20, 30]));
}

#[test]
fn property_sources_resolve_wiki_links_and_plain_names() {
    let connection = wiki_connection(&[(BOOK_A, "a"), (BOOK_B, "b")]);
    let rows = vec![
        row(
            "/vault/Note.md",
            json!({ "related": ["[[Books/A]]", "Books/B"] }),
        ),
        row(BOOK_A, json!({ "price": 10 })),
        row(BOOK_B, json!({ "price": 20 })),
    ];
    let query = summary_query(json!([
        { "name": "total", "source": "related", "property": "price", "formula": "sum" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, "/vault/Note.md", "total"), &json!(30.0));
    assert!(!result.unsupported);
}

#[test]
fn backlinks_source_aggregates_incoming_notes() {
    let connection = wiki_connection(&[
        ("/vault/Hub.md", "hub"),
        ("/vault/X.md", "[[Hub]]"),
        ("/vault/Y.md", "[[Hub]]"),
    ]);
    let rows = vec![
        row("/vault/Hub.md", json!({})),
        row("/vault/X.md", json!({ "price": 5 })),
        row("/vault/Y.md", json!({ "price": 7 })),
    ];
    let query = summary_query(json!([
        { "name": "total", "source": "file.backlinks", "property": "price", "formula": "sum" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, "/vault/Hub.md", "total"), &json!(12.0));
    assert!(!result.unsupported);
}

#[test]
fn empty_related_sets_return_neutral_values() {
    let connection = wiki_connection(&[("/vault/Empty.md", "no links")]);
    let rows = vec![row("/vault/Empty.md", json!({}))];
    let query = summary_query(json!([
        { "name": "total", "source": "file.links", "property": "price", "formula": "sum" },
        { "name": "mean", "source": "file.links", "property": "price", "formula": "avg" },
        { "name": "low", "source": "file.links", "property": "price", "formula": "min" },
        { "name": "high", "source": "file.links", "property": "price", "formula": "max" },
        { "name": "amount", "source": "file.links", "property": "price", "formula": "count" },
        { "name": "prices", "source": "file.links", "property": "price", "formula": "list" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, "/vault/Empty.md", "total"), &Value::Null);
    assert_eq!(summary(&result, "/vault/Empty.md", "mean"), &Value::Null);
    assert_eq!(summary(&result, "/vault/Empty.md", "low"), &Value::Null);
    assert_eq!(summary(&result, "/vault/Empty.md", "high"), &Value::Null);
    assert_eq!(summary(&result, "/vault/Empty.md", "amount"), &json!(0.0));
    assert_eq!(summary(&result, "/vault/Empty.md", "prices"), &json!([]));
    assert!(!result.unsupported);
}

#[test]
fn broken_links_are_skipped_without_flagging_unsupported() {
    let connection = wiki_connection(&[(LIST, "[[Missing]] [[Books/A]]"), (BOOK_A, "a")]);
    let rows = vec![row(LIST, json!({})), row(BOOK_A, json!({ "price": 10 }))];
    let query = summary_query(json!([
        { "name": "total", "source": "file.links", "property": "price", "formula": "sum" },
        { "name": "amount", "source": "file.links", "property": "price", "formula": "count" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, LIST, "total"), &json!(10.0));
    assert_eq!(summary(&result, LIST, "amount"), &json!(1.0));
    assert!(!result.unsupported);
}

#[test]
fn missing_properties_aggregate_to_null() {
    let connection = wiki_connection(&[(LIST, "[[Books/A]]"), (BOOK_A, "a")]);
    let rows = vec![row(LIST, json!({})), row(BOOK_A, json!({ "title": "A" }))];
    let query = summary_query(json!([
        { "name": "total", "source": "file.links", "property": "price", "formula": "sum" },
        { "name": "prices", "source": "file.links", "property": "price", "formula": "list" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, LIST, "total"), &Value::Null);
    assert_eq!(summary(&result, LIST, "prices"), &json!([]));
    assert!(!result.unsupported);
}

#[test]
fn unknown_formulas_flag_the_evaluation() {
    let connection = book_connection();
    let query = summary_query(json!([
        { "name": "median", "source": "file.links", "property": "price", "formula": "median" },
    ]));
    let result = evaluate(Path::new(ROOT), book_rows(), &query, Some(&connection));
    assert_eq!(summary(&result, LIST, "median"), &Value::Null);
    assert!(result.unsupported);
}

#[test]
fn summary_filters_narrow_related_notes() {
    let connection = wiki_connection(&[
        (LIST, "[[Books/A]] [[Books/B]]"),
        (BOOK_A, "a"),
        (BOOK_B, "b"),
    ]);
    let rows = vec![
        row(LIST, json!({})),
        row(BOOK_A, json!({ "price": 10, "genre": "sci" })),
        row(BOOK_B, json!({ "price": 20, "genre": "history" })),
    ];
    let query = summary_query(json!([
        {
            "name": "total",
            "source": "file.links",
            "property": "price",
            "formula": "sum",
            "filter": "genre == \"sci\"",
        },
        { "name": "amount", "source": "file.links", "property": "price", "formula": "count", "filter": "genre == \"sci\"" },
    ]));
    let result = evaluate(Path::new(ROOT), rows, &query, Some(&connection));
    assert_eq!(summary(&result, LIST, "total"), &json!(10.0));
    assert_eq!(summary(&result, LIST, "amount"), &json!(1.0));
    assert!(!result.unsupported);
}

#[test]
fn repeated_evaluations_share_consistent_summaries() {
    let connection = book_connection();
    let query = summary_query(json!([
        { "name": "total", "source": "file.links", "property": "price", "formula": "sum" },
        { "name": "amount", "source": "file.links", "property": "price", "formula": "count" },
        { "name": "prices", "source": "file.links", "property": "price", "formula": "list" },
    ]));
    let first = evaluate(Path::new(ROOT), book_rows(), &query, Some(&connection));
    let second = evaluate(Path::new(ROOT), book_rows(), &query, Some(&connection));
    assert_eq!(summary(&first, LIST, "total"), &json!(60.0));
    assert_eq!(summary(&first, LIST, "prices"), &json!([10, 20, 30]));
    assert_eq!(summary(&first, LIST, "amount"), &json!(3.0));
    assert_eq!(
        summary(&second, LIST, "total"),
        summary(&first, LIST, "total")
    );
    assert_eq!(first.rows.len(), second.rows.len());
    for (left, right) in first.rows.iter().zip(&second.rows) {
        assert_eq!(left.path, right.path);
        assert_eq!(left.fields, right.fields);
    }
}

#[test]
fn summaries_feed_filters_and_sorting() {
    let connection = book_connection();
    let query = query(json!({
        "definition": {
            "filters": "summary.total >= 60",
            "views": [{
                "type": "table",
                "name": "Overview",
                "order": ["file.name"],
                "sort": [{ "property": "summary.total", "direction": "DESC" }],
            }],
            "summaries": [{
                "name": "total",
                "source": "file.links",
                "property": "price",
                "formula": "sum",
            }],
        },
        "viewIndex": 0,
    }));
    let result = evaluate(Path::new(ROOT), book_rows(), &query, Some(&connection));
    assert_eq!(paths(&result), vec![LIST]);
    assert!(!result.unsupported);
}
