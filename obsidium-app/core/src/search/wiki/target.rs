use crate::search::paths::{relative_slash_path, strip_markdown_extension};
use std::io::Read;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

pub fn target_key(target: &str) -> (String, &'static str) {
    let clean = target.trim().replace('\\', "/");
    let clean = clean.split('#').next().unwrap_or_default();
    let clean = strip_markdown_extension(clean);
    (
        clean.to_lowercase().nfc().collect(),
        if clean.contains('/') { "path" } else { "name" },
    )
}

pub fn relative_key(root: &Path, path: &Path) -> String {
    strip_markdown_extension(&relative_slash_path(root, path))
        .to_lowercase()
        .nfc()
        .collect()
}

pub fn markdown_target_key(root: &Path, source: &Path, target: &str) -> Option<String> {
    let manual = docsify_root(root, source.strip_prefix(root).ok()?);
    markdown_target_key_with_manual(root, source, target, manual.as_deref())
}

pub fn markdown_target_key_with_manual(
    root: &Path,
    source: &Path,
    target: &str,
    manual: Option<&Path>,
) -> Option<String> {
    let resolved = markdown_target_path_with_manual(root, source, target, manual)?;
    if resolved
        .extension()
        .is_some_and(|ext| !ext.eq_ignore_ascii_case("md"))
    {
        return None;
    }
    Some(
        strip_markdown_extension(&relative_slash_path(root, &resolved))
            .to_lowercase()
            .nfc()
            .collect(),
    )
}

pub fn markdown_target_path(root: &Path, source: &Path, target: &str) -> Option<PathBuf> {
    let manual = docsify_root(root, source.strip_prefix(root).ok()?);
    markdown_target_path_with_manual(root, source, target, manual.as_deref())
}

pub fn markdown_target_path_with_manual(
    root: &Path,
    source: &Path,
    target: &str,
    manual: Option<&Path>,
) -> Option<PathBuf> {
    let clean = target.trim().replace('\\', "/");
    let end = clean.find(['#', '?']).unwrap_or(clean.len());
    let (path, _) = clean.split_at(end);
    if path.is_empty() || path.starts_with("//") || has_scheme(path) {
        return None;
    }
    let path = percent_decode_path(path)?.replace('\\', "/");
    if path.starts_with("//") || has_scheme(&path) {
        return None;
    }
    let root_relative = path.starts_with('/');
    let path = path.strip_prefix('/').unwrap_or(&path);
    let source = source.strip_prefix(root).ok()?;
    let manual_root = if root_relative { manual } else { None };
    let mut components = if let Some(manual_root) = manual_root {
        manual_root
            .components()
            .filter_map(|part| match part {
                std::path::Component::Normal(value) => Some(value.to_os_string()),
                _ => None,
            })
            .collect()
    } else if root_relative {
        Vec::new()
    } else {
        source
            .parent()?
            .components()
            .filter_map(|part| match part {
                std::path::Component::Normal(value) => Some(value.to_os_string()),
                _ => None,
            })
            .collect()
    };
    let minimum_depth = if manual_root.is_some() {
        components.len()
    } else {
        0
    };
    for component in Path::new(path).components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if components.len() <= minimum_depth {
                    return None;
                }
                components.pop()?;
            }
            std::path::Component::Normal(value) => components.push(value.to_os_string()),
            _ => return None,
        }
    }
    let mut resolved = root.join(components.iter().collect::<PathBuf>());
    if manual_root.is_some() && path.is_empty() {
        resolved.push("README.md");
    }
    Some(resolved)
}

pub fn docsify_root(root: &Path, source: &Path) -> Option<PathBuf> {
    for parent in source.parent()?.ancestors() {
        let index = root.join(parent).join("index.html");
        if is_docsify_marker(&index) {
            return Some(parent.to_path_buf());
        }
    }
    None
}

pub fn resolve_markdown_file(root: &Path, source: &Path, target: &str) -> Option<PathBuf> {
    let path = if target.starts_with('#') || target.starts_with('?') {
        source.to_path_buf()
    } else {
        markdown_target_path(root, source, target)?
    };
    let path = if path.is_dir() {
        path.join("README.md")
    } else if path.extension().is_none() {
        path.with_extension("md")
    } else {
        path
    };
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        return None;
    }
    let root = std::fs::canonicalize(root).ok()?;
    let path = std::fs::canonicalize(path).ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

pub fn is_docsify_marker(path: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.file_type().is_file() {
        return false;
    }
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut content = Vec::new();
    file.take(1024 * 1024).read_to_end(&mut content).is_ok()
        && content.windows(8).any(|window| window == b"$docsify")
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

fn percent_decode_path(path: &str) -> Option<String> {
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

pub fn title_key(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
        .nfc()
        .collect()
}

pub fn relative_target(root: &Path, path: &Path, path_style: bool) -> String {
    if !path_style {
        return path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
    }
    strip_markdown_extension(&relative_slash_path(root, path)).to_owned()
}

pub fn select_candidate(root: &Path, source: &Path, paths: &[String]) -> Option<PathBuf> {
    let borrowed = paths.iter().map(String::as_str).collect::<Vec<_>>();
    pick_candidate(root, source, &borrowed).map(PathBuf::from)
}

pub fn pick_candidate<'a>(root: &Path, source: &Path, paths: &[&'a str]) -> Option<&'a str> {
    let parent = source.parent();
    paths.iter().copied().min_by(|left, right| {
        candidate_rank(root, parent, left)
            .cmp(&candidate_rank(root, parent, right))
            .then_with(|| left.cmp(right))
    })
}

#[cfg(test)]
mod tests {
    use super::{markdown_target_key, resolve_markdown_file};
    use std::path::Path;

    #[test]
    fn unicode_keys_match_composed_and_decomposed_names() {
        let root = Path::new("/vault");
        let file = root.join("и\u{306}.md");
        assert_eq!(
            super::relative_key(root, &file),
            markdown_target_key(root, &root.join("source.md"), "%D0%B9.md").unwrap()
        );
        assert_eq!(super::title_key(&file), super::target_key("й").0);
    }

    #[test]
    fn resolves_only_existing_markdown_files_inside_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let manual = root.join("manual");
        std::fs::create_dir_all(&manual).unwrap();
        std::fs::write(manual.join("index.html"), "window.$docsify = {}").unwrap();
        std::fs::write(manual.join("README.md"), "# start").unwrap();
        std::fs::write(manual.join("Topic.md"), "# Topic").unwrap();
        let source = manual.join("source.md");
        std::fs::write(&source, "").unwrap();
        assert_eq!(
            resolve_markdown_file(root, &source, "/Topic?id=part"),
            Some(std::fs::canonicalize(manual.join("Topic.md")).unwrap())
        );
        assert_eq!(
            resolve_markdown_file(root, &source, "/?id=main"),
            Some(std::fs::canonicalize(manual.join("README.md")).unwrap())
        );
        assert_eq!(resolve_markdown_file(root, &source, "/missing"), None);
        assert_eq!(resolve_markdown_file(root, &source, "/../outside.md"), None);
        assert_eq!(
            resolve_markdown_file(root, &source, "https://example.com/x.md"),
            None
        );
        #[cfg(unix)]
        {
            let external = tempfile::tempdir().unwrap();
            std::fs::write(external.path().join("other.md"), "outside").unwrap();
            std::os::unix::fs::symlink(external.path().join("other.md"), manual.join("escape.md"))
                .unwrap();
            assert_eq!(resolve_markdown_file(root, &source, "/escape.md"), None);
        }
    }

    #[test]
    fn docsify_root_links_resolve_within_the_nearest_manual() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let manual = root.join("manual");
        let nested = manual.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(manual.join("index.html"), "window.$docsify = {}").unwrap();
        std::fs::write(nested.join("index.html"), "unrelated site").unwrap();
        let source = nested.join("source.md");
        assert_eq!(
            markdown_target_key(root, &source, "/guide/start?id=part"),
            Some("manual/guide/start".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "/?id=main"),
            Some("manual/readme".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "../guide/start#part"),
            Some("manual/guide/start".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "../../../outside.md"),
            None
        );
        assert_eq!(markdown_target_key(root, &source, "/../outside.md"), None);
        std::fs::write(nested.join("index.html"), "window.$docsify = {}").unwrap();
        assert_eq!(
            markdown_target_key(root, &source, "/guide/start#part"),
            Some("manual/nested/guide/start".to_owned())
        );
    }

    #[test]
    fn resolves_markdown_targets_from_source_and_stays_inside_vault() {
        let root = Path::new("/vault");
        let source = root.join("Folder/Source.md");

        assert_eq!(
            markdown_target_key(root, &source, "Target.md#section"),
            Some("folder/target".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "../Root.md?mode=preview"),
            Some("root".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "My%20Note.md"),
            Some("folder/my note".to_owned())
        );
        assert_eq!(
            markdown_target_key(root, &source, "/Root.md"),
            Some("root".to_owned())
        );
        assert_eq!(markdown_target_key(root, &source, "../../outside.md"), None);
        assert_eq!(
            markdown_target_key(root, &source, "https://example.com/a.md"),
            None
        );
        assert_eq!(markdown_target_key(root, &source, "image.png"), None);
    }
}

fn candidate_rank(root: &Path, parent: Option<&Path>, value: &str) -> (bool, usize) {
    let path = Path::new(value);
    (
        path.parent() != parent,
        path.strip_prefix(root).unwrap_or(path).components().count(),
    )
}
