pub mod service;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_SAMPLE_ROWS: usize = 50;
const MAX_DISCOVERED_COLUMNS: usize = 7;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaseDefinition {
    pub filters: Option<Value>,
    pub views: Vec<BaseView>,
    pub unsupported_keys: Vec<String>,
}

impl Default for BaseDefinition {
    fn default() -> Self {
        Self {
            filters: None,
            views: Vec::new(),
            unsupported_keys: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaseView {
    pub r#type: String,
    pub name: String,
    pub limit: Option<usize>,
    pub order: Vec<String>,
    pub filters: Option<Value>,
    pub group_by: Option<BaseGroupBy>,
    pub group_order: Vec<Value>,
    pub sort: Vec<BaseSort>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseGroupBy {
    pub property: String,
    pub direction: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaseSort {
    pub property: String,
    pub direction: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseQuery {
    pub definition: BaseDefinition,
    pub view_index: usize,
    pub sort: Vec<BaseSort>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseEvaluation {
    pub rows: Vec<BaseRow>,
    pub groups: Vec<BaseGroup>,
    pub columns: Vec<String>,
    pub unsupported: bool,
}

impl BaseEvaluation {
    pub fn empty() -> Self {
        Self {
            rows: Vec::new(),
            groups: Vec::new(),
            columns: Vec::new(),
            unsupported: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseRow {
    pub path: String,
    pub fields: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseGroup {
    pub label: Option<String>,
    #[serde(skip_serializing_if = "is_default_start")]
    pub start: usize,
    pub end: usize,
}

fn is_default_start(start: &usize) -> bool {
    *start == 0
}

pub fn evaluate(root: &Path, rows: Vec<(String, Map<String, Value>)>, query: &BaseQuery) -> BaseEvaluation {
    let view = query
        .definition
        .views
        .get(query.view_index)
        .or_else(|| query.definition.views.first());
    let Some(view) = view else {
        return BaseEvaluation::empty();
    };
    let mut unsupported = !query.definition.unsupported_keys.is_empty()
        || view.order.iter().any(|property| property.starts_with("formula."));
    let context = |path: &str, fields: &Map<String, Value>| {
        let _ = root;
        (path, fields)
    };
    let _ = context;

    let mut rows = rows
        .into_iter()
        .filter(|(path, fields)| {
            let global = evaluate_filter(query.definition.filters.as_ref(), path, fields, root);
            let local = evaluate_filter(view.filters.as_ref(), path, fields, root);
            unsupported |= global.unsupported || local.unsupported;
            global.matched && local.matched
        })
        .collect::<Vec<_>>();

    let sorting = if query.sort.is_empty() {
        if view.sort.is_empty() {
            vec![BaseSort {
                property: "file.name".to_owned(),
                direction: Some("ASC".to_owned()),
            }]
        } else {
            view.sort.clone()
        }
    } else {
        query.sort.clone()
    };
    rows.sort_by(|left, right| compare_rows(left, right, &sorting, root));

    if let Some(limit) = view.limit.filter(|limit| *limit > 0) {
        rows.truncate(limit);
    }

    let columns = columns(view, &rows);
    let groups = group_rows(&rows, view, root);
    BaseEvaluation {
        rows: rows
            .into_iter()
            .map(|(path, fields)| BaseRow { path, fields })
            .collect(),
        groups,
        columns,
        unsupported,
    }
}

fn columns(view: &BaseView, rows: &[(String, Map<String, Value>)]) -> Vec<String> {
    if !view.order.is_empty() {
        return view.order.clone();
    }
    let mut seen = HashSet::new();
    let mut discovered = Vec::new();
    for (_, fields) in rows.iter().take(MAX_SAMPLE_ROWS) {
        for key in fields.keys() {
            if seen.insert(key.clone()) {
                discovered.push(key.clone());
            }
        }
    }
    discovered.truncate(MAX_DISCOVERED_COLUMNS);
    let mut columns = vec!["file.name".to_owned()];
    columns.extend(discovered);
    columns
}

fn group_rows(
    rows: &[(String, Map<String, Value>)],
    view: &BaseView,
    root: &Path,
) -> Vec<BaseGroup> {
    let Some(group_by) = view.group_by.as_ref() else {
        return vec![BaseGroup {
            label: None,
            start: 0,
            end: rows.len(),
        }];
    };
    let mut buckets = Vec::<(String, Vec<usize>)>::new();
    for (index, (path, fields)) in rows.iter().enumerate() {
        let label = property(path, fields, &group_by.property, root)
            .map(|value| value_text(Some(&value)))
            .unwrap_or_default();
        match buckets.iter_mut().find(|(existing, _)| *existing == label) {
            Some((_, indexes)) => indexes.push(index),
            None => buckets.push((label, vec![index])),
        }
    }
    let configured = view
        .group_order
        .iter()
        .enumerate()
        .map(|(index, value)| (value_text(Some(value)), index))
        .collect::<Vec<_>>();
    let descending = group_by
        .direction
        .as_deref()
        .is_some_and(|direction| direction.eq_ignore_ascii_case("DESC"));
    buckets.sort_by(|(left, _), (right, _)| {
        let left_index = configured
            .iter()
            .find(|(value, _)| value == left)
            .map(|(_, index)| *index);
        let right_index = configured
            .iter()
            .find(|(value, _)| value == right)
            .map(|(_, index)| *index);
        match (left_index, right_index) {
            (None, None) => {
                let compared = natural_compare(&left.to_lowercase(), &right.to_lowercase());
                if descending {
                    compared.reverse()
                } else {
                    compared
                }
            }
            (left_index, right_index) => left_index
                .unwrap_or(usize::MAX)
                .cmp(&right_index.unwrap_or(usize::MAX)),
        }
    });

    let mut ordered = Vec::with_capacity(rows.len());
    let mut groups = Vec::with_capacity(buckets.len());
    for (label, indexes) in buckets {
        let start = ordered.len();
        ordered.extend(indexes);
        groups.push(BaseGroup {
            label: Some(label),
            start,
            end: ordered.len(),
        });
    }
    groups
}

fn compare_rows(
    left: &(String, Map<String, Value>),
    right: &(String, Map<String, Value>),
    sorting: &[BaseSort],
    root: &Path,
) -> Ordering {
    for item in sorting {
        let left_value = property(&left.0, &left.1, &item.property, root);
        let right_value = property(&right.0, &right.1, &item.property, root);
        let compared = compare_values(left_value.as_ref(), right_value.as_ref());
        if compared != Ordering::Equal {
            return if item
                .direction
                .as_deref()
                .is_some_and(|direction| direction.eq_ignore_ascii_case("DESC"))
            {
                compared.reverse()
            } else {
                compared
            };
        }
    }
    left.0.cmp(&right.0)
}

fn compare_values(left: Option<&Value>, right: Option<&Value>) -> Ordering {
    let left_number = left.and_then(numeric);
    let right_number = right.and_then(numeric);
    if let (Some(left), Some(right)) = (left_number, right_number) {
        return left.partial_cmp(&right).unwrap_or(Ordering::Equal);
    }
    natural_compare(
        &value_text(left).to_lowercase(),
        &value_text(right).to_lowercase(),
    )
}

fn natural_compare(left: &str, right: &str) -> Ordering {
    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();
    let mut left_index = 0;
    let mut right_index = 0;
    while left_index < left_chars.len() && right_index < right_chars.len() {
        let left_char = left_chars[left_index];
        let right_char = right_chars[right_index];
        if left_char.is_ascii_digit() && right_char.is_ascii_digit() {
            let left_end = digits_end(&left_chars, left_index);
            let right_end = digits_end(&right_chars, right_index);
            let left_number = left_chars[left_index..left_end].iter().collect::<String>();
            let right_number = right_chars[right_index..right_end].iter().collect::<String>();
            let left_trimmed = left_number.trim_start_matches('0');
            let right_trimmed = right_number.trim_start_matches('0');
            let compared = left_trimmed
                .len()
                .cmp(&right_trimmed.len())
                .then_with(|| left_trimmed.cmp(right_trimmed));
            if compared != Ordering::Equal {
                return compared;
            }
            left_index = left_end;
            right_index = right_end;
            continue;
        }
        let compared = left_char.cmp(&right_char);
        if compared != Ordering::Equal {
            return compared;
        }
        left_index += 1;
        right_index += 1;
    }
    left_chars.len().cmp(&right_chars.len())
}

fn digits_end(chars: &[char], start: usize) -> usize {
    let mut end = start;
    while end < chars.len() && chars[end].is_ascii_digit() {
        end += 1;
    }
    end
}

fn numeric(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

struct FilterOutcome {
    matched: bool,
    unsupported: bool,
}

impl FilterOutcome {
    fn supported(matched: bool) -> Self {
        Self {
            matched,
            unsupported: false,
        }
    }

    fn unsupported() -> Self {
        Self {
            matched: true,
            unsupported: true,
        }
    }
}

fn evaluate_filter(
    filter: Option<&Value>,
    path: &str,
    fields: &Map<String, Value>,
    root: &Path,
) -> FilterOutcome {
    let Some(filter) = filter else {
        return FilterOutcome::supported(true);
    };
    if let Some(expression) = filter.as_str() {
        return evaluate_expression(expression, path, fields, root);
    }
    let Some(object) = filter.as_object() else {
        return FilterOutcome::unsupported();
    };
    if object.contains_key("unsupported") {
        return FilterOutcome::unsupported();
    }
    if let Some(operands) = object.get("and").and_then(Value::as_array) {
        let results = operands
            .iter()
            .map(|item| evaluate_filter(Some(item), path, fields, root))
            .collect::<Vec<_>>();
        return FilterOutcome {
            matched: results.iter().all(|result| result.matched),
            unsupported: results.iter().any(|result| result.unsupported),
        };
    }
    if let Some(operands) = object.get("or").and_then(Value::as_array) {
        let results = operands
            .iter()
            .map(|item| evaluate_filter(Some(item), path, fields, root))
            .collect::<Vec<_>>();
        return FilterOutcome {
            matched: results.iter().any(|result| result.matched),
            unsupported: results.iter().any(|result| result.unsupported),
        };
    }
    if let Some(operand) = object.get("not") {
        let operands = match operand {
            Value::Array(items) => items.clone(),
            other => vec![other.clone()],
        };
        let results = operands
            .iter()
            .map(|item| evaluate_filter(Some(item), path, fields, root))
            .collect::<Vec<_>>();
        if results.iter().any(|result| result.unsupported) {
            return FilterOutcome::unsupported();
        }
        return FilterOutcome::supported(!results.iter().all(|result| result.matched));
    }
    FilterOutcome::unsupported()
}

fn evaluate_expression(
    expression: &str,
    path: &str,
    fields: &Map<String, Value>,
    root: &Path,
) -> FilterOutcome {
    if let Some(argument) = call_argument(expression, "file.hasTag") {
        let wanted = value_text(Some(&literal(argument))).to_lowercase();
        let wanted = wanted.trim_start_matches('#').to_owned();
        let tags = tags(path, fields);
        return FilterOutcome::supported(tags.iter().any(|tag| {
            tag == &wanted || tag.starts_with(&format!("{wanted}/"))
        }));
    }
    if let Some(argument) = call_argument(expression, "file.inFolder") {
        let wanted = value_text(Some(&literal(argument)))
            .replace('\\', "/")
            .trim_matches('/')
            .to_lowercase();
        let folder = property(path, fields, "file.folder", root)
            .map(|value| value_text(Some(&value)).to_lowercase())
            .unwrap_or_default();
        return FilterOutcome::supported(folder == wanted || folder.starts_with(&format!("{wanted}/")));
    }
    if let Some((property_name, argument)) = contains_call(expression) {
        let haystack = property(path, fields, property_name, root);
        let needle = value_text(Some(&literal(argument))).to_lowercase();
        let matched = match haystack {
            Some(Value::Array(items)) => items
                .iter()
                .any(|item| value_text(Some(item)).to_lowercase().contains(&needle)),
            Some(value) => value_text(Some(&value)).to_lowercase().contains(&needle),
            None => false,
        };
        return FilterOutcome::supported(matched);
    }
    match comparison(expression) {
        Some((property_name, operator, raw)) => {
            if property_name.starts_with("formula.") {
                return FilterOutcome::unsupported();
            }
            let left = property(path, fields, property_name, root);
            FilterOutcome::supported(scalar_compare(
                left.as_ref(),
                &literal(raw),
                operator,
            ))
        }
        None => FilterOutcome::unsupported(),
    }
}

fn call_argument<'a>(expression: &'a str, name: &str) -> Option<&'a str> {
    let rest = expression.strip_prefix(name)?.strip_prefix('(')?;
    rest.strip_suffix(')')
}

fn contains_call(expression: &str) -> Option<(&str, &str)> {
    let (property_name, rest) = expression.split_once(".contains(")?;
    let argument = rest.strip_suffix(')')?;
    if property_name.is_empty()
        || !property_name
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return None;
    }
    Some((property_name, argument))
}

fn comparison(expression: &str) -> Option<(&str, &str, &str)> {
    const OPERATORS: [&str; 6] = ["==", "!=", ">=", "<=", ">", "<"];
    let mut quote: Option<char> = None;
    let characters = expression.char_indices().collect::<Vec<_>>();
    for (position, (index, character)) in characters.iter().enumerate() {
        match quote {
            Some(open) => {
                if *character == open && position > 0 && characters[position - 1].1 != '\\' {
                    quote = None;
                }
            }
            None => {
                if *character == '"' || *character == '\'' {
                    quote = Some(*character);
                    continue;
                }
                for operator in OPERATORS {
                    if expression[*index..].starts_with(operator) {
                        let property_name = expression[..*index].trim();
                        let raw = expression[*index + operator.len()..].trim();
                        if property_name.is_empty() || raw.is_empty() {
                            return None;
                        }
                        return Some((property_name, operator, raw));
                    }
                }
            }
        }
    }
    None
}

fn scalar_compare(left: Option<&Value>, right: &Value, operator: &str) -> bool {
    let left = match left {
        Some(Value::Array(items)) => {
            if operator == "!=" {
                return items
                    .iter()
                    .all(|item| !scalar_compare(Some(item), right, "=="));
            }
            if operator == "==" {
                return items
                    .iter()
                    .any(|item| scalar_compare(Some(item), right, "=="));
            }
            Value::String(
                items
                    .iter()
                    .map(|item| value_text(Some(item)))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        }
        Some(value) => value.clone(),
        None => Value::Null,
    };
    if let Some(wanted) = numeric(right) {
        let Some(number) = numeric(&left) else {
            return false;
        };
        return match operator {
            ">" => number > wanted,
            ">=" => number >= wanted,
            "<" => number < wanted,
            "<=" => number <= wanted,
            "==" => number == wanted,
            _ => number != wanted,
        };
    }
    let left = value_text(Some(&left)).to_lowercase();
    let right = value_text(Some(right)).to_lowercase();
    match operator {
        ">" => left > right,
        ">=" => left >= right,
        "<" => left < right,
        "<=" => left <= right,
        "==" => left == right,
        _ => left != right,
    }
}

fn tags(path: &str, fields: &Map<String, Value>) -> Vec<String> {
    let _ = path;
    let value = fields.get("tags");
    let items = match value {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| value_text(Some(item)))
            .collect::<Vec<_>>(),
        Some(value) => value_text(Some(value)).split(',').map(ToOwned::to_owned).collect(),
        None => Vec::new(),
    };
    items
        .into_iter()
        .map(|tag| tag.trim().trim_start_matches('#').to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn literal(raw: &str) -> Value {
    let value = raw.trim();
    let unquoted = if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        value[1..value.len().saturating_sub(1)].to_owned()
    } else {
        value.to_owned()
    };
    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        return Value::String(unquoted);
    }
    if value.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if value.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if value == "null" {
        return Value::Null;
    }
    if let Ok(number) = value.parse::<f64>() {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return Value::Number(number);
        }
    }
    Value::String(unquoted)
}

fn property(
    path: &str,
    fields: &Map<String, Value>,
    property: &str,
    root: &Path,
) -> Option<Value> {
    let path = PathBuf::from(path);
    let relative = path.strip_prefix(root).unwrap_or(&path);
    match property {
        "file.name" => relative
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| Value::String(value.to_owned())),
        "file.path" => Some(Value::String(slash_path(relative))),
        "file.ext" => relative
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| Value::String(value.to_owned())),
        "file.folder" => Some(Value::String(slash_path(
            relative.parent().unwrap_or(Path::new("")),
        ))),
        other => {
            let key = other.strip_prefix("note.").unwrap_or(other);
            fields.get(key).cloned()
        }
    }
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn value_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| value_text(Some(item)))
            .collect::<Vec<_>>()
            .join(", "),
        Some(other) => other.to_string(),
    }
}
