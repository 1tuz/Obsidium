use crate::search::paths::{is_markdown, strip_root};
use super::attachments::MEDIA_EXTENSIONS;
use super::error::FileCommandError;
use super::models::{FileItem, FileItemType};
use std::fs;
use std::path::Path;

const DOCUMENT_EXTENSIONS: &[&str] = &["pdf", "epub", "mobi", "azw3", "fb2"];

fn is_attachment(extension: &str) -> bool {
    MEDIA_EXTENSIONS.contains(&extension) || DOCUMENT_EXTENSIONS.contains(&extension)
}

pub fn read_directory_impl(path: &Path) -> Result<Vec<FileItem>, FileCommandError> {
    let mut items = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if name.starts_with('.') || file_type.is_symlink() {
            continue;
        }

        let id = path.to_string_lossy().into_owned();
        if file_type.is_dir() {
            items.push(FileItem {
                id,
                name,
                item_type: FileItemType::Folder,
            });
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let Some(extension) = extension else {
            continue;
        };

        let is_markdown = extension == "md";
        if !is_markdown && !is_attachment(extension.as_str()) {
            continue;
        }

        let display_name = if is_markdown {
            path.file_stem()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or(name)
        } else {
            name
        };
        items.push(FileItem {
            id,
            name: display_name,
            item_type: FileItemType::File,
        });
    }

    items.sort_by_cached_key(|item| {
        (
            item.item_type == FileItemType::File,
            item.name.to_lowercase(),
        )
    });

    Ok(items)
}

pub fn list_vault_snippets_impl(workspace: &Path) -> Result<Vec<FileItem>, FileCommandError> {
    let root = fs::canonicalize(workspace)?;
    let folder = root.join(".obsidian").join("snippets");
    let folder = match fs::canonicalize(folder) {
        Ok(folder) if strip_root(&root, &folder).is_some() => folder,
        Ok(_) => return Ok(Vec::new()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut snippets = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_ok_and(|kind| kind.is_file())
            || !entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("css"))
        {
            continue;
        }
        let path = fs::canonicalize(entry.path())?;
        let Some(relative) = strip_root(&root, &path) else {
            continue;
        };
        snippets.push(FileItem {
            id: path.to_string_lossy().into_owned(),
            name: relative
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            item_type: FileItemType::File,
        });
    }
    snippets.sort_by_cached_key(|item| item.name.to_lowercase());
    Ok(snippets)
}

pub fn existing_files_impl(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|value| {
            let path = Path::new(value);
            path.is_file() && is_markdown(path)
        })
        .collect()
}
