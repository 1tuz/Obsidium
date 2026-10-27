use super::repository::candidate_sources;
use super::target::title_key;
use super::{backlinks, outgoing_links, plan_for_renames, resolve_many, LinkRewrite};
use crate::search::error::SearchError;
use crate::search::models::{Backlink, OutgoingLink, WikiLinkResolution};
use crate::search::paths::markdown_files;
use crate::search::paths::{canonical_path, is_markdown, strip_root};
use crate::search::service::SearchService;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

impl SearchService {
    pub fn validate_rename_destination(
        &self,
        old_path: &Path,
        new_path: &Path,
    ) -> Result<PathBuf, SearchError> {
        let old_path = canonical_path(old_path);
        let found = self.with_metadata_containing(&old_path, |open, _| {
            if !old_path.starts_with(&open.root) {
                return Err(SearchError::invalid_workspace(
                    "Rename is outside workspace",
                ));
            }
            canonical_destination(&open.root, new_path)
        })?;
        found.ok_or_else(|| SearchError::invalid_workspace("Rename is outside workspace"))
    }

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
        self.plan_links_for_renames(&[(old_path.to_path_buf(), new_path.to_path_buf())])
    }

    pub fn plan_links_for_renames(
        &self,
        renames: &[(PathBuf, PathBuf)],
    ) -> Result<Vec<LinkRewrite>, SearchError> {
        if renames.is_empty() {
            return Ok(Vec::new());
        }
        let renames = renames
            .iter()
            .map(|(old_path, new_path)| (canonical_path(old_path), canonical_path(new_path)))
            .collect::<Vec<_>>();
        let found = self.with_metadata_containing(&renames[0].0, |open, connection| {
            if renames.iter().any(|(old_path, new_path)| {
                !old_path.starts_with(&open.root) || !new_path.starts_with(&open.root)
            }) {
                return Err(SearchError::invalid_workspace(
                    "Rename is outside workspace",
                ));
            }
            let updating = open.progress.snapshot().updating;
            let sources = rename_sources(connection, &open.root, &renames, updating)?;
            let fallback_candidates = updating.then(|| {
                renames
                    .iter()
                    .map(|(old_path, _)| {
                        let old_title = title_key(old_path);
                        (
                            old_path.clone(),
                            sources
                                .iter()
                                .filter(|path| title_key(path) == old_title)
                                .map(|path| path.to_string_lossy().into_owned())
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect::<Vec<_>>()
            });
            plan_for_renames(
                connection,
                &open.root,
                &renames,
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

fn safe_source_paths(root: &Path, sources: Vec<PathBuf>) -> Vec<PathBuf> {
    let root = canonical_path(root);
    let mut sources = sources
        .into_iter()
        .map(|path| canonical_path(&path))
        .filter(|path| strip_root(&root, path).is_some() && path.is_file() && is_markdown(path))
        .collect::<Vec<_>>();
    sources.sort();
    sources.dedup();
    sources
}

fn rename_sources(
    connection: &rusqlite::Connection,
    root: &Path,
    renames: &[(PathBuf, PathBuf)],
    updating: bool,
) -> Result<Vec<PathBuf>, SearchError> {
    let full_scan = updating || renames.iter().any(|(path, _)| !is_markdown(path));
    let mut sources = if full_scan {
        markdown_files(root).collect::<Vec<_>>()
    } else {
        let mut sources = Vec::new();
        for (old_path, _) in renames {
            sources.extend(
                candidate_sources(connection, root, old_path)?
                    .into_iter()
                    .map(PathBuf::from),
            );
            sources.push(old_path.clone());
        }
        sources
    };
    sources.sort();
    sources.dedup();
    Ok(safe_source_paths(root, sources))
}

fn canonical_destination(root: &Path, new_path: &Path) -> Result<PathBuf, SearchError> {
    let root = std::fs::canonicalize(root)?;
    let parent = new_path
        .parent()
        .ok_or_else(|| SearchError::invalid_workspace("Rename target has no parent"))?;
    let parent = std::fs::canonicalize(parent)?;
    if !parent.starts_with(&root) {
        return Err(SearchError::invalid_workspace(
            "Rename is outside workspace",
        ));
    }
    let Some(Component::Normal(name)) = new_path.components().last() else {
        return Err(SearchError::invalid_workspace("Invalid rename target"));
    };
    Ok(parent.join(name))
}

#[cfg(test)]
mod rename_destination_tests {
    use super::{canonical_destination, rename_sources, safe_source_paths, SearchService};
    use crate::search::models::IndexRevision;
    use crate::search::wiki::repository::{candidate_sources, open_schema};
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn canonicalizes_workspace_destination_and_rejects_parent_traversal() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let outside = directory.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();

        assert!(canonical_destination(&root, &root.join("../outside/Note.md")).is_err());
        fs::create_dir(root.join("folder")).unwrap();
        assert_eq!(
            canonical_destination(&root, &root.join("folder/Note.md")).unwrap(),
            fs::canonicalize(&root).unwrap().join("folder/Note.md")
        );
    }

    #[test]
    fn destination_validation_requires_a_workspace_index() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        fs::create_dir(&root).unwrap();
        let service = SearchService::new(
            directory.path().join("indexes"),
            Arc::new(|_: Vec<PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        );

        assert!(service
            .validate_rename_destination(&root.join("Folder"), &root.join("Folder/Note.md"))
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_parent_that_resolves_outside_the_workspace() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let outside = directory.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        assert!(canonical_destination(&root, &root.join("linked/Note.md")).is_err());
    }

    #[test]
    fn ignores_an_indexed_link_source_outside_the_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let outside = directory.path().join("Outside.md");
        let target = root.join("Target.md");
        fs::create_dir(&root).unwrap();
        fs::write(&outside, "[[Target]]").unwrap();

        let connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO wiki_documents(path, relative_key, title_key) VALUES(?1, ?2, ?3)",
                params![outside.to_string_lossy(), "Outside.md", "outside"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO wiki_links(source_path, target_key, target_kind, link_type, byte_offset, offset_utf16)
                 VALUES(?1, 'target', 'name', 'wiki', 0, 0)",
                [outside.to_string_lossy().as_ref()],
            )
            .unwrap();

        let indexed_sources = candidate_sources(&connection, &root, &target).unwrap();
        assert_eq!(indexed_sources.len(), 1);
        assert!(safe_source_paths(
            &root,
            indexed_sources.into_iter().map(PathBuf::from).collect(),
        )
        .is_empty());
    }

    #[test]
    fn scans_markdown_sources_when_a_renamed_path_is_an_attachment() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let folder = root.join("Project");
        let note = folder.join("Note.md");
        let attachment = folder.join("image.png");
        let external = root.join("Index.md");
        fs::create_dir_all(&folder).unwrap();
        fs::write(&note, "![image](image.png)").unwrap();
        fs::write(&attachment, [0, 1, 2]).unwrap();
        fs::write(&external, "[image](Project/image.png)").unwrap();

        let connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let sources = rename_sources(
            &connection,
            &root,
            &[
                (note.clone(), root.join("Archive/Note.md")),
                (attachment, root.join("Archive/image.png")),
            ],
            false,
        )
        .unwrap();

        assert!(sources.contains(&fs::canonicalize(note).unwrap()));
        assert!(sources.contains(&fs::canonicalize(external).unwrap()));
    }

    #[test]
    fn plans_attachment_link_rewrites_from_a_ready_workspace_index() {
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let folder = root.join("Project");
        let note = folder.join("Note.md");
        let attachment = folder.join("image.png");
        let external = root.join("Index.md");
        fs::create_dir_all(&folder).unwrap();
        fs::write(&note, "![image](image.png)").unwrap();
        fs::write(&attachment, [0, 1, 2]).unwrap();
        fs::write(&external, "[image](Project/image.png?x#y)").unwrap();

        let service = SearchService::new(
            directory.path().join("indexes"),
            Arc::new(|_: Vec<PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        );
        let workspace = fs::canonicalize(&root).unwrap();
        let workspace_text = workspace.to_string_lossy();
        service.prepare(&workspace_text).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let status = service.status(Some(&workspace_text));
            if !status.updating {
                assert!(status.indexed_documents >= 2);
                break;
            }
            assert!(
                Instant::now() < deadline,
                "workspace indexing did not finish"
            );
            std::thread::sleep(Duration::from_millis(5));
        }

        let plan = service
            .plan_links_for_renames(&[(attachment.clone(), workspace.join("Archive/image.png"))])
            .unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].path, fs::canonicalize(external).unwrap());
        assert_eq!(plan[0].content, "[image](Archive/image.png?x#y)");
        let open = service.active.write().unwrap().take();
        if let Some(open) = open {
            open.stop();
        }
    }
}
