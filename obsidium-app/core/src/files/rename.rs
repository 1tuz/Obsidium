use super::document::{
    hash_bytes, normalize_line_endings, rename_file_impl, write_file_atomic_impl,
};
use super::error::FileCommandError;
use super::models::FileRenameResult;
use crate::search::wiki::LinkRewrite;
use crate::search::SearchService;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct Renamed {
    pub result: FileRenameResult,
    pub rewritten: Vec<Rewritten>,
}

pub struct Rewritten {
    pub path: PathBuf,
    pub before: String,
    pub after: String,
    pub hash: String,
}

pub fn rename_with_links(
    service: &SearchService,
    old_path: &Path,
    new_path: &Path,
) -> Result<Renamed, FileCommandError> {
    reject_symlink_directory(old_path)?;
    let new_path = service
        .validate_rename_destination(old_path, new_path)
        .map_err(|error| FileCommandError::Task {
            message: error.to_string(),
        })?;
    if old_path.is_dir() {
        let renames = markdown_moves(old_path, &new_path)?;
        let rewrites =
            service
                .plan_links_for_renames(&renames)
                .map_err(|error| FileCommandError::Task {
                    message: error.to_string(),
                })?;
        return apply_rename(old_path, &new_path, rewrites);
    }
    let rewrites = service
        .plan_links_for_rename(old_path, &new_path)
        .map_err(|error| FileCommandError::Task {
            message: error.to_string(),
        })?;
    apply_rename(old_path, &new_path, rewrites)
}

fn apply_rename(
    old_path: &Path,
    new_path: &Path,
    rewrites: Vec<LinkRewrite>,
) -> Result<Renamed, FileCommandError> {
    let directory = old_path.is_dir();
    for rewrite in &rewrites {
        let path = source_path(&rewrite.path, old_path, new_path, false, directory);
        let actual = std::fs::read(path).map(|bytes| hash_bytes(&bytes))?;
        if actual != rewrite.original_hash {
            return Err(FileCommandError::Conflict {
                expected_hash: rewrite.original_hash.clone(),
                actual_hash: Some(actual),
            });
        }
    }
    rename_file_impl(old_path, new_path)?;
    let mut applied = Vec::new();
    for rewrite in rewrites {
        let path = source_path(&rewrite.path, old_path, new_path, true, directory);
        match write_file_atomic_impl(&path, &rewrite.content, Some(&rewrite.original_hash)) {
            Ok(written) => applied.push((path, rewrite, written.hash)),
            Err(error) => {
                let mut rollback_failures = rollback(&applied);
                if let Err(rollback_error) = rename_file_impl(new_path, old_path) {
                    rollback_failures.push(format!("restore renamed path: {rollback_error}"));
                }
                if !rollback_failures.is_empty() {
                    return Err(FileCommandError::Task {
                        message: format!(
                            "rename failed: {error}; rollback failed: {}",
                            rollback_failures.join("; ")
                        ),
                    });
                }
                return Err(error);
            }
        }
    }
    let (content, hash, text_hash) = if directory {
        (String::new(), String::new(), String::new())
    } else {
        let bytes = std::fs::read(new_path)?;
        let hash = hash_bytes(&bytes);
        match String::from_utf8(bytes) {
            Ok(content) => {
                let content = normalize_line_endings(content);
                let text_hash = hash_bytes(content.as_bytes());
                (content, hash, text_hash)
            }
            Err(_) => (String::new(), hash, String::new()),
        }
    };
    Ok(Renamed {
        result: FileRenameResult {
            content,
            hash,
            text_hash,
            updated_paths: applied
                .iter()
                .map(|(path, _, _)| path.to_string_lossy().into_owned())
                .collect(),
        },
        rewritten: applied
            .into_iter()
            .map(|(path, rewrite, hash)| Rewritten {
                path,
                before: normalize_line_endings(rewrite.original),
                after: rewrite.content,
                hash,
            })
            .collect(),
    })
}

fn reject_symlink_directory(path: &Path) -> Result<(), FileCommandError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() && path.is_dir() {
        return Err(FileCommandError::Task {
            message: "Cannot rename a directory symlink".to_owned(),
        });
    }
    Ok(())
}

fn rollback(applied: &[(PathBuf, LinkRewrite, String)]) -> Vec<String> {
    let mut failures = Vec::new();
    for (path, rewrite, written_hash) in applied.iter().rev() {
        if let Err(error) = write_file_atomic_impl(path, &rewrite.original, Some(written_hash)) {
            failures.push(format!("restore {}: {error}", path.display()));
        }
    }
    failures
}

fn source_path(
    stored: &Path,
    old_path: &Path,
    new_path: &Path,
    renamed: bool,
    directory: bool,
) -> PathBuf {
    if !renamed {
        return stored.to_path_buf();
    }
    if crate::search::paths::same_path(stored, old_path) {
        return new_path.to_path_buf();
    }
    if directory {
        if let Ok(relative) = stored.strip_prefix(old_path) {
            return new_path.join(relative);
        }
    }
    stored.to_path_buf()
}

fn markdown_moves(
    old_path: &Path,
    new_path: &Path,
) -> Result<Vec<(PathBuf, PathBuf)>, FileCommandError> {
    let mut renames = Vec::new();
    for entry in WalkDir::new(old_path) {
        let entry = entry.map_err(|error| FileCommandError::Io {
            message: error.to_string(),
        })?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(old_path)
            .map_err(|error| FileCommandError::Io {
                message: error.to_string(),
            })?
            .to_path_buf();
        renames.push((entry.into_path(), new_path.join(relative)));
    }
    Ok(renames)
}

#[cfg(test)]
mod tests {
    use super::{apply_rename, hash_bytes, rollback};
    use crate::search::wiki::LinkRewrite;
    use std::fs;

    #[test]
    fn keeps_the_original_name_when_preflight_detects_a_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let old_path = directory.path().join("Old.md");
        let new_path = directory.path().join("New.md");
        let source_path = directory.path().join("Source.md");
        fs::write(&old_path, "target").unwrap();
        fs::write(&source_path, "current").unwrap();
        let rewrite = LinkRewrite {
            path: source_path,
            original: "stale".to_owned(),
            original_hash: hash_bytes(b"stale"),
            content: "next".to_owned(),
        };

        assert!(apply_rename(&old_path, &new_path, vec![rewrite]).is_err());
        assert!(old_path.is_file());
        assert!(!new_path.exists());
    }

    #[test]
    fn changes_the_letter_case_and_rewrites_the_links() {
        let directory = tempfile::tempdir().unwrap();
        let old_path = directory.path().join("note.md");
        let new_path = directory.path().join("Note.md");
        let source_path = directory.path().join("Source.md");
        fs::write(&old_path, "target").unwrap();
        fs::write(&source_path, "[[note]]").unwrap();
        let rewrite = LinkRewrite {
            path: source_path.clone(),
            original: "[[note]]".to_owned(),
            original_hash: hash_bytes(b"[[note]]"),
            content: "[[Note]]".to_owned(),
        };

        apply_rename(&old_path, &new_path, vec![rewrite]).unwrap();

        assert_eq!(fs::read_to_string(&source_path).unwrap(), "[[Note]]");
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "target");
        let names = fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.eq_ignore_ascii_case("note.md"))
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Note.md".to_owned()]);
    }

    #[test]
    fn renames_unicode_notes_and_preserves_crlf_embed_and_plugin_text() {
        let directory = tempfile::tempdir().unwrap();
        let old_path = directory.path().join("Каталог/旧.md");
        let new_path = directory.path().join("Проекты/Заметка.md");
        let source_path = directory.path().join("Источник.md");
        fs::create_dir_all(old_path.parent().unwrap()).unwrap();
        fs::create_dir_all(new_path.parent().unwrap()).unwrap();
        let original = "---\r\nplugin: !expr [[keep]]\r\n---\r\n![[Каталог/旧#Раздел]]\r\n```plugin\r\n![[Каталог/旧]]\r\n```\r\n";
        let updated = "---\r\nplugin: !expr [[keep]]\r\n---\r\n![[Проекты/Заметка#Раздел]]\r\n```plugin\r\n![[Каталог/旧]]\r\n```\r\n";
        fs::write(&old_path, "# note").unwrap();
        fs::write(&source_path, original).unwrap();
        let rewrite = LinkRewrite {
            path: source_path.clone(),
            original: original.to_owned(),
            original_hash: hash_bytes(original.as_bytes()),
            content: updated.to_owned(),
        };

        apply_rename(&old_path, &new_path, vec![rewrite]).unwrap();

        assert!(!old_path.exists());
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "# note");
        assert_eq!(fs::read_to_string(source_path).unwrap(), updated);
    }

    #[test]
    fn applies_one_batch_rewrite_to_external_and_moved_sources() {
        let directory = tempfile::tempdir().unwrap();
        let old_folder = directory.path().join("Project");
        let new_folder = directory.path().join("Archive");
        let note = old_folder.join("One.md");
        let moved_source = old_folder.join("Linker.md");
        let external_source = directory.path().join("Index.md");
        fs::create_dir_all(&old_folder).unwrap();
        fs::write(&note, "one").unwrap();
        fs::write(&moved_source, "[[Project/One]]").unwrap();
        fs::write(&external_source, "[[Project/One]]").unwrap();
        let rewrites = vec![
            LinkRewrite {
                path: moved_source.clone(),
                original: "[[Project/One]]".to_owned(),
                original_hash: hash_bytes(b"[[Project/One]]"),
                content: "[[Archive/One]]".to_owned(),
            },
            LinkRewrite {
                path: external_source.clone(),
                original: "[[Project/One]]".to_owned(),
                original_hash: hash_bytes(b"[[Project/One]]"),
                content: "[[Archive/One]]".to_owned(),
            },
        ];

        let renamed = apply_rename(&old_folder, &new_folder, rewrites).unwrap();

        assert!(!old_folder.exists());
        assert_eq!(
            fs::read_to_string(new_folder.join("Linker.md")).unwrap(),
            "[[Archive/One]]"
        );
        assert_eq!(
            fs::read_to_string(external_source).unwrap(),
            "[[Archive/One]]"
        );
        assert_eq!(
            renamed.result.updated_paths,
            vec![
                new_folder.join("Linker.md").to_string_lossy().into_owned(),
                directory
                    .path()
                    .join("Index.md")
                    .to_string_lossy()
                    .into_owned(),
            ]
        );
    }

    #[test]
    fn rolls_back_folder_and_written_sources_after_a_later_hash_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let old_folder = directory.path().join("Project");
        let new_folder = directory.path().join("Archive");
        let source = old_folder.join("Source.md");
        let original = "[[Project/One]]\n";
        let original_bytes = "[[Project/One]]\r\n";
        fs::create_dir_all(&old_folder).unwrap();
        fs::write(&source, original_bytes).unwrap();
        let rewrites = ["[[Archive/One]]\n", "[[Archive/Other]]\n"]
            .into_iter()
            .map(|content| LinkRewrite {
                path: source.clone(),
                original: original.to_owned(),
                original_hash: hash_bytes(original_bytes.as_bytes()),
                content: content.to_owned(),
            })
            .collect();

        assert!(apply_rename(&old_folder, &new_folder, rewrites).is_err());

        assert!(old_folder.is_dir());
        assert!(!new_folder.exists());
        assert_eq!(fs::read_to_string(source).unwrap(), original_bytes);
    }

    #[test]
    fn reports_rollback_write_failures() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("is-a-directory");
        fs::create_dir(&path).unwrap();
        let rewrite = LinkRewrite {
            path: path.clone(),
            original: "before".to_owned(),
            original_hash: hash_bytes(b"before"),
            content: "after".to_owned(),
        };

        let failures = rollback(&[(path, rewrite, hash_bytes(b"after"))]);

        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("is-a-directory"));
    }

    #[test]
    fn renames_binary_attachments_without_decoding_them_as_text() {
        let directory = tempfile::tempdir().unwrap();
        let old_path = directory.path().join("image.png");
        let new_path = directory.path().join("renamed.png");
        let bytes = [0, 159, 255, 0];
        fs::write(&old_path, bytes).unwrap();

        let renamed = apply_rename(&old_path, &new_path, Vec::new()).unwrap();

        assert_eq!(fs::read(&new_path).unwrap(), bytes);
        assert_eq!(renamed.result.content, "");
        assert_eq!(renamed.result.hash, hash_bytes(&bytes));
        assert_eq!(renamed.result.text_hash, "");
    }

    #[test]
    fn includes_attachments_in_a_folder_move_map() {
        let directory = tempfile::tempdir().unwrap();
        let old_folder = directory.path().join("Project");
        let new_folder = directory.path().join("Archive");
        fs::create_dir_all(&old_folder).unwrap();
        fs::write(old_folder.join("Note.md"), "note").unwrap();
        fs::write(old_folder.join("image.png"), [0, 1, 2]).unwrap();

        let moves = super::markdown_moves(&old_folder, &new_folder).unwrap();

        assert_eq!(moves.len(), 2);
        assert!(moves.contains(&(old_folder.join("image.png"), new_folder.join("image.png"))));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_directory_before_renaming_or_rewriting_its_target() {
        use crate::search::models::IndexRevision;
        use crate::search::SearchService;
        use std::os::unix::fs::symlink;
        use std::sync::Arc;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        let target = root.join("real");
        let alias = root.join("alias");
        let destination = root.join("renamed");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("Note.md"), "[[Note]]").unwrap();
        symlink(&target, &alias).unwrap();
        let service = SearchService::new(
            directory.path().join("indexes"),
            Arc::new(|_: Vec<std::path::PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        );
        service.prepare(&root.to_string_lossy()).unwrap();

        let result = super::rename_with_links(&service, &alias, &destination);

        assert!(result.is_err());
        assert!(alias.symlink_metadata().is_ok());
        assert!(!destination.exists());
        assert_eq!(
            fs::read_to_string(target.join("Note.md")).unwrap(),
            "[[Note]]"
        );
        let open = service.active.write().unwrap().take();
        if let Some(open) = open {
            open.stop();
        }
    }
}
