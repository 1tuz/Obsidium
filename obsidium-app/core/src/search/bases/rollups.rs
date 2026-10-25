use super::{evaluate_filter, finite_number, property, BaseSummary};
use crate::search::wiki::{backlink_rows, linked_paths, parser::extract, resolve_many};
use rusqlite::Connection;
use serde_json::{Map, Number, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub(super) fn summaries(
    root: &Path,
    rows: &[(String, Map<String, Value>)],
    summaries: &[BaseSummary],
    connection: Option<&Connection>,
) -> (Vec<Map<String, Value>>, bool) {
    let index = rows
        .iter()
        .map(|(path, fields)| (path.as_str(), fields))
        .collect::<HashMap<_, _>>();
    let plans = summaries
        .iter()
        .filter(|summary| !summary.name.is_empty())
        .map(|summary| (summary, Aggregate::parse(&summary.formula)))
        .collect::<Vec<_>>();
    let unsupported = plans.iter().any(|(_, aggregate)| aggregate.is_none());
    let mut cache = HashMap::new();
    let computed = rows
        .iter()
        .map(|(path, fields)| {
            let mut values = Map::new();
            for (summary, aggregate) in &plans {
                let key = format!("summary.{}", summary.name);
                let Some(aggregate) = aggregate else {
                    values.insert(key, Value::Null);
                    continue;
                };
                let related = related(root, path, fields, summary, connection, &mut cache);
                values.insert(key, aggregate.value(root, &related, summary, &index));
            }
            values
        })
        .collect();
    (computed, unsupported)
}

fn related(
    root: &Path,
    path: &str,
    fields: &Map<String, Value>,
    summary: &BaseSummary,
    connection: Option<&Connection>,
    cache: &mut HashMap<(String, String), Vec<String>>,
) -> Vec<String> {
    let key = (path.to_owned(), summary.source.clone());
    if let Some(found) = cache.get(&key) {
        return found.clone();
    }
    let paths = match (summary.source.as_str(), connection) {
        ("file.links", Some(connection)) => linked_paths(connection, root, Path::new(path)).ok(),
        ("file.backlinks", Some(connection)) => {
            backlink_rows(connection, root, Path::new(path), usize::MAX)
                .ok()
                .map(|rows| rows.into_iter().map(|(source, _)| source).collect())
        }
        ("file.links" | "file.backlinks", None) => Some(Vec::new()),
        (source, _) => Some(from_property(root, path, fields, source, connection)),
    }
    .unwrap_or_default();
    let paths = dedupe(paths);
    cache.insert(key, paths.clone());
    paths
}

fn from_property(
    root: &Path,
    path: &str,
    fields: &Map<String, Value>,
    source: &str,
    connection: Option<&Connection>,
) -> Vec<String> {
    let Some(connection) = connection else {
        return Vec::new();
    };
    let targets = link_targets(property(path, fields, source, root).as_ref());
    if targets.is_empty() {
        return Vec::new();
    }
    resolve_many(connection, root, Path::new(path), &targets)
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

fn link_targets(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .flat_map(|item| link_targets(Some(item)))
            .collect(),
        Some(Value::String(text)) => targets(text),
        _ => Vec::new(),
    }
}

fn targets(text: &str) -> Vec<String> {
    let links = extract(text);
    if !links.is_empty() {
        return links.into_iter().map(|link| link.target).collect();
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        Vec::new()
    } else {
        vec![trimmed.to_owned()]
    }
}

fn dedupe(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

enum Aggregate {
    Sum,
    Average,
    Minimum,
    Maximum,
    Count,
    List,
    Unique,
}

impl Aggregate {
    fn parse(formula: &str) -> Option<Self> {
        match formula.trim().to_ascii_lowercase().as_str() {
            "sum" => Some(Self::Sum),
            "avg" => Some(Self::Average),
            "min" => Some(Self::Minimum),
            "max" => Some(Self::Maximum),
            "count" => Some(Self::Count),
            "list" => Some(Self::List),
            "unique" => Some(Self::Unique),
            _ => None,
        }
    }

    fn value(
        &self,
        root: &Path,
        related: &[String],
        summary: &BaseSummary,
        index: &HashMap<&str, &Map<String, Value>>,
    ) -> Value {
        let empty = Map::new();
        let filtered = related
            .iter()
            .filter(|path| {
                let fields = index.get(path.as_str()).copied().unwrap_or(&empty);
                evaluate_filter(summary.filter.as_ref(), path.as_str(), fields, root).matched
            })
            .map(|path| path.as_str())
            .collect::<Vec<_>>();
        match self {
            Self::Count => number(filtered.len() as f64),
            Self::List => Value::Array(
                filtered
                    .iter()
                    .filter_map(|path| field(path, index, &summary.property, root))
                    .collect(),
            ),
            Self::Unique => {
                let mut seen = HashSet::new();
                let values = filtered
                    .iter()
                    .filter_map(|path| field(path, index, &summary.property, root))
                    .filter(|value| seen.insert(value.to_string()))
                    .collect();
                Value::Array(values)
            }
            Self::Sum => total(root, &filtered, summary, index)
                .map(|values| number(values.iter().sum()))
                .unwrap_or(Value::Null),
            Self::Average => total(root, &filtered, summary, index)
                .map(|values| number(values.iter().sum::<f64>() / values.len() as f64))
                .unwrap_or(Value::Null),
            Self::Minimum => total(root, &filtered, summary, index)
                .and_then(|values| values.into_iter().reduce(f64::min))
                .map(number)
                .unwrap_or(Value::Null),
            Self::Maximum => total(root, &filtered, summary, index)
                .and_then(|values| values.into_iter().reduce(f64::max))
                .map(number)
                .unwrap_or(Value::Null),
        }
    }
}

fn total(
    root: &Path,
    related: &[&str],
    summary: &BaseSummary,
    index: &HashMap<&str, &Map<String, Value>>,
) -> Option<Vec<f64>> {
    let values = related
        .iter()
        .filter_map(|path| finite_number(field(path, index, &summary.property, root).as_ref()))
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn field(
    path: &str,
    index: &HashMap<&str, &Map<String, Value>>,
    property_name: &str,
    root: &Path,
) -> Option<Value> {
    let fields = index.get(path)?;
    property(path, fields, property_name, root)
}

fn number(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}
