use super::super::error::SearchError;
use super::parser::{extract, extract_markdown};
use super::resolver::LinkResolver;
use super::target::{
    markdown_target_key, relative_key, relative_target, select_candidate, target_key, title_key,
};
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
    let mut rewrites = Vec::new();
    let mut resolver = LinkResolver::new(connection)?;
    for stored_path in sources {
        let source_path = if same_path(&stored_path, old_path) {
            new_path
        } else {
            &stored_path
        };
        let Ok(original) = fs::read_to_string(source_path) else {
            continue;
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
            let targets_old_path = if markdown {
                markdown_target_key(root, source_path, &link.target)
                    .is_some_and(|key| key == relative_key(root, old_path))
            } else {
                targets_path(
                    &mut resolver,
                    root,
                    &stored_path,
                    &link.target,
                    old_path,
                    fallback_candidates,
                )?
            };
            if targets_old_path {
                let suffix = link
                    .target
                    .find(['#', '?'])
                    .map_or("", |index| &link.target[index..]);
                let replacement = if markdown {
                    let mut relative = markdown_relative_target(root, source_path, new_path);
                    if link.target.to_lowercase().contains(".md")
                        && !relative.to_lowercase().ends_with(".md")
                    {
                        relative.push_str(".md");
                    }
                    relative
                } else {
                    let path_style = link.target.replace('\\', "/").contains('/');
                    relative_target(root, new_path, path_style)
                };
                changes.push((link.target_range, format!("{replacement}{suffix}")));
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
    use super::plan_for_rename;
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
        let expected = "---\ntitle: Source\nplugin: !expr [[keep-this]]\n---\n![[Проекты/Заметка#Раздел]]\n[[Проекты/Заметка|показать]]\n[относительная](../Проекты/Заметка.md#абзац)\n```plugin\n![[Каталог/旧]]\n```\n";
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
}
