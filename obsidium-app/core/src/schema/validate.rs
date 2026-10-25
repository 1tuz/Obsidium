use super::model::{
    declared_types, field_value, field_values, note_type, ObjectSchema, ObjectType,
    PropertyDefinition, PropertyKind, Violation, NOTE_TYPE, SCHEMA_VERSION,
};
use super::SchemaError;
use crate::search::fields::{Field, FieldKind};
use crate::search::note_date;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub fn validate_schema(schema: &ObjectSchema) -> Result<(), SchemaError> {
    if schema.version != SCHEMA_VERSION {
        return Err(invalid(format!(
            "версия схемы {} не поддерживается, ожидается {SCHEMA_VERSION}",
            schema.version
        )));
    }
    let mut names = HashSet::new();
    for object in &schema.types {
        let name = object.name.trim();
        if name.is_empty() {
            return Err(invalid("у типа пустое имя".to_owned()));
        }
        if name.eq_ignore_ascii_case(NOTE_TYPE) {
            return Err(invalid(format!(
                "тип {NOTE_TYPE} встроенный: его нельзя описывать в schema.json"
            )));
        }
        if !names.insert(name.to_lowercase()) {
            return Err(invalid(format!("тип «{name}» описан дважды")));
        }
        validate_properties(name, &object.properties)?;
    }
    for object in &schema.types {
        let Some(parent) = parent_name(object) else {
            continue;
        };
        if parent.eq_ignore_ascii_case(object.name.trim()) {
            return Err(invalid(format!(
                "тип «{}» наследует сам себя",
                object.name.trim()
            )));
        }
        if !names.contains(&parent.to_lowercase()) {
            return Err(invalid(format!(
                "тип «{}» наследует неизвестный тип «{parent}»",
                object.name.trim()
            )));
        }
    }
    let mut state = HashMap::new();
    for object in &schema.types {
        detect_cycle(schema, object.name.trim(), &mut state)?;
    }
    Ok(())
}

pub fn resolve(schema: &ObjectSchema, name: &str) -> Option<ObjectType> {
    let object = schema
        .types
        .iter()
        .find(|object| object.name.trim().eq_ignore_ascii_case(name.trim()))?;
    let mut chain = Vec::new();
    let mut current = object;
    while chain
        .iter()
        .all(|seen: &&ObjectType| !seen.name.eq_ignore_ascii_case(&current.name))
    {
        chain.push(current);
        let Some(parent) = parent_name(current) else {
            break;
        };
        match schema
            .types
            .iter()
            .find(|candidate| candidate.name.trim().eq_ignore_ascii_case(parent))
        {
            Some(found) => current = found,
            None => break,
        }
    }
    chain.reverse();
    let mut resolved = object.clone();
    resolved.properties = Vec::new();
    for item in &chain {
        for property in &item.properties {
            match resolved
                .properties
                .iter_mut()
                .find(|existing| existing.name.eq_ignore_ascii_case(property.name.trim()))
            {
                Some(slot) => *slot = property.clone(),
                None => resolved.properties.push(property.clone()),
            }
        }
    }
    Some(resolved)
}

pub fn type_of(schema: &ObjectSchema, fields: &[Field]) -> Vec<ObjectType> {
    let declared = declared_types(fields);
    if declared.is_empty() || schema.types.is_empty() {
        return vec![note_type()];
    }
    declared
        .iter()
        .filter_map(|name| resolve(schema, name))
        .collect()
}

pub fn note_violations(schema: &ObjectSchema, fields: &[Field]) -> Vec<Violation> {
    if schema.types.is_empty() {
        return Vec::new();
    }
    let mut violations = Vec::new();
    let mut checked = HashSet::new();
    for name in declared_types(fields) {
        let Some(object) = resolve(schema, &name) else {
            push_once(
                &mut violations,
                Violation::new("type", format!("тип «{name}» не описан в схеме")),
            );
            continue;
        };
        if !checked.insert(object.name.clone()) {
            continue;
        }
        for property in &object.properties {
            if let Some(reason) = property_violation(property, fields) {
                push_once(
                    &mut violations,
                    Violation::new(property.name.trim(), reason),
                );
            }
        }
    }
    violations
}

fn push_once(violations: &mut Vec<Violation>, violation: Violation) {
    if !violations.contains(&violation) {
        violations.push(violation);
    }
}

fn property_violation(property: &PropertyDefinition, fields: &[Field]) -> Option<String> {
    let field = field_value(fields, property.name.trim());
    let values = field.map(field_values).unwrap_or_default();
    if values.is_empty() {
        return property
            .required
            .then(|| "обязательное свойство не заполнено".to_owned());
    }
    let field = field?;
    let text = field.text.trim();
    let list = field.kind == FieldKind::List;
    match property.kind {
        PropertyKind::Text => list.then(|| "ожидался текст, получен список".to_owned()),
        PropertyKind::Number => {
            if list {
                return Some("ожидалось число, получен список".to_owned());
            }
            text.parse::<f64>()
                .is_err()
                .then(|| format!("ожидалось число, получено «{text}»"))
        }
        PropertyKind::Date => {
            if list {
                return Some("ожидалась одна дата, получен список".to_owned());
            }
            if date_matches(text, property.format.as_deref()) {
                return None;
            }
            Some(match property.format.as_deref() {
                Some(format) => format!("ожидалась дата в формате {format}, получено «{text}»"),
                None => format!("ожидалась дата (2026-10-25), получено «{text}»"),
            })
        }
        PropertyKind::Tags => None,
        PropertyKind::Select => {
            if list {
                return Some("ожидалось одно значение, получен список".to_owned());
            }
            (!option_allowed(property, text))
                .then(|| format!("значение «{text}» не из списка: {}", options(property)))
        }
        PropertyKind::MultiSelect => values
            .iter()
            .find(|value| !option_allowed(property, value))
            .map(|value| format!("значение «{value}» не из списка: {}", options(property))),
        PropertyKind::Checkbox => {
            if list {
                return Some("ожидалось true или false, получен список".to_owned());
            }
            (!is_bool(text)).then(|| format!("ожидалось true или false, получено «{text}»"))
        }
        PropertyKind::Url => single_value(field, text, "адрес http(s)", is_url),
        PropertyKind::Phone => single_value(field, text, "телефон", is_phone),
        PropertyKind::Email => single_value(field, text, "email", is_email),
    }
}

fn single_value(
    field: &Field,
    text: &str,
    expected: &str,
    valid: fn(&str) -> bool,
) -> Option<String> {
    if field.kind == FieldKind::List {
        return Some("ожидалось одно значение, получен список".to_owned());
    }
    (!valid(text)).then(|| format!("ожидался {expected}, получено «{text}»"))
}

fn option_allowed(property: &PropertyDefinition, value: &str) -> bool {
    property
        .options
        .iter()
        .any(|option| option.trim() == value.trim())
}

fn options(property: &PropertyDefinition) -> String {
    property
        .options
        .iter()
        .map(|option| option.trim())
        .collect::<Vec<_>>()
        .join(", ")
}

fn parent_name(object: &ObjectType) -> Option<&str> {
    object
        .extends
        .as_deref()
        .map(str::trim)
        .filter(|parent| !parent.is_empty())
}

fn validate_properties(
    type_name: &str,
    properties: &[PropertyDefinition],
) -> Result<(), SchemaError> {
    let mut names = HashSet::new();
    for property in properties {
        let name = property.name.trim();
        if name.is_empty() {
            return Err(invalid(format!(
                "у типа «{type_name}» есть свойство без имени"
            )));
        }
        if !names.insert(name.to_lowercase()) {
            return Err(invalid(format!(
                "у типа «{type_name}» свойство «{name}» описано дважды"
            )));
        }
        if property.kind.uses_options() {
            if property.options.is_empty() {
                return Err(invalid(format!(
                    "свойство «{type_name}.{name}»: для «{}» нужен список options",
                    property.kind.label()
                )));
            }
            let mut options = HashSet::new();
            for option in &property.options {
                let option = option.trim();
                if option.is_empty() {
                    return Err(invalid(format!(
                        "свойство «{type_name}.{name}»: пустое значение в options"
                    )));
                }
                if !options.insert(option) {
                    return Err(invalid(format!(
                        "свойство «{type_name}.{name}»: значение «{option}» повторяется в options"
                    )));
                }
            }
        } else if !property.options.is_empty() {
            return Err(invalid(format!(
                "свойство «{type_name}.{name}»: options допустимы только для select и multiSelect"
            )));
        }
        if let Some(default) = &property.default {
            validate_default(type_name, property, default)?;
        }
    }
    Ok(())
}

fn validate_default(
    type_name: &str,
    property: &PropertyDefinition,
    default: &Value,
) -> Result<(), SchemaError> {
    let name = property.name.trim();
    let fail = |expected: &str| {
        invalid(format!(
            "свойство «{type_name}.{name}»: значение по умолчанию не {expected}, а {}",
            describe(default)
        ))
    };
    match property.kind {
        PropertyKind::Text => default.as_str().map(|_| ()).ok_or_else(|| fail("текст")),
        PropertyKind::Number => default.as_f64().map(|_| ()).ok_or_else(|| fail("число")),
        PropertyKind::Date => {
            let value = default.as_str().ok_or_else(|| fail("дата"))?;
            date_matches(value, property.format.as_deref())
                .then_some(())
                .ok_or_else(|| fail("дата"))
        }
        PropertyKind::Tags => match default {
            Value::String(_) => Ok(()),
            Value::Array(items) if items.iter().all(Value::is_string) => Ok(()),
            _ => Err(fail("строка или список строк")),
        },
        PropertyKind::Select => {
            let value = default.as_str().ok_or_else(|| fail("строка"))?;
            option_allowed(property, value)
                .then_some(())
                .ok_or_else(|| fail("одно из значений options"))
        }
        PropertyKind::MultiSelect => {
            let Value::Array(items) = default else {
                return Err(fail("список значений из options"));
            };
            let allowed = items.iter().all(|item| {
                item.as_str()
                    .is_some_and(|value| option_allowed(property, value))
            });
            allowed
                .then_some(())
                .ok_or_else(|| fail("список значений из options"))
        }
        PropertyKind::Checkbox => default
            .as_bool()
            .map(|_| ())
            .ok_or_else(|| fail("true или false")),
        PropertyKind::Url => default
            .as_str()
            .filter(|value| is_url(value))
            .map(|_| ())
            .ok_or_else(|| fail("адрес http(s)")),
        PropertyKind::Phone => default
            .as_str()
            .filter(|value| is_phone(value))
            .map(|_| ())
            .ok_or_else(|| fail("телефон")),
        PropertyKind::Email => default
            .as_str()
            .filter(|value| is_email(value))
            .map(|_| ())
            .ok_or_else(|| fail("email")),
    }
}

fn detect_cycle<'a>(
    schema: &'a ObjectSchema,
    name: &'a str,
    state: &mut HashMap<&'a str, u8>,
) -> Result<(), SchemaError> {
    match state.get(name) {
        Some(1) => return Err(invalid(format!("наследование типов зациклено на «{name}»"))),
        Some(2) => return Ok(()),
        _ => {}
    }
    state.insert(name, 1);
    if let Some(parent) = schema
        .types
        .iter()
        .find(|object| object.name.trim().eq_ignore_ascii_case(name))
        .and_then(parent_name)
    {
        if let Some(found) = schema
            .types
            .iter()
            .find(|object| object.name.trim().eq_ignore_ascii_case(parent))
        {
            detect_cycle(schema, found.name.trim(), state)?;
        }
    }
    state.insert(name, 2);
    Ok(())
}

fn describe(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "неизвестное значение".to_owned())
}

fn invalid(message: String) -> SchemaError {
    SchemaError::Invalid { message }
}

fn is_bool(text: &str) -> bool {
    matches!(
        text.trim().to_ascii_lowercase().as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off"
    )
}

fn is_url(value: &str) -> bool {
    let value = value.trim();
    let Some(rest) = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
    else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    !host.is_empty() && !host.chars().any(char::is_whitespace)
}

fn is_phone(value: &str) -> bool {
    let value = value.trim();
    let digits = value
        .chars()
        .filter(|symbol| symbol.is_ascii_digit())
        .count();
    digits >= 5
        && value.chars().all(|symbol| {
            symbol.is_ascii_digit() || matches!(symbol, '+' | '-' | ' ' | '(' | ')' | '.')
        })
}

fn is_email(value: &str) -> bool {
    let value = value.trim();
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !value.chars().any(char::is_whitespace)
}

fn date_matches(value: &str, format: Option<&str>) -> bool {
    match format {
        Some(format) => matches_format(value.trim(), format),
        None => note_date::parse(value).is_some(),
    }
}

enum DateToken {
    Year(usize),
    Digits(usize, i64, i64),
    Literal(char),
}

fn date_tokens(format: &str) -> Vec<DateToken> {
    let mut tokens = Vec::new();
    let mut rest = format;
    while let Some(symbol) = rest.chars().next() {
        let (token, length) = if rest.starts_with("YYYY") {
            (DateToken::Year(4), 4)
        } else if rest.starts_with("YY") {
            (DateToken::Year(2), 2)
        } else if rest.starts_with("MM") {
            (DateToken::Digits(2, 1, 12), 2)
        } else if rest.starts_with("DD") {
            (DateToken::Digits(2, 1, 31), 2)
        } else if rest.starts_with("HH") {
            (DateToken::Digits(2, 0, 23), 2)
        } else if rest.starts_with("mm") {
            (DateToken::Digits(2, 0, 59), 2)
        } else if rest.starts_with("ss") {
            (DateToken::Digits(2, 0, 59), 2)
        } else {
            (DateToken::Literal(symbol), symbol.len_utf8())
        };
        tokens.push(token);
        rest = &rest[length..];
    }
    tokens
}

fn matches_format(value: &str, format: &str) -> bool {
    let mut rest = value;
    for token in date_tokens(format) {
        match token {
            DateToken::Literal(expected) => {
                let Some(actual) = rest.chars().next() else {
                    return false;
                };
                if actual != expected {
                    return false;
                }
                rest = &rest[actual.len_utf8()..];
            }
            DateToken::Year(length) => {
                let Some((number, tail)) = take_number(rest, length) else {
                    return false;
                };
                if !(0..=9999).contains(&number) {
                    return false;
                }
                rest = tail;
            }
            DateToken::Digits(length, min, max) => {
                let Some((number, tail)) = take_number(rest, length) else {
                    return false;
                };
                if number < min || number > max {
                    return false;
                }
                rest = tail;
            }
        }
    }
    rest.is_empty()
}

fn take_number(value: &str, length: usize) -> Option<(i64, &str)> {
    let digits: String = value.chars().take(length).collect();
    if digits.chars().count() < length || !digits.chars().all(|symbol| symbol.is_ascii_digit()) {
        return None;
    }
    let number = digits.parse().ok()?;
    Some((number, &value[digits.len()..]))
}
