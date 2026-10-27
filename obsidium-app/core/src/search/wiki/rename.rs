use super::super::error::SearchError;
use super::parser::{extract, extract_markdown};
use super::resolver::{select_candidates, LinkResolver};
use super::target::{relative_key, relative_target, select_candidate, target_key, title_key};
use crate::files::document::{hash_bytes, normalize_line_endings};
use crate::search::paths::same_path;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub struct LinkRewrite {
    pub path: PathBuf,
    pub original: String,
    pub original_hash: String,
    pub content: String,
}

pub fn plan_for_rename(
    connection: &Connection,
    root: &Path,
    old_path: &Path,
    new_path: &Path,
    sources: Vec<PathBuf>,
    fallback_candidates: Option<&[String]>,
) -> Result<Vec<LinkRewrite>, SearchError> {
    let rename = [(old_path.to_path_buf(), new_path.to_path_buf())];
    let fallback =
        fallback_candidates.map(|candidates| vec![(old_path.to_path_buf(), candidates.to_vec())]);
    plan_for_renames(connection, root, &rename, sources, fallback.as_deref())
}

pub fn plan_for_renames(
    connection: &Connection,
    root: &Path,
    renames: &[(PathBuf, PathBuf)],
    mut sources: Vec<PathBuf>,
    fallback_candidates: Option<&[(PathBuf, Vec<String>)]>,
) -> Result<Vec<LinkRewrite>, SearchError> {
    sources.sort();
    sources.dedup();
    let mut rewrites = Vec::new();
    let mut resolver = LinkResolver::new(connection)?;
    for stored_path in sources {
        let source_moved = renamed_path(&stored_path, renames).is_some();
        let new_source_path = renamed_path(&stored_path, renames).unwrap_or(&stored_path);
        let original = match fs::read_to_string(&stored_path) {
            Ok(original) => original,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let text = normalize_line_endings(original.clone());
        let mut changes = Vec::new();
        let mut links = extract(&text)
            .into_iter()
            .map(|link| (link, false))
            .collect::<Vec<_>>();
        links.extend(extract_markdown(&text).into_iter().map(|link| (link, true)));
        links.sort_by_key(|(link, _)| link.target_range.start);
        for (link, markdown) in links {
            if markdown {
                let Some(old_target) = markdown_target_path(root, &stored_path, &link.target)
                else {
                    continue;
                };
                let Some(new_target) = renamed_path(&old_target, renames)
                    .or_else(|| source_moved.then_some(old_target.as_path()))
                else {
                    continue;
                };
                let mut relative = encode_markdown_path(markdown_relative_target(
                    root,
                    new_source_path,
                    new_target,
                ));
                if link.target.to_lowercase().contains(".md")
                    && !relative.to_lowercase().ends_with(".md")
                {
                    relative.push_str(".md");
                }
                let suffix = link
                    .target
                    .find(['#', '?'])
                    .map_or("", |index| &link.target[index..]);
                let replacement = format!("{relative}{suffix}");
                if replacement != link.target {
                    changes.push((link.target_range, replacement));
                }
                continue;
            }
            for (old_path, new_path) in renames {
                let fallback = fallback_candidates.and_then(|candidates| {
                    candidates
                        .iter()
                        .find(|(path, _)| same_path(path, old_path))
                        .map(|(_, paths)| paths.as_slice())
                });
                let targets_old_path = targets_path(
                    &mut resolver,
                    root,
                    &stored_path,
                    &link.target,
                    old_path,
                    fallback,
                )?;
                if !targets_old_path {
                    continue;
                }
                let suffix = link
                    .target
                    .find(['#', '?'])
                    .map_or("", |index| &link.target[index..]);
                let path_style = link.target.replace('\\', "/").contains('/');
                let replacement = if path_style {
                    relative_target(root, new_path, true)
                } else {
                    let (key, _) = target_key(&link.target);
                    let candidates = match fallback {
                        Some(candidates) => candidates.to_vec(),
                        None => select_candidates(connection, &key)?,
                    };
                    let candidates = candidates
                        .iter()
                        .map(|candidate| {
                            renamed_path(Path::new(candidate), renames)
                                .map(|path| path.to_string_lossy().into_owned())
                                .unwrap_or_else(|| candidate.clone())
                        })
                        .collect::<Vec<_>>();
                    let path_style = select_candidate(root, new_source_path, &candidates)
                        .is_none_or(|path| !same_path(&path, new_path));
                    relative_target(root, new_path, path_style)
                };
                let replacement = format!("{replacement}{suffix}");
                if replacement != link.target {
                    changes.push((link.target_range, replacement));
                }
                break;
            }
        }
        if changes.is_empty() {
            continue;
        }
        let mut content = text;
        for (range, replacement) in changes.into_iter().rev() {
            content.replace_range(range, &replacement);
        }
        let original_hash = hash_bytes(original.as_bytes());
        let content = if original.contains("\r\n") {
            content.replace('\n', "\r\n")
        } else {
            content
        };
        rewrites.push(LinkRewrite {
            path: stored_path,
            original,
            original_hash,
            content,
        });
    }
    Ok(rewrites)
}

fn markdown_target_path(root: &Path, source: &Path, target: &str) -> Option<PathBuf> {
    let end = target.find(['#', '?']).unwrap_or(target.len());
    let path = decode_markdown_path(&target[..end])?.replace('\\', "/");
    if path.is_empty() || path.starts_with("//") || has_scheme(&path) {
        return None;
    }
    let root_relative = path.starts_with('/');
    let path = path.strip_prefix('/').unwrap_or(&path);
    let source_relative = source.strip_prefix(root).ok()?;
    let mut components = if root_relative {
        Vec::new()
    } else {
        source_relative
            .parent()?
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(value) => Some(value.to_os_string()),
                _ => None,
            })
            .collect()
    };
    for component in Path::new(path).components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                components.pop()?;
            }
            std::path::Component::Normal(value) => components.push(value.to_os_string()),
            _ => return None,
        }
    }
    let target = root.join(components.iter().collect::<PathBuf>());
    target.is_file().then_some(target)
}

fn decode_markdown_path(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'%' {
            let hex = std::str::from_utf8(bytes.get(cursor + 1..cursor + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            cursor += 3;
        } else {
            decoded.push(bytes[cursor]);
            cursor += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn has_scheme(path: &str) -> bool {
    path.find(':').is_some_and(|colon| {
        let mut scheme = path[..colon].chars();
        scheme
            .next()
            .is_some_and(|value| value.is_ascii_alphabetic())
            && scheme.all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '-' | '.'))
    })
}

fn renamed_path<'a>(path: &Path, renames: &'a [(PathBuf, PathBuf)]) -> Option<&'a Path> {
    renames
        .iter()
        .find(|(old_path, _)| same_path(path, old_path))
        .map(|(_, new_path)| new_path.as_path())
}

fn encode_markdown_path(path: String) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn markdown_relative_target(root: &Path, source: &Path, target: &Path) -> String {
    let Some(source_parent) = source
        .parent()
        .and_then(|path| path.strip_prefix(root).ok())
    else {
        return relative_target(root, target, true);
    };
    let Some(target_relative) = target.strip_prefix(root).ok() else {
        return relative_target(root, target, true);
    };
    let from = source_parent.components().collect::<Vec<_>>();
    let to = target_relative.components().collect::<Vec<_>>();
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts = vec!["..".to_owned(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|part| part.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

fn targets_path(
    resolver: &mut LinkResolver<'_>,
    root: &Path,
    source: &Path,
    target: &str,
    old_path: &Path,
    fallback_candidates: Option<&[String]>,
) -> Result<bool, SearchError> {
    let (key, kind) = target_key(target);
    if let Some(candidates) = fallback_candidates {
        return Ok(if kind == "path" {
            key == relative_key(root, old_path)
        } else {
            key == title_key(old_path)
                && select_candidate(root, source, candidates)
                    .is_some_and(|path| same_path(&path, old_path))
        });
    }
    if let Some(path) = resolver.resolve(root, source, target)? {
        return Ok(same_path(&path, old_path));
    }
    Ok(if kind == "path" {
        key == relative_key(root, old_path)
    } else {
        key == title_key(old_path)
    })
}

#[cfg(test)]
mod tests {
    use super::{plan_for_rename, plan_for_renames};
    use crate::search::wiki::{index_document, open_schema};
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn preserves_aliases_when_a_target_is_renamed() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = root.join("Old.md");
        let new_path = root.join("New.md");
        let source_path = root.join("Source.md");
        fs::write(&old_path, "target").unwrap();
        fs::write(&source_path, "[[Old]] and [[Old|visible]]").unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_path, "target").unwrap();
        index_document(
            &transaction,
            root,
            &source_path,
            "[[Old]] and [[Old|visible]]",
        )
        .unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_rename(
            &connection,
            root,
            &old_path,
            &new_path,
            vec![source_path],
            None,
        )
        .unwrap();

        assert_eq!(plan[0].content, "[[New]] and [[New|visible]]");
    }

    #[test]
    fn rewrites_links_in_a_crlf_note_and_keeps_the_hash_of_its_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = root.join("Old.md");
        let new_path = root.join("New.md");
        let source_path = root.join("Source.md");
        let raw = "# Title

see [[Old]]
";
        fs::write(&old_path, "target").unwrap();
        fs::write(&source_path, raw).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_path, "target").unwrap();
        index_document(
            &transaction,
            root,
            &source_path,
            "# Title

see [[Old]]
",
        )
        .unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_rename(
            &connection,
            root,
            &old_path,
            &new_path,
            vec![source_path],
            None,
        )
        .unwrap();

        assert_eq!(
            plan[0].content,
            "# Title

see [[New]]
"
        );
        assert_eq!(plan[0].original, raw);
        assert_eq!(
            plan[0].original_hash,
            blake3::hash(raw.as_bytes()).to_hex().to_string()
        );
    }

    #[test]
    fn renaming_unicode_targets_preserves_embed_fragments_relative_links_and_unknown_syntax() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = root.join("Каталог/旧.md");
        let new_path = root.join("Проекты/Заметка.md");
        let source_path = root.join("Заметки/Источник.md");
        let original = "---\ntitle: Source\nplugin: !expr [[keep-this]]\n---\n![[Каталог/旧#Раздел]]\n[[Каталог/旧|показать]]\n[относительная](../Каталог/旧.md#абзац)\n```plugin\n![[Каталог/旧]]\n```\n";
        fs::create_dir_all(old_path.parent().unwrap()).unwrap();
        fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        fs::write(&old_path, "# Раздел\nтекст").unwrap();
        fs::write(&source_path, original).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_path, "# Раздел\nтекст").unwrap();
        index_document(&transaction, root, &source_path, original).unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_rename(
            &connection,
            root,
            &old_path,
            &new_path,
            vec![source_path],
            None,
        )
        .unwrap();
        let expected = "---\ntitle: Source\nplugin: !expr [[keep-this]]\n---\n![[Проекты/Заметка#Раздел]]\n[[Проекты/Заметка|показать]]\n[относительная](../%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B0.md#абзац)\n```plugin\n![[Каталог/旧]]\n```\n";
        assert_eq!(plan[0].content, expected);
    }

    #[test]
    fn renaming_links_keeps_crlf_line_endings() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = root.join("旧.md");
        let new_path = root.join("Новый.md");
        let source_path = root.join("Источник.md");
        let original =
            "---\r\ntitle: Source\r\nunknown: [keep, exact]\r\n---\r\n![[旧#Раздел]]\r\n";
        fs::write(&old_path, "# Раздел\r\nТекст").unwrap();
        fs::write(&source_path, original).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_path, "# Раздел\nТекст").unwrap();
        index_document(
            &transaction,
            root,
            &source_path,
            "---\ntitle: Source\nunknown: [keep, exact]\n---\n![[旧#Раздел]]\n",
        )
        .unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_rename(
            &connection,
            root,
            &old_path,
            &new_path,
            vec![source_path],
            None,
        )
        .unwrap();
        let expected =
            "---\r\ntitle: Source\r\nunknown: [keep, exact]\r\n---\r\n![[Новый#Раздел]]\r\n";
        assert_eq!(plan[0].content, expected);
        assert!(plan[0].original.contains("\r\n"));
    }

    #[test]
    fn markdown_links_encode_spaces_and_unicode_in_renamed_paths() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = root.join("Old.md");
        let new_path = root.join("新 note.md");
        let source_path = root.join("Source.md");
        let original = "[note](Old.md)";
        fs::write(&old_path, "target").unwrap();
        fs::write(&source_path, original).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_path, "target").unwrap();
        index_document(&transaction, root, &source_path, original).unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_rename(
            &connection,
            root,
            &old_path,
            &new_path,
            vec![source_path],
            None,
        )
        .unwrap();

        assert_eq!(plan[0].content, "[note](%E6%96%B0%20note.md)");
    }

    #[test]
    fn plans_folder_moves_as_one_rewrite_per_source_and_rebases_moved_sources() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_folder = root.join("Project");
        let new_folder = root.join("Archive");
        let one = old_folder.join("One.md");
        let two = old_folder.join("Two.md");
        let moved_source = old_folder.join("Linker.md");
        let external_source = root.join("Index.md");
        let moved_one = new_folder.join("One.md");
        let moved_two = new_folder.join("Two.md");
        fs::create_dir_all(&old_folder).unwrap();
        fs::write(&one, "one").unwrap();
        fs::write(&two, "two").unwrap();
        fs::write(&moved_source, "[[Project/One]] and [two](Two.md)").unwrap();
        fs::write(
            &external_source,
            "[[Project/One]] and [two](Project/Two.md)",
        )
        .unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &one, "one").unwrap();
        index_document(&transaction, root, &two, "two").unwrap();
        index_document(
            &transaction,
            root,
            &moved_source,
            "[[Project/One]] and [two](Two.md)",
        )
        .unwrap();
        index_document(
            &transaction,
            root,
            &external_source,
            "[[Project/One]] and [two](Project/Two.md)",
        )
        .unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_renames(
            &connection,
            root,
            &[
                (one, moved_one),
                (two, moved_two),
                (moved_source.clone(), new_folder.join("Linker.md")),
            ],
            vec![
                moved_source.clone(),
                external_source.clone(),
                moved_source.clone(),
            ],
            None,
        )
        .unwrap();

        assert_eq!(plan.len(), 2);
        assert_eq!(
            plan.iter()
                .map(|rewrite| rewrite.path.as_path())
                .collect::<Vec<_>>(),
            [external_source.as_path(), moved_source.as_path()]
        );
        assert_eq!(plan[0].content, "[[Archive/One]] and [two](Archive/Two.md)");
        assert_eq!(plan[1].content, "[[Archive/One]] and [two](Two.md)");
    }

    #[test]
    fn qualifies_a_bare_link_when_a_folder_move_changes_its_resolved_target() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_target = root.join("A/Twin.md");
        let moved_target = root.join("Z/Twin.md");
        let other_target = root.join("B/Twin.md");
        let source = root.join("Index.md");
        fs::create_dir_all(old_target.parent().unwrap()).unwrap();
        fs::create_dir_all(other_target.parent().unwrap()).unwrap();
        fs::write(&old_target, "moved").unwrap();
        fs::write(&other_target, "other").unwrap();
        fs::write(&source, "[[Twin]]").unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_target, "moved").unwrap();
        index_document(&transaction, root, &other_target, "other").unwrap();
        index_document(&transaction, root, &source, "[[Twin]]").unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_renames(
            &connection,
            root,
            &[(old_target, moved_target)],
            vec![source],
            None,
        )
        .unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].content, "[[Z/Twin]]");
    }

    #[test]
    fn keeps_a_bare_link_when_the_moved_target_remains_the_winner() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_target = root.join("B/Twin.md");
        let moved_target = root.join("A/Twin.md");
        let other_target = root.join("C/Twin.md");
        let source = root.join("Index.md");
        fs::create_dir_all(old_target.parent().unwrap()).unwrap();
        fs::create_dir_all(other_target.parent().unwrap()).unwrap();
        fs::write(&old_target, "moved").unwrap();
        fs::write(&other_target, "other").unwrap();
        fs::write(&source, "[[Twin]]").unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(&transaction, root, &old_target, "moved").unwrap();
        index_document(&transaction, root, &other_target, "other").unwrap();
        index_document(&transaction, root, &source, "[[Twin]]").unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_renames(
            &connection,
            root,
            &[(old_target, moved_target)],
            vec![source],
            None,
        )
        .unwrap();

        assert!(plan.is_empty());
    }

    #[test]
    fn rebases_relative_markdown_links_to_targets_that_stay_in_place() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_folder = root.join("A/Folder");
        let new_folder = root.join("B/Folder");
        let source = old_folder.join("Source.md");
        let shared = root.join("A/Shared Note.md");
        fs::create_dir_all(&old_folder).unwrap();
        fs::create_dir_all(new_folder.parent().unwrap()).unwrap();
        fs::write(&source, "[shared](../Shared%20Note.md#part?mode=raw)").unwrap();
        fs::write(&shared, "shared").unwrap();

        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        index_document(
            &transaction,
            root,
            &source,
            "[shared](../Shared%20Note.md#part?mode=raw)",
        )
        .unwrap();
        index_document(&transaction, root, &shared, "shared").unwrap();
        transaction.commit().unwrap();

        let plan = plan_for_renames(
            &connection,
            root,
            &[(source.clone(), new_folder.join("Source.md"))],
            vec![source],
            None,
        )
        .unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(
            plan[0].content,
            "[shared](../../A/Shared%20Note.md#part?mode=raw)"
        );
    }

    #[test]
    fn rewrites_external_markdown_links_to_moved_attachments_and_keeps_suffixes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_folder = root.join("Project");
        let new_folder = root.join("Archive");
        let source = old_folder.join("Note.md");
        let attachment = old_folder.join("image.png");
        let external = root.join("Index.md");
        fs::create_dir_all(&old_folder).unwrap();
        fs::write(&source, "![image](image.png)").unwrap();
        fs::write(&attachment, [0, 1, 2]).unwrap();
        fs::write(&external, "[image](Project/image.png?download=1#preview)").unwrap();

        let connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let plan = plan_for_renames(
            &connection,
            root,
            &[
                (source.clone(), new_folder.join("Note.md")),
                (attachment.clone(), new_folder.join("image.png")),
            ],
            vec![source, external.clone()],
            None,
        )
        .unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].path, external);
        assert_eq!(
            plan[0].content,
            "[image](Archive/image.png?download=1#preview)"
        );
    }
}
