pub mod service;

#[cfg(test)]
mod tests;

pub use crate::settings::models::JournalSettings;
pub use service::{link_target, list_dates, note_path, today};

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalNote {
    pub path: PathBuf,
    pub created: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum JournalError {
    Io { message: String },
    OutsideWorkspace { path: String },
    Settings { message: String },
    Date { message: String },
    Template { message: String },
    Task { message: String },
}

impl From<crate::files::error::FileCommandError> for JournalError {
    fn from(error: crate::files::error::FileCommandError) -> Self {
        match error {
            crate::files::error::FileCommandError::OutsideWorkspace { path } => {
                Self::OutsideWorkspace { path }
            }
            error => Self::Io {
                message: error.to_string(),
            },
        }
    }
}

impl From<crate::app_core::TaskFailed> for JournalError {
    fn from(error: crate::app_core::TaskFailed) -> Self {
        Self::Task {
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { message }
            | Self::Settings { message }
            | Self::Date { message }
            | Self::Template { message }
            | Self::Task { message } => formatter.write_str(message),
            Self::OutsideWorkspace { path } => {
                write!(formatter, "путь вне разрешённых баз знаний: {path}")
            }
        }
    }
}
