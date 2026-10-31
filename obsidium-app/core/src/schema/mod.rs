pub mod model;
pub mod registry;
pub mod validate;

pub use model::{
    note_type, ObjectSchema, ObjectType, PropertyDefinition, PropertyKind, Violation, NOTE_TYPE,
    SCHEMA_VERSION,
};
pub use registry::{SchemaRegistry, SchemaStore};

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum SchemaError {
    Io { message: String },
    Invalid { message: String },
    OutsideWorkspace { path: String },
}

impl std::fmt::Display for SchemaError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { message } | Self::Invalid { message } => formatter.write_str(message),
            Self::OutsideWorkspace { path } => {
                write!(formatter, "путь вне разрешённых баз знаний: {path}")
            }
        }
    }
}

impl std::error::Error for SchemaError {}

impl From<std::io::Error> for SchemaError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

impl From<crate::files::error::FileCommandError> for SchemaError {
    fn from(error: crate::files::error::FileCommandError) -> Self {
        match error {
            crate::files::error::FileCommandError::OutsideWorkspace { path } => {
                Self::OutsideWorkspace { path }
            }
            error => Self::Invalid {
                message: error.to_string(),
            },
        }
    }
}

impl From<crate::app_core::TaskFailed> for SchemaError {
    fn from(error: crate::app_core::TaskFailed) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
#[path = "validate_tests.rs"]
mod validate_tests;
