pub(crate) mod attachments;
pub(crate) mod commands;
pub(crate) mod deletions;
pub(crate) mod document;
pub(crate) mod error;
pub(crate) mod gate;
pub(crate) mod models;
mod rename;
pub(crate) mod relocate;
pub(crate) mod trash;
pub(crate) mod watcher;
mod workspace;

#[cfg(test)]
mod tests;
