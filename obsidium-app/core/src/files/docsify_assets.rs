use crate::search::wiki::target::docsify_root;
use std::path::{Component, Path, PathBuf};

pub fn resolve_docsify_asset(root: &Path, source: &Path, target: &str) -> Option<PathBuf> {
    let relative_source = source.strip_prefix(root).ok()?;
    let manual = docsify_root(root, relative_source)?;
    let config = std::fs::read_to_string(root.join(manual).join("index.html")).ok()?;
    if !config
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .contains("relativePath:true")
    {
        return None;
    }
    let raw = target.split(['?', '#']).next()?.strip_prefix("/assets/")?;
    let decoded = decode_path(raw)?;
    let relative = Path::new(&decoded);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let source = source.canonicalize().ok()?;
    if !source.starts_with(&root) {
        return None;
    }
    let assets = source.parent()?.join("assets").canonicalize().ok()?;
    let path = assets.join(relative).canonicalize().ok()?;
    (assets.starts_with(&root) && path.starts_with(&assets) && path.is_file()).then_some(path)
}

fn decode_path(value: &str) -> Option<String> {
    let mut decoded = Vec::new();
    let mut input = value.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = (input.next()? as char).to_digit(16)?;
            let low = (input.next()? as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::resolve_docsify_asset;
    use std::fs;

    #[test]
    fn resolves_assets_next_to_note_and_rejects_escape() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let manual = root.join("manual");
        let note_dir = manual.join("chapter");
        fs::create_dir_all(note_dir.join("assets")).unwrap();
        fs::write(
            manual.join("index.html"),
            "window.$docsify = { relativePath: true }",
        )
        .unwrap();
        let source = note_dir.join("note.md");
        fs::write(&source, "").unwrap();
        let image = note_dir.join("assets/image name.png");
        fs::write(&image, "image").unwrap();
        assert_eq!(
            resolve_docsify_asset(root, &source, "/assets/image%20name.png"),
            Some(fs::canonicalize(image).unwrap())
        );
        assert_eq!(
            resolve_docsify_asset(root, &source, "/assets/%2e%2e/%2e%2e/secret"),
            None
        );
        assert_eq!(
            resolve_docsify_asset(root, &source, "https://example.com/assets/image.png"),
            None
        );
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            fs::write(outside.path().join("secret.png"), "secret").unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("secret.png"),
                note_dir.join("assets/link.png"),
            )
            .unwrap();
            assert_eq!(
                resolve_docsify_asset(root, &source, "/assets/link.png"),
                None
            );
        }
        fs::write(
            manual.join("index.html"),
            "window.$docsify = { relativePath: false }",
        )
        .unwrap();
        assert_eq!(
            resolve_docsify_asset(root, &source, "/assets/image%20name.png"),
            None
        );
    }
}
