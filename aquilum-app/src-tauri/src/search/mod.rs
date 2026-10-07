pub(crate) mod analyzer;
pub(crate) mod analysis;
pub(crate) mod commands;
mod created;
pub(crate) mod dataview;
mod error;
mod guest;
mod markdown;
pub(crate) mod fields;
pub(crate) mod graph;
pub(crate) mod headings;
mod index;
mod index_document;
#[cfg(test)]
mod index_tests;
#[cfg(test)]
mod benches;
mod matching;
mod metadata;
mod models;
pub(crate) mod note_date;
pub(crate) mod paths;
mod progress;
mod query;
pub(crate) mod schema;
mod service;
mod suggest;
mod sync;
mod tasks;
pub(crate) mod wiki;
mod worker;

pub(crate) use analyzer::ANALYZER_VERSION;

use std::path::PathBuf;
use std::sync::Arc;

use models::IndexRevision;

pub(crate) use service::SearchService;
pub(crate) type ChangeNotifier = Arc<dyn Fn(Vec<PathBuf>) + Send + Sync>;
pub(crate) type IndexNotifier = Arc<dyn Fn(IndexRevision) + Send + Sync>;
pub(crate) const WORKSPACE_CHANGED_EVENT: &str = "workspace-changed";
pub(crate) const LINKS_CHANGED_EVENT: &str = "links-changed";
