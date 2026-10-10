use crate::search::paths::{relative_slash_path, strip_markdown_extension};
use std::path::{Path, PathBuf};

pub fn target_key(target: &str) -> (String, &'static str) {
    let clean = target.trim().replace('\\', "/");
    let clean = clean.split('#').next().unwrap_or_default();
    let clean = strip_markdown_extension(clean);
    (
        clean.to_lowercase(),
        if clean.contains('/') { "path" } else { "name" },
    )
}

pub fn relative_key(root: &Path, path: &Path) -> String {
    strip_markdown_extension(&relative_slash_path(root, path)).to_lowercase()
}

pub fn markdown_target_key(root: &Path, source: &Path, target: &str) -> Option<String> {
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
    let mut components = if root_relative {
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
    let resolved = components.iter().collect::<PathBuf>();
    if resolved
        .extension()
        .is_some_and(|ext| !ext.eq_ignore_ascii_case("md"))
    {
        return None;
    }
    Some(strip_markdown_extension(&relative_slash_path(root, &root.join(resolved))).to_lowercase())
}

fn has_scheme(path: &str) -> bool {
    path.find(':').is_some_and(|colon| {
        let mut scheme = path[..colon].chars();
        scheme.next().is_some_and(|value| value.is_ascii_alphabetic())
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
    use super::markdown_target_key;
    use std::path::Path;

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
        assert_eq!(markdown_target_key(root, &source, "/Root.md"), Some("root".to_owned()));
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
