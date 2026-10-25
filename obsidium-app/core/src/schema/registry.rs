use super::model::{declared_types, note_type, ObjectSchema, ObjectType, Violation};
use super::validate;
use super::SchemaError;
use crate::files::document::write_file_atomic_impl;
use crate::history::OBSIDIUM_FOLDER;
use crate::search::fields::Field;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

const SCHEMA_FILE: &str = "schema.json";

#[derive(Debug)]
pub struct SchemaRegistry {
    root: PathBuf,
    cache: RwLock<Option<Cached>>,
}

#[derive(Debug)]
struct Cached {
    stamp: Option<Stamp>,
    schema: ObjectSchema,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    size: u64,
}

impl SchemaRegistry {
    pub fn load(root: impl AsRef<Path>) -> Result<Self, SchemaError> {
        let registry = Self {
            root: root.as_ref().to_path_buf(),
            cache: RwLock::new(None),
        };
        registry.refresh()?;
        Ok(registry)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path(&self) -> PathBuf {
        self.root.join(OBSIDIUM_FOLDER).join(SCHEMA_FILE)
    }

    pub fn schema(&self) -> Result<ObjectSchema, SchemaError> {
        if let Some(schema) = self.cached() {
            return Ok(schema);
        }
        self.refresh()
    }

    pub fn save(&self, schema: &ObjectSchema) -> Result<(), SchemaError> {
        validate::validate_schema(schema)?;
        let path = self.path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| SchemaError::Io {
                message: format!("{}: {error}", parent.display()),
            })?;
        }
        let json = serde_json::to_string_pretty(schema).map_err(|error| SchemaError::Invalid {
            message: format!("схема не сериализуется: {error}"),
        })?;
        write_file_atomic_impl(&path, &format!("{json}\n"), None).map_err(|error| {
            SchemaError::Io {
                message: format!("{}: {error}", path.display()),
            }
        })?;
        *self.cache.write().unwrap() = Some(Cached {
            stamp: stamp_of(&path),
            schema: schema.clone(),
        });
        Ok(())
    }

    pub fn type_of(&self, fields: &[Field]) -> Result<Vec<ObjectType>, SchemaError> {
        if declared_types(fields).is_empty() {
            return Ok(vec![note_type()]);
        }
        let schema = self.schema()?;
        Ok(validate::type_of(&schema, fields))
    }

    pub fn validate_note(&self, schema: &ObjectSchema, fields: &[Field]) -> Vec<Violation> {
        validate::note_violations(schema, fields)
    }

    fn cached(&self) -> Option<ObjectSchema> {
        let stamp = stamp_of(&self.path());
        let cache = self.cache.read().unwrap();
        let entry = cache.as_ref()?;
        (entry.stamp == stamp).then(|| entry.schema.clone())
    }

    fn refresh(&self) -> Result<ObjectSchema, SchemaError> {
        let path = self.path();
        let stamp = stamp_of(&path);
        let schema = read_schema(&path)?;
        *self.cache.write().unwrap() = Some(Cached {
            stamp,
            schema: schema.clone(),
        });
        Ok(schema)
    }
}

pub struct SchemaStore {
    roots: Mutex<HashMap<PathBuf, Arc<SchemaRegistry>>>,
}

impl SchemaStore {
    pub fn new() -> Self {
        Self {
            roots: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self, root: &Path) -> Result<Arc<SchemaRegistry>, SchemaError> {
        let root = crate::search::paths::canonical_path(root);
        if let Some(found) = self.roots.lock().unwrap().get(&root).cloned() {
            return Ok(found);
        }
        let registry = Arc::new(SchemaRegistry::load(&root)?);
        let mut roots = self.roots.lock().unwrap();
        Ok(Arc::clone(roots.entry(root).or_insert(registry)))
    }
}

impl Default for SchemaStore {
    fn default() -> Self {
        Self::new()
    }
}

fn read_schema(path: &Path) -> Result<ObjectSchema, SchemaError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(ObjectSchema::default());
        }
        Err(error) => {
            return Err(SchemaError::Io {
                message: format!("{}: {error}", path.display()),
            });
        }
    };
    let schema: ObjectSchema =
        serde_json::from_str(&text).map_err(|error| SchemaError::Invalid {
            message: format!("{}: {error}", path.display()),
        })?;
    validate::validate_schema(&schema)?;
    Ok(schema)
}

fn stamp_of(path: &Path) -> Option<Stamp> {
    fs::metadata(path).ok().map(|meta| Stamp {
        modified: meta.modified().ok(),
        size: meta.len(),
    })
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
