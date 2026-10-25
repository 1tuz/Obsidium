use super::eval::{evaluate, Scope};
use super::parser;
use super::rows::{self, Row};
use super::value::Value;
use crate::search::created;
use crate::search::error::SearchError;
use crate::search::fields::head_fields;
use crate::search::note_date;
use crate::search::paths::{canonical_path, relative_slash_path};
use crate::search::service::SearchService;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineRequest {
    pub id: String,
    pub expr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineResult {
    pub id: String,
    pub value: String,
    pub error: Option<String>,
}

pub fn evaluate_expression(row: &Row, text: &str) -> Result<Value, String> {
    let source = text.trim();
    let source = source.strip_prefix('=').map(str::trim).unwrap_or(source);
    if source.is_empty() {
        return Err("После «=» нужна формула, например = file.name".to_owned());
    }
    let parsed = parser::parse_expression(source)?;
    evaluate(
        &parsed,
        &Scope {
            note: Some(row),
            vars: &[],
            local: None,
        },
    )
}

pub fn evaluate_requests(row: &Row, requests: &[InlineRequest]) -> Vec<InlineResult> {
    requests
        .iter()
        .map(|request| match evaluate_expression(row, &request.expr) {
            Ok(value) => InlineResult {
                id: request.id.clone(),
                value: value.text(),
                error: None,
            },
            Err(message) => InlineResult {
                id: request.id.clone(),
                value: String::new(),
                error: Some(message),
            },
        })
        .collect()
}

impl SearchService {
    pub fn evaluate_inline_expressions(
        &self,
        workspace: &str,
        note: &str,
        requests: &[InlineRequest],
        tz_offset_minutes: i64,
    ) -> Result<Vec<InlineResult>, SearchError> {
        if requests.is_empty() {
            return Ok(Vec::new());
        }
        note_date::set_local_offset(tz_offset_minutes * 60);
        let path = canonical_path(Path::new(note));
        let row = self.with_metadata(workspace, |open, connection| {
            if !path.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Note is outside the workspace",
                ));
            }
            load_note(connection, &open.root, &path)
        })?;
        let results = evaluate_requests(&row, requests);
        note_date::take_now_used();
        Ok(results)
    }
}

fn load_note(connection: &Connection, root: &Path, path: &Path) -> Result<Row, SearchError> {
    let key = path.to_string_lossy().into_owned();
    let mut found = rows::load(connection, root, std::slice::from_ref(&key))?;
    match found.pop() {
        Some(row) => Ok(row),
        None => Ok(unindexed_note(root, path)),
    }
}

fn unindexed_note(root: &Path, path: &Path) -> Row {
    let metadata = std::fs::metadata(path).ok();
    let modified = metadata
        .as_ref()
        .and_then(|found| found.modified().ok())
        .and_then(|moment| moment.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos() as i64)
        .unwrap_or_default();
    let created = metadata
        .as_ref()
        .map(|found| created::from_file_metadata(found).nanos)
        .filter(|nanos| *nanos != 0)
        .unwrap_or(modified);
    let relative = relative_slash_path(root, path);
    Row {
        source: path.to_string_lossy().into_owned(),
        name: rows::note_name(&relative),
        folder: rows::folder_of(&relative),
        created,
        modified,
        size: metadata.map(|found| found.len() as i64).unwrap_or_default(),
        fields: head_fields(path),
        tasks: Vec::new(),
        relative,
    }
}
