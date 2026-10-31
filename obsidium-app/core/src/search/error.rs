use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "details", rename_all = "snake_case")]
pub enum SearchError {
    Io { message: String },
    Index { message: String },
    Database { message: String },
    InvalidWorkspace { message: String },
    OutsideWorkspace { path: String },
    Task { message: String },
    Unavailable { message: String },
    Query { message: String },
}

impl SearchError {
    pub fn task(error: impl ToString) -> Self {
        Self::Task {
            message: error.to_string(),
        }
    }

    pub fn invalid_workspace(message: &str) -> Self {
        Self::InvalidWorkspace {
            message: message.to_owned(),
        }
    }
}

impl From<std::io::Error> for SearchError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

impl From<crate::files::error::FileCommandError> for SearchError {
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

impl From<tantivy::TantivyError> for SearchError {
    fn from(error: tantivy::TantivyError) -> Self {
        Self::Index {
            message: error.to_string(),
        }
    }
}

impl From<rusqlite::Error> for SearchError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database {
            message: error.to_string(),
        }
    }
}

impl From<notify::Error> for SearchError {
    fn from(error: notify::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

impl From<crate::app_core::TaskFailed> for SearchError {
    fn from(error: crate::app_core::TaskFailed) -> Self {
        Self::task(error)
    }
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { message }
            | Self::Index { message }
            | Self::Database { message }
            | Self::InvalidWorkspace { message }
            | Self::Task { message }
            | Self::Unavailable { message }
            | Self::Query { message } => formatter.write_str(message),
            Self::OutsideWorkspace { path } => {
                write!(formatter, "путь вне разрешённых баз знаний: {path}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SearchError;
    use crate::files::error::FileCommandError;
    use serde_json::json;

    #[test]
    fn path_access_errors_keep_the_same_code_across_command_errors() {
        let expected = json!({
            "code": "outside_workspace",
            "details": { "path": "/outside" }
        });
        let outside = || FileCommandError::OutsideWorkspace {
            path: "/outside".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(SearchError::from(outside())).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(crate::schema::SchemaError::from(outside())).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(crate::journal::JournalError::from(outside())).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(crate::ui_state::error::UiStateError::from(outside())).unwrap(),
            expected
        );
    }
}
