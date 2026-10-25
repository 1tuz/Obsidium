pub mod service;

#[cfg(test)]
mod tests;

use crate::search::paths::{slash_path, strip_root};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::Path;

const MAX_SAMPLE_ROWS: usize = 50;
const MAX_DISCOVERED_COLUMNS: usize = 7;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaseDefinition {
    pub filters: Option<Value>,
    pub views: Vec<BaseView>,
    pub unsupported_keys: Vec<String>,
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
    #[serde(default)]
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
    #[serde(default)]
    pub view_index: usize,
    #[serde(default)]
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
    pub start: usize,
    pub end: usize,
}

pub fn evaluate(
    root: &Path,
    rows: Vec<(String, Map<String, Value>)>,
    query: &BaseQuery,
) -> BaseEvaluation {
    if query.definition.views.is_empty() {
        return BaseEvaluation::empty();
    }
    let index = query.view_index.min(query.definition.views.len() - 1);
    let view = &query.definition.views[index];
    let mut unsupported = !query.definition.unsupported_keys.is_empty()
        || view
            .order
            .iter()
            .any(|property| property.starts_with("formula."));
    let mut kept = Vec::new();
    for (path, fields) in rows {
        let global = evaluate_filter(query.definition.filters.as_ref(), &path, &fields, root);
        let local = evaluate_filter(view.filters.as_ref(), &path, &fields, root);
        unsupported |= global.unsupported || local.unsupported;
        if global.matched && local.matched {
            kept.push((path, fields));
        }
    }
    let sorting = if !query.sort.is_empty() {
        query.sort.clone()
    } else if !view.sort.is_empty() {
        view.sort.clone()
    } else {
        vec![BaseSort {
            property: "file.name".to_owned(),
            direction: Some("ASC".to_owned()),
        }]
    };
    kept.sort_by(|left, right| compare_rows(left, right, &sorting, root));
    if let Some(limit) = view.limit {
        kept.truncate(limit);
    }
    let columns = columns(view, &kept);
    let (rows, groups) = group_rows(kept, view, root);
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
    rows: Vec<(String, Map<String, Value>)>,
    view: &BaseView,
    root: &Path,
) -> (Vec<(String, Map<String, Value>)>, Vec<BaseGroup>) {
    let Some(group_by) = view.group_by.as_ref() else {
        let end = rows.len();
        return (
            rows,
            vec![BaseGroup {
                label: None,
                start: 0,
                end,
            }],
        );
    };
    let mut labels = Vec::<String>::new();
    let mut buckets = Vec::<Vec<usize>>::new();
    for (index, (path, fields)) in rows.iter().enumerate() {
        let label = property(path, fields, &group_by.property, root)
            .map(|value| value_text(Some(&value)))
            .unwrap_or_default();
        match labels.iter().position(|existing| *existing == label) {
            Some(position) => buckets[position].push(index),
            None => {
                labels.push(label);
                buckets.push(vec![index]);
            }
        }
    }
    let configured = view
        .group_order
        .iter()
        .map(|value| value_text(Some(value)))
        .collect::<Vec<_>>();
    let descending = group_by.direction.as_deref() == Some("DESC");
    let mut order = (0..labels.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| {
        let left_configured = configured.iter().rposition(|value| *value == labels[*left]);
        let right_configured = configured
            .iter()
            .rposition(|value| *value == labels[*right]);
        match (left_configured, right_configured) {
            (None, None) => {
                let compared = collate(&labels[*left], &labels[*right]);
                if descending {
                    compared.reverse()
                } else {
                    compared
                }
            }
            (left_configured, right_configured) => left_configured
                .unwrap_or(usize::MAX)
                .cmp(&right_configured.unwrap_or(usize::MAX)),
        }
    });
    let mut slots = rows.into_iter().map(Some).collect::<Vec<_>>();
    let mut ordered = Vec::with_capacity(slots.len());
    let mut groups = Vec::with_capacity(order.len());
    for index in order {
        let start = ordered.len();
        for row_index in &buckets[index] {
            if let Some(row) = slots[*row_index].take() {
                ordered.push(row);
            }
        }
        groups.push(BaseGroup {
            label: Some(labels[index].clone()),
            start,
            end: ordered.len(),
        });
    }
    (ordered, groups)
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
        let compared = compare_sort_values(left_value.as_ref(), right_value.as_ref());
        if compared != Ordering::Equal {
            return if item.direction.as_deref() == Some("DESC") {
                compared.reverse()
            } else {
                compared
            };
        }
    }
    collate_path(&left.0, &right.0)
}

fn compare_sort_values(left: Option<&Value>, right: Option<&Value>) -> Ordering {
    match (finite_number(left), finite_number(right)) {
        (Some(left), Some(right)) => left.partial_cmp(&right).unwrap_or(Ordering::Equal),
        _ => collate_base(&value_text(left), &value_text(right)),
    }
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    js_number(value).filter(|number| number.is_finite())
}

fn js_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Null => Some(0.0),
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Number(number) => number.as_f64(),
        Value::String(text) => parse_number(text),
        _ => None,
    }
}

fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    let unsigned = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if unsigned.eq_ignore_ascii_case("infinity") {
        return Some(if trimmed.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    let numeric = unsigned.chars().all(|character| {
        character.is_ascii_digit() || matches!(character, '.' | 'e' | 'E' | '+' | '-')
    });
    if !numeric || !unsigned.chars().any(|character| character.is_ascii_digit()) {
        return None;
    }
    trimmed.parse::<f64>().ok()
}

fn collate(left: &str, right: &str) -> Ordering {
    collate_base(left, right).then_with(|| natural_compare(right, left))
}

fn collate_base(left: &str, right: &str) -> Ordering {
    natural_compare(&left.to_lowercase(), &right.to_lowercase())
}

fn collate_path(left: &str, right: &str) -> Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| right.cmp(left))
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
            let right_number = right_chars[right_index..right_end]
                .iter()
                .collect::<String>();
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
    if truthy(object.get("unsupported")) {
        return FilterOutcome::unsupported();
    }
    if let Some(operand) = object.get("and").filter(|value| truthy(Some(*value))) {
        let Some(operands) = operand.as_array() else {
            return FilterOutcome::unsupported();
        };
        let results = operands
            .iter()
            .map(|item| evaluate_filter(Some(item), path, fields, root))
            .collect::<Vec<_>>();
        return FilterOutcome {
            matched: results.iter().all(|result| result.matched),
            unsupported: results.iter().any(|result| result.unsupported),
        };
    }
    if let Some(operand) = object.get("or").filter(|value| truthy(Some(*value))) {
        let Some(operands) = operand.as_array() else {
            return FilterOutcome::unsupported();
        };
        let results = operands
            .iter()
            .map(|item| evaluate_filter(Some(item), path, fields, root))
            .collect::<Vec<_>>();
        return FilterOutcome {
            matched: results.iter().any(|result| result.matched),
            unsupported: results.iter().any(|result| result.unsupported),
        };
    }
    if let Some(operand) = object.get("not").filter(|value| truthy(Some(*value))) {
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
        let literal = literal(argument);
        let text = value_text(Some(&literal));
        let wanted = text.strip_prefix('#').unwrap_or(&text).to_lowercase();
        let tags = tags(fields);
        return FilterOutcome::supported(
            tags.iter()
                .any(|tag| tag == &wanted || tag.starts_with(&format!("{wanted}/"))),
        );
    }
    if let Some(argument) = call_argument(expression, "file.inFolder") {
        let literal = literal(argument);
        let wanted = value_text(Some(&literal))
            .replace('\\', "/")
            .trim_matches('/')
            .to_lowercase();
        let folder = property(path, fields, "file.folder", root)
            .map(|value| value_text(Some(&value)).to_lowercase())
            .unwrap_or_default();
        return FilterOutcome::supported(
            folder == wanted || folder.starts_with(&format!("{wanted}/")),
        );
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
            FilterOutcome::supported(scalar_compare(left.as_ref(), &literal(raw), operator))
        }
        None => FilterOutcome::unsupported(),
    }
}

fn call_argument<'a>(expression: &'a str, name: &str) -> Option<&'a str> {
    let head = expression.get(..name.len())?;
    if !head.eq_ignore_ascii_case(name) {
        return None;
    }
    let rest = expression[name.len()..].strip_prefix('(')?;
    let argument = rest.strip_suffix(')')?;
    (!argument.is_empty()).then_some(argument)
}

fn contains_call(expression: &str) -> Option<(&str, &str)> {
    let lowered = expression.to_ascii_lowercase();
    let index = lowered.find(".contains(")?;
    let name = &expression[..index];
    if name.is_empty() || !name.chars().all(is_property_char) {
        return None;
    }
    let rest = &expression[index + ".contains(".len()..];
    let argument = rest.strip_suffix(')')?;
    (!argument.is_empty()).then_some((name, argument))
}

fn comparison(expression: &str) -> Option<(&str, &str, &str)> {
    const OPERATORS: [&str; 6] = ["==", "!=", ">=", "<=", ">", "<"];
    for (index, _) in expression.char_indices() {
        let Some(operator) = OPERATORS
            .iter()
            .find(|operator| expression[index..].starts_with(**operator))
        else {
            continue;
        };
        let name = expression[..index].trim_end();
        if name.is_empty() || !name.chars().all(is_property_char) {
            return None;
        }
        let raw = &expression[index + operator.len()..];
        if raw.is_empty() {
            return None;
        }
        return Some((name, operator, raw));
    }
    None
}

fn is_property_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number
            .as_f64()
            .is_some_and(|number| number != 0.0 && !number.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
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
    if let Value::Number(number) = right {
        let Some(wanted) = number.as_f64() else {
            return false;
        };
        let Some(number) = finite_number(Some(&left)) else {
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

fn tags(fields: &Map<String, Value>) -> Vec<String> {
    let items = match fields.get("tags") {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| value_text(Some(item)))
            .collect::<Vec<_>>(),
        Some(value) => value_text(Some(value))
            .split(',')
            .map(ToOwned::to_owned)
            .collect(),
        None => Vec::new(),
    };
    items
        .into_iter()
        .map(|tag| {
            let trimmed = tag.trim();
            trimmed.strip_prefix('#').unwrap_or(trimmed).to_lowercase()
        })
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn literal(raw: &str) -> Value {
    let value = raw.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return Value::String(value[1..value.len() - 1].to_owned());
    }
    if value.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if value.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Some(number) = literal_number(value) {
        return serde_json::Number::from_f64(number)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.to_owned()));
    }
    if value == "null" {
        return Value::Null;
    }
    Value::String(value.to_owned())
}

fn literal_number(value: &str) -> Option<f64> {
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    let (integer, fraction) = match unsigned.split_once('.') {
        Some((integer, fraction)) => (integer, Some(fraction)),
        None => (unsigned, None),
    };
    let digits = |part: &str| part.chars().all(|character| character.is_ascii_digit());
    let body = match fraction {
        Some(fraction) => {
            if integer.is_empty() && fraction.is_empty() {
                return None;
            }
            if !digits(integer) || !digits(fraction) {
                return None;
            }
            if integer.is_empty() {
                format!("0.{fraction}")
            } else if fraction.is_empty() {
                format!("{integer}.0")
            } else {
                format!("{integer}.{fraction}")
            }
        }
        None => {
            if integer.is_empty() || !digits(integer) {
                return None;
            }
            integer.to_owned()
        }
    };
    let signed = if value.starts_with('-') {
        format!("-{body}")
    } else {
        body
    };
    signed.parse::<f64>().ok()
}

fn property(path: &str, fields: &Map<String, Value>, property: &str, root: &Path) -> Option<Value> {
    match property {
        "file.name" => Some(Value::String(file_stem(path))),
        "file.path" => Some(Value::String(relative_path(root, path))),
        "file.ext" => Some(Value::String(extension(path))),
        "file.folder" => Some(Value::String(folder_of(&relative_path(root, path)))),
        other => fields
            .get(other.strip_prefix("note.").unwrap_or(other))
            .cloned(),
    }
}

fn file_name(path: &str) -> &str {
    let normalized = path.trim_end_matches(['/', '\\']);
    normalized.rsplit(['/', '\\']).next().unwrap_or(normalized)
}

fn file_stem(path: &str) -> String {
    let name = file_name(path);
    match name.rfind('.') {
        Some(dot) if dot + 1 < name.len() => name[..dot].to_owned(),
        _ => name.to_owned(),
    }
}

fn extension(path: &str) -> String {
    let name = file_name(path);
    match name.rfind('.') {
        Some(dot) => name[dot + 1..].to_owned(),
        None => String::new(),
    }
}

fn relative_path(root: &Path, path: &str) -> String {
    let path = Path::new(path);
    strip_root(root, path)
        .map(slash_path)
        .unwrap_or_else(|| slash_path(path))
}

fn folder_of(relative: &str) -> String {
    match relative.rfind('/') {
        Some(cut) if cut > 0 => relative[..cut].to_owned(),
        _ => String::new(),
    }
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
