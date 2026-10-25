//! The Obsidium core: notes on disk, documents, search, history, settings and UI state, with no
//! knowledge of the UI that hosts it. The Tauri shell and a future native UI both call it directly.

#[cfg(test)]
pub(crate) mod legacy_name;

pub mod app_core;
pub mod documents;
pub mod files;
pub mod history;
pub mod journal;
pub mod link_title;
pub mod links;
pub mod mcp;
pub mod migration;
pub mod schema;
pub mod search;
pub mod settings;
pub mod spaces;
pub mod ui_state;
pub mod web_agent;
pub mod wiki;
pub mod wikixiv;

pub use app_core::{Core, CoreEvent, EventSink, TaskFailed};
