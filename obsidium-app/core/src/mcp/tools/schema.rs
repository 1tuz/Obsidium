use super::frontmatter;
use super::workspace::workspace_vault;
use super::{flag, optional_text, require_write, text, tool, workspace_property};
use crate::app_core::Core;
use crate::files::document::ensure_directory_impl;
use crate::files::gate;
use crate::history::Source;
use crate::schema::model::{ObjectSchema, ObjectType, PropertyDefinition, NOTE_TYPE};
use crate::schema::registry::SchemaRegistry;
use crate::schema::validate;
use crate::search::analyzer::frontmatter::FieldValue;
use crate::search::analyzer::frontmatter_set;
use crate::search::fields::note_fields;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Arc;

const SCHEMA_ERROR: &str = "Схема базы знаний не читается";

pub fn definitions() -> Vec<Value> {
    vec![
        tool(
            "describe_schema",
            "Показать схему типов базы знаний из .obsidium/schema.json: какие типы объектов описаны, какие у них иконки, цвета, наследование и свойства — с типом значения, обязательностью, вариантами выбора, значением по умолчанию и форматом. types оставляет только перечисленные типы без учёта регистра; includeRelations: false убирает раздел связей. Схема только читается, заметки не меняются.",
            json!({
                "types": { "type": "array", "items": { "type": "string" }, "description": "Какие типы вернуть, например [\"Book\"]; без него возвращаются все типы схемы" },
                "includeRelations": { "type": "boolean", "description": "Добавить раздел связей в ответ; по умолчанию true" },
                "workspace": workspace_property(),
            }),
            &["workspace"],
        ),
        tool(
            "create_typed_note",
            "Создать заметку описанного в схеме типа: в frontmatter пишутся type и переданные properties, в теле — заголовок первого уровня. Свойства проверяются по схеме до записи, поэтому при нарушении файл не создаётся. Значения по умолчанию из схемы не подставляются. Тип Note встроенный — обычную заметку создаёт create_note. Существующий файл не перезаписывается, вкладка не открывается.",
            json!({
                "type": { "type": "string", "description": "Имя типа из схемы, например Book; тип Note встроенный и здесь не принимается" },
                "title": { "type": "string", "description": "Заголовок заметки: он же имя файла, если не указана folder" },
                "folder": { "type": "string", "description": "Папка для заметки; по умолчанию корень базы знаний" },
                "properties": { "type": "object", "description": "Свойства frontmatter по схеме, например {\"author\": \"Лем\", \"pages\": 320}; null удаляет свойство, список строк пишется блочным списком", "additionalProperties": true },
                "workspace": workspace_property(),
            }),
            &["workspace", "type", "title"],
        ),
    ]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "describe_schema" => describe_schema(core, arguments),
        "create_typed_note" => create_typed_note(core, arguments),
        _ => return None,
    })
}

fn describe_schema(core: &Core, arguments: &Value) -> Result<Value, String> {
    let workspace = text(arguments, "workspace")?;
    let vault = workspace_vault(core, &workspace)?;
    let (_, schema) = load_schema(core, &vault.root)?;
    let wanted = requested_types(arguments)?;
    let types = select_types(&schema, &wanted)?;
    let mut answer = json!({
        "types": types
            .iter()
            .map(|object| describe_type(object))
            .collect::<Vec<_>>(),
        "noteType": NOTE_TYPE,
    });
    if flag(arguments, "includeRelations", true) {
        answer["relations"] = json!([]);
    }
    Ok(answer)
}

fn create_typed_note(core: &Core, arguments: &Value) -> Result<Value, String> {
    require_write(core)?;
    let workspace = text(arguments, "workspace")?;
    let vault = workspace_vault(core, &workspace)?;
    let (registry, schema) = load_schema(core, &vault.root)?;
    let type_name = text(arguments, "type")?;
    if type_name.eq_ignore_ascii_case(NOTE_TYPE) {
        return Err(
            "Тип Note встроенный: заметка без type: уже Note — обычную заметку создаёт create_note"
                .to_owned(),
        );
    }
    let object =
        validate::resolve(&schema, &type_name).ok_or_else(|| unknown_type(&type_name, &schema))?;
    let title = text(arguments, "title")?;
    if title.contains(['\n', '\r']) {
        return Err("Заголовок не может быть многострочным".to_owned());
    }
    let mut updates = vec![(
        "type".to_owned(),
        FieldValue::Scalar(serde_json::to_string(&object.name).map_err(|error| error.to_string())?),
    )];
    updates.extend(property_updates(arguments)?);
    let block = frontmatter_set("", &updates)?;
    let content = format!("{block}\n# {title}\n");
    let violations = registry.validate_note(&schema, &note_fields(&content));
    if !violations.is_empty() {
        return Err(format!(
            "Свойства не соответствуют схеме «{}»: {}",
            object.name,
            violations
                .iter()
                .map(|violation| format!("{}: {}", violation.property, violation.reason))
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }
    let folder = optional_text(arguments, "folder").unwrap_or_default();
    let requested = if folder.trim().is_empty() {
        title.clone()
    } else {
        format!(
            "{}/{title}",
            folder
                .trim()
                .trim_end_matches(|symbol| symbol == '/' || symbol == '\\')
        )
    };
    let path = vault.note_path(&requested)?;
    if path.exists() {
        return Err(format!("Заметка уже существует: {}", vault.relative(&path)));
    }
    if let Some(parent) = path.parent() {
        ensure_directory_impl(parent).map_err(|error| error.to_string())?;
    }
    gate::create(core, &path, &content, Source::Agent, None).map_err(|error| error.to_string())?;
    Ok(json!({
        "path": vault.relative(&path),
        "workspace": vault.root.to_string_lossy(),
        "type": object.name,
        "created": true,
    }))
}

fn load_schema(core: &Core, root: &Path) -> Result<(Arc<SchemaRegistry>, ObjectSchema), String> {
    let registry = core
        .schema
        .registry(root)
        .map_err(|error| format!("{SCHEMA_ERROR}: {error}"))?;
    let schema = registry
        .schema()
        .map_err(|error| format!("{SCHEMA_ERROR}: {error}"))?;
    Ok((registry, schema))
}

fn requested_types(arguments: &Value) -> Result<Vec<String>, String> {
    let Some(value) = arguments.get("types") else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let list = value
        .as_array()
        .ok_or_else(|| "Аргумент «types» должен быть списком строк".to_owned())?;
    list.iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| "Аргумент «types»: строки списка не могут быть пустыми".to_owned())
        })
        .collect()
}

fn select_types<'a>(
    schema: &'a ObjectSchema,
    wanted: &[String],
) -> Result<Vec<&'a ObjectType>, String> {
    if wanted.is_empty() {
        return Ok(schema.types.iter().collect());
    }
    for name in wanted {
        if !schema
            .types
            .iter()
            .any(|object| same_name(&object.name, name))
        {
            return Err(unknown_type(name, schema));
        }
    }
    Ok(schema
        .types
        .iter()
        .filter(|object| wanted.iter().any(|name| same_name(&object.name, name)))
        .collect())
}

fn describe_type(object: &ObjectType) -> Value {
    json!({
        "name": object.name,
        "extends": object.extends,
        "icon": object.icon,
        "color": object.color,
        "properties": object
            .properties
            .iter()
            .map(describe_property)
            .collect::<Vec<_>>(),
    })
}

fn describe_property(property: &PropertyDefinition) -> Value {
    let mut value = json!({
        "name": property.name,
        "kind": property.kind,
        "options": property.options,
        "required": property.required,
    });
    if let Some(default) = &property.default {
        value["default"] = default.clone();
    }
    if let Some(format) = &property.format {
        value["format"] = json!(format);
    }
    value
}

fn property_updates(arguments: &Value) -> Result<Vec<(String, FieldValue)>, String> {
    let Some(value) = arguments.get("properties") else {
        return Ok(Vec::new());
    };
    let map: &Map<String, Value> = value.as_object().ok_or_else(|| {
        "Аргумент «properties» должен быть объектом вида {«ключ»: «значение»}".to_owned()
    })?;
    if map.is_empty() {
        return Ok(Vec::new());
    }
    if map
        .keys()
        .any(|key| key.trim().eq_ignore_ascii_case("type"))
    {
        return Err("Свойство «type» задаётся аргументом type, а не properties".to_owned());
    }
    frontmatter::updates_from(map)
}

fn same_name(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn unknown_type(name: &str, schema: &ObjectSchema) -> String {
    if schema.types.is_empty() {
        return format!("Тип «{name}» не описан: в схеме нет ни одного типа");
    }
    let names = schema
        .types
        .iter()
        .map(|object| object.name.trim())
        .collect::<Vec<_>>();
    format!(
        "Тип «{name}» не описан в схеме. Доступные типы: {}",
        names.join(", ")
    )
}
