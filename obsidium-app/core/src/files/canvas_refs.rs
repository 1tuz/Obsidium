use super::document::{hash_bytes, write_file_atomic_impl};
use super::error::FileCommandError;
use crate::search::paths::{same_path, slash_path};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub struct CanvasReference {
    pub board: PathBuf,
    pub original_hash: String,
    pub original: String,
    pub content: String,
}

pub fn rewrite_canvas_reference(
    content: &str,
    board: &Path,
    old_path: &Path,
    new_path: &Path,
) -> Option<CanvasReference> {
    let mut document: serde_json::Value = serde_json::from_str(content).ok()?;
    let directory = board.parent()?;
    let mut changed = false;
    if let Some(nodes) = document
        .get_mut("nodes")
        .and_then(serde_json::Value::as_array_mut)
    {
        for node in nodes.iter_mut() {
            let Some(fields) = node.as_object_mut() else {
                continue;
            };
            if fields.get("type").and_then(serde_json::Value::as_str) != Some("file") {
                continue;
            }
            let Some(value) = fields.get("file").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if let Some(next) = rewrite_path(value, directory, old_path, new_path) {
                fields.insert("file".into(), serde_json::Value::String(next));
                changed = true;
            }
        }
    }
    if !changed {
        return None;
    }
    Some(CanvasReference {
        board: board.to_path_buf(),
        original_hash: hash_bytes(content.as_bytes()),
        original: content.to_owned(),
        content: serde_json::to_string_pretty(&document).ok()?,
    })
}

fn rewrite_path(value: &str, directory: &Path, old_path: &Path, new_path: &Path) -> Option<String> {
    let resolved = normalize_path(&directory.join(Path::new(value)));
    if !same_path(&resolved, old_path) {
        return None;
    }
    Some(relative_path(directory, new_path))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn relative_path(root: &Path, path: &Path) -> String {
    let root = normalize_path(root);
    let path = normalize_path(path);
    let mut root_components = root.components().peekable();
    let mut path_components = path.components().peekable();
    while root_components.peek() == path_components.peek() && root_components.peek().is_some() {
        root_components.next();
        path_components.next();
    }
    let mut relative = PathBuf::new();
    for component in root_components {
        if !matches!(component, Component::Normal(_)) {
            return slash_path(&path);
        }
        relative.push("..");
    }
    for component in path_components {
        if !matches!(component, Component::Normal(_)) {
            return slash_path(&path);
        }
        relative.push(component.as_os_str());
    }
    slash_path(&relative)
}

pub fn write_canvas_reference(reference: &CanvasReference) -> Result<String, FileCommandError> {
    let written = write_file_atomic_impl(
        reference.board.as_path(),
        &reference.content,
        Some(&reference.original_hash),
    )?;
    Ok(written.hash)
}

#[cfg(test)]
mod tests {
    use super::{rewrite_canvas_reference, write_canvas_reference};
    use std::fs;
    use std::path::Path;

    fn board_with(value: &str) -> String {
        serde_json::json!({
            "nodes": [{
                "id": "n1",
                "type": "file",
                "x": 0,
                "y": 0,
                "width": 100,
                "height": 80,
                "file": value,
                "custom": { "keep": true }
            }],
            "edges": [],
            "obsidium": { "canvas": { "paperStyle": "sepia", "camera": { "x": 3.5, "y": -2, "zoom": 1.25 } } }
        })
        .to_string()
    }

    fn board_with_nodes(nodes: serde_json::Value) -> String {
        serde_json::json!({
            "nodes": nodes,
            "edges": [],
            "text": "../Notes/Plan.md"
        })
        .to_string()
    }

    #[test]
    fn never_rewrites_non_file_nodes_or_root_text() {
        let board = Path::new("/vault/Boards/Board.canvas");
        let content = board_with_nodes(serde_json::json!([
            {
                "id": "t1",
                "type": "text",
                "text": "../Notes/Plan.md",
                "file": "../Notes/Plan.md"
            },
            {
                "id": "l1",
                "type": "link",
                "url": "../Notes/Plan.md",
                "file": "../Notes/Plan.md"
            },
            {
                "id": "g1",
                "type": "group",
                "label": "../Notes/Plan.md",
                "file": "../Notes/Plan.md"
            }
        ]));
        assert!(rewrite_canvas_reference(
            &content,
            board,
            Path::new("/vault/Notes/Plan.md"),
            Path::new("/vault/Projects/Plan.md"),
        )
        .is_none());
    }

    #[test]
    fn ignores_references_outside_the_board_directory() {
        let board = Path::new("/vault/Boards/Board.canvas");
        let content = board_with_nodes(serde_json::json!([
            {
                "id": "n1",
                "type": "file",
                "file": "../../Elsewhere/Plan.md"
            },
            {
                "id": "n2",
                "type": "file",
                "file": "/Other/Plan.md"
            }
        ]));
        assert!(rewrite_canvas_reference(
            &content,
            board,
            Path::new("/vault/Notes/Plan.md"),
            Path::new("/vault/Projects/Plan.md"),
        )
        .is_none());
    }

    #[test]
    fn rewrites_file_nodes_and_keeps_unknown_fields() {
        let board = Path::new("/vault/Boards/Board.canvas");
        let content = board_with("../Notes/Plan.md");
        let reference = rewrite_canvas_reference(
            &content,
            board,
            Path::new("/vault/Notes/Plan.md"),
            Path::new("/vault/Projects/Plan.md"),
        )
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&reference.content).unwrap();
        assert_eq!(parsed["nodes"][0]["file"], "../Projects/Plan.md");
        assert_eq!(parsed["nodes"][0]["custom"]["keep"], true);
        assert_eq!(parsed["obsidium"]["canvas"]["paperStyle"], "sepia");
    }

    #[test]
    fn ignores_unrelated_targets_and_absolute_paths() {
        let board = Path::new("/vault/Boards/Board.canvas");
        let content = board_with("../Notes/Other.md");
        assert!(rewrite_canvas_reference(
            &content,
            board,
            Path::new("/vault/Notes/Plan.md"),
            Path::new("/vault/Projects/Plan.md"),
        )
        .is_none());
    }

    #[test]
    fn write_preflight_rejects_a_concurrently_edited_board() {
        let directory = tempfile::tempdir().unwrap();
        let board = directory.path().join("Board.canvas");
        let content = board_with("Plan.md");
        fs::write(&board, &content).unwrap();
        let reference = rewrite_canvas_reference(
            &content,
            &board,
            &directory.path().join("Plan.md"),
            &directory.path().join("Moved.md"),
        )
        .unwrap();
        fs::write(&board, "{\"nodes\":[]}").unwrap();
        assert!(write_canvas_reference(&reference).is_err());
        assert_eq!(fs::read_to_string(&board).unwrap(), "{\"nodes\":[]}");
    }
}
