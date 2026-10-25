use super::{file_stem, folder_of, relative_path, value_text, BaseFormulaError};
use crate::search::dataview::ast::Expr;
use crate::search::dataview::eval::{evaluate, Scope};
use crate::search::dataview::parser::parse_expression;
use crate::search::dataview::rows::Row;
use crate::search::dataview::value::Value as DataviewValue;
use crate::search::fields::Field;
use crate::search::note_date;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub(super) struct Formulas {
    compiled: Vec<(String, Result<Expr, String>)>,
}

impl Formulas {
    pub(super) fn compile(
        definitions: &BTreeMap<String, String>,
        errors: &mut Vec<BaseFormulaError>,
    ) -> Self {
        let compiled = definitions
            .iter()
            .map(|(name, definition)| {
                let parsed = parse_expression(definition);
                if let Err(message) = &parsed {
                    push_error(errors, name, "", message);
                }
                (name.clone(), parsed)
            })
            .collect();
        Self { compiled }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.compiled.is_empty()
    }

    pub(super) fn values(
        &self,
        root: &Path,
        path: &str,
        fields: &Map<String, Value>,
        errors: &mut Vec<BaseFormulaError>,
    ) -> Map<String, Value> {
        let row = row(root, path, fields);
        let scope = Scope {
            note: Some(&row),
            vars: &[],
            local: None,
        };
        let mut computed = Map::new();
        for (name, expression) in &self.compiled {
            let value = match expression {
                Ok(expression) => evaluate(expression, &scope),
                Err(message) => Err(message.clone()),
            };
            let value = match value {
                Ok(value) => json(value),
                Err(message) => {
                    push_error(errors, name, path, &message);
                    Value::Null
                }
            };
            computed.insert(format!("formula.{name}"), value);
        }
        computed
    }
}

fn push_error(errors: &mut Vec<BaseFormulaError>, formula: &str, path: &str, message: &str) {
    if errors
        .iter()
        .any(|error| error.formula == formula && error.message == message)
    {
        return;
    }
    errors.push(BaseFormulaError {
        formula: formula.to_owned(),
        path: path.to_owned(),
        message: message.to_owned(),
    });
}

fn row(root: &Path, path: &str, fields: &Map<String, Value>) -> Row {
    let relative = relative_path(root, path);
    Row {
        relative: relative.clone(),
        source: path.to_owned(),
        name: file_stem(&relative),
        folder: folder_of(&relative),
        created: 0,
        modified: 0,
        size: 0,
        fields: fields
            .iter()
            .filter(|(_, value)| !value.is_null())
            .map(|(key, value)| match value {
                Value::Array(items) => Field::list(
                    key.clone(),
                    items.iter().map(|item| value_text(Some(item))).collect(),
                ),
                other => Field::scalar(key.clone(), value_text(Some(other))),
            })
            .collect(),
        tasks: Vec::new(),
    }
}

fn json(value: DataviewValue) -> Value {
    match value {
        DataviewValue::Null => Value::Null,
        DataviewValue::Bool(flag) => Value::Bool(flag),
        DataviewValue::Number(number) => number_value(number),
        DataviewValue::Date(nanos) => Value::String(note_date::format(nanos)),
        DataviewValue::Duration(length) => Value::String(length.text()),
        DataviewValue::Progress(part) => number_value(part),
        DataviewValue::Text(text) => Value::String(text),
        DataviewValue::Link(link) => Value::String(link.label()),
        DataviewValue::List(items) => Value::Array(items.into_iter().map(json).collect()),
        DataviewValue::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key, json(value)))
                .collect(),
        ),
    }
}

fn number_value(number: f64) -> Value {
    serde_json::Number::from_f64(number)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}
