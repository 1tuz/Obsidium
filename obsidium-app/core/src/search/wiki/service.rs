use super::repository::candidate_sources;
use super::target::title_key;
use super::{backlinks, outgoing_links, plan_for_rename, resolve_many, LinkRewrite};
use crate::search::error::SearchError;
use crate::search::models::{Backlink, OutgoingLink, WikiLinkResolution};
use crate::search::paths::canonical_path;
use crate::search::paths::markdown_files;
use crate::search::service::SearchService;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

impl SearchService {
    pub fn backlinks(&self, workspace: &str, document: &str) -> Result<Vec<Backlink>, SearchError> {
        let document = canonical_path(Path::new(document));
        self.with_metadata(workspace, |open, connection| {
            if !document.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Document is outside workspace",
                ));
            }
            backlinks(connection, &open.root, &document)
        })
    }

    pub fn paths_by_title(
        &self,
        workspace: &str,
        title: &str,
    ) -> Result<Option<Vec<PathBuf>>, SearchError> {
        let needle = title_key(Path::new(title.trim().trim_end_matches(".md")));
        if needle.is_empty() {
            return Ok(None);
        }
        let status = self.status(Some(workspace));
        if status.updating || status.indexed_documents == 0 {
            return Ok(None);
        }
        self.with_metadata(workspace, |open, connection| {
            let mut statement =
                connection.prepare("SELECT path FROM wiki_documents WHERE title_key = ?1")?;
            let rows = statement.query_map([needle], |row| row.get::<_, String>(0))?;
            let mut paths = Vec::new();
            for row in rows {
                let path = PathBuf::from(row?);
                if path.is_file() && path.starts_with(&open.root) {
                    paths.push(path);
                }
            }
            paths.sort();
            Ok(paths)
        })
        .map(Some)
    }

    pub fn backlink_counts(
        &self,
        workspace: &str,
        documents: &[String],
    ) -> Result<Vec<usize>, SearchError> {
        let documents = documents
            .iter()
            .map(|document| canonical_path(Path::new(document)))
            .collect::<Vec<_>>();
        self.with_metadata(workspace, |open, connection| {
            documents
                .iter()
                .map(|document| {
                    let own = document.to_string_lossy();
                    let links = backlinks(connection, &open.root, document)?;
                    Ok(links
                        .iter()
                        .map(|link| link.path.as_str())
                        .filter(|path| *path != own)
                        .collect::<HashSet<_>>()
                        .len())
                })
                .collect()
        })
    }

    pub fn outgoing_links(
        &self,
        workspace: &str,
        document: &str,
    ) -> Result<Vec<OutgoingLink>, SearchError> {
        let document = canonical_path(Path::new(document));
        self.with_metadata(workspace, |open, connection| {
            if !document.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Document is outside workspace",
                ));
            }
            outgoing_links(connection, &open.root, &document)
        })
    }

    pub fn resolve_wiki_links(
        &self,
        workspace: &str,
        source: &str,
        targets: &[String],
    ) -> Result<WikiLinkResolution, SearchError> {
        let source = canonical_path(Path::new(source));
        self.with_metadata(workspace, |open, connection| {
            if !source.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Source is outside workspace",
                ));
            }
            Ok(WikiLinkResolution {
                paths: resolve_many(connection, &open.root, &source, targets)?
                    .into_iter()
                    .map(|path| path.map(|value| value.to_string_lossy().into_owned()))
                    .collect(),
                complete: !open.progress.snapshot().updating,
            })
        })
    }

    pub fn plan_links_for_rename(
        &self,
        old_path: &Path,
        new_path: &Path,
    ) -> Result<Vec<LinkRewrite>, SearchError> {
        let old_path = canonical_path(old_path);
        let new_path = canonical_path(new_path);
        let found = self.with_metadata_containing(&old_path, |open, connection| {
            if !new_path.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Rename is outside workspace",
                ));
            }
            let updating = open.progress.snapshot().updating;
            let sources = if updating {
                markdown_files(&open.root).collect::<Vec<_>>()
            } else {
                candidate_sources(connection, &open.root, &old_path)?
                    .into_iter()
                    .map(PathBuf::from)
                    .collect()
            };
            let fallback_candidates = updating.then(|| {
                let old_title = title_key(&old_path);
                sources
                    .iter()
                    .filter(|path| title_key(path) == old_title)
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            });
            plan_for_rename(
                connection,
                &open.root,
                &old_path,
                &new_path,
                sources,
                fallback_candidates.as_deref(),
            )
        })?;
        match found {
            Some(rewrites) => Ok(rewrites),
            None if self.active_root().is_some() => Err(SearchError::invalid_workspace(
                "Rename is outside workspace",
            )),
            None => Ok(Vec::new()),
        }
    }
}
