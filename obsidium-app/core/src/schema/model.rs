use crate::search::fields::{Field, FieldKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION: u32 = 1;
pub const NOTE_TYPE: &str = "Note";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectSchema {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub types: Vec<ObjectType>,
}

impl Default for ObjectSchema {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            types: Vec::new(),
        }
    }
}

fn default_version() -> u32 {
    SCHEMA_VERSION
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectType {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    #[serde(default)]
    pub properties: Vec<PropertyDefinition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropertyDefinition {
    pub name: String,
    pub kind: PropertyKind,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropertyKind {
    Text,
    Number,
    Date,
    Tags,
    Select,
    MultiSelect,
    Checkbox,
    Url,
    Phone,
    Email,
}

impl PropertyKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Text => "текст",
            Self::Number => "число",
            Self::Date => "дата",
            Self::Tags => "теги",
            Self::Select => "одно значение из списка",
            Self::MultiSelect => "несколько значений из списка",
            Self::Checkbox => "true или false",
            Self::Url => "адрес http(s)",
            Self::Phone => "телефон",
            Self::Email => "email",
        }
    }

    pub fn uses_options(self) -> bool {
        matches!(self, Self::Select | Self::MultiSelect)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Violation {
    pub property: String,
    pub reason: String,
}

impl Violation {
    pub fn new(property: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            property: property.into(),
            reason: reason.into(),
        }
    }
}

pub fn note_type() -> ObjectType {
    ObjectType {
        name: NOTE_TYPE.to_owned(),
        ..ObjectType::default()
    }
}

pub fn field_value<'a>(fields: &'a [Field], name: &str) -> Option<&'a Field> {
    fields
        .iter()
        .find(|field| field.key.trim().eq_ignore_ascii_case(name))
}

pub fn field_values(field: &Field) -> Vec<String> {
    match field.kind {
        FieldKind::List => field
            .items
            .iter()
            .map(|item| item.trim().to_owned())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => {
            let value = field.text.trim();
            if value.is_empty() {
                Vec::new()
            } else {
                vec![value.to_owned()]
            }
        }
    }
}

pub fn declared_types(fields: &[Field]) -> Vec<String> {
    field_value(fields, "type")
        .map(field_values)
        .unwrap_or_default()
}
