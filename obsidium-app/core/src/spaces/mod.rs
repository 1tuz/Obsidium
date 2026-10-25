#[cfg(test)]
mod tests;

pub use crate::settings::models::{Space, SpaceSettings, DEFAULT_SPACE_ID};

use crate::files::error::FileCommandError;
use crate::files::models::FileItemType;
use crate::files::workspace::read_directory_impl;
use crate::search::fields::head_fields;
use crate::search::paths::{is_markdown, slash_path, strip_root};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn save_space(settings: &mut SpaceSettings, space: Space) -> Result<Space, String> {
    let mut saved = Space {
        id: space.id.trim().to_owned(),
        name: space.name.trim().to_owned(),
        root: normalize_relative(&space.root)?,
        include_tags: normalize_tags(space.include_tags),
        exclude_folders: space
            .exclude_folders
            .iter()
            .map(|folder| normalize_relative(folder))
            .collect::<Result<Vec<_>, String>>()?,
    };

    if saved.name.is_empty() {
        return Err("название пространства не может быть пустым".to_owned());
    }

    if saved.id.is_empty() {
        saved.id = unique_id(settings, &slug(&saved.name));
    }

    match settings.spaces.iter().position(|item| item.id == saved.id) {
        Some(index) => settings.spaces[index] = saved.clone(),
        None => settings.spaces.push(saved.clone()),
    }

    Ok(saved)
}

pub fn delete_space(settings: &mut SpaceSettings, id: &str) -> Result<(), String> {
    let Some(index) = settings.spaces.iter().position(|space| space.id == id) else {
        return Err(format!("пространство не найдено: {id}"));
    };
    if settings.spaces.len() <= 1 {
        return Err("нельзя удалить последнее пространство".to_owned());
    }
    settings.spaces.remove(index);
    Ok(())
}

pub fn list_space_files(workspace: &Path, space: &Space) -> Result<Vec<String>, FileCommandError> {
    let root = if space.root.trim().is_empty() {
        workspace.to_path_buf()
    } else {
        workspace.join(space.root.trim())
    };
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let Some(relative_root) = strip_root(workspace, &root) else {
        return Ok(Vec::new());
    };

    let excluded = exclusion_keys(space);
    if is_excluded(&folder_key(relative_root), &excluded) {
        return Ok(Vec::new());
    }

    let tags = tag_keys(space);
    let mut files = Vec::new();
    collect_files(workspace, &root, &excluded, &mut files);
    files.retain(|file| tags.is_empty() || matches_tags(Path::new(file), &tags));
    files.sort();
    files.dedup();
    Ok(files)
}

fn collect_files(
    workspace: &Path,
    directory: &Path,
    excluded: &HashSet<String>,
    files: &mut Vec<String>,
) {
    let Ok(items) = read_directory_impl(directory) else {
        return;
    };
    for item in items {
        match item.item_type {
            FileItemType::Folder => {
                let path = PathBuf::from(&item.id);
                let Some(relative) = strip_root(workspace, &path) else {
                    continue;
                };
                if is_excluded(&folder_key(relative), excluded) {
                    continue;
                }
                collect_files(workspace, &path, excluded, files);
            }
            FileItemType::File => files.push(item.id),
        }
    }
}

fn folder_key(relative: &Path) -> String {
    slash_path(relative).to_lowercase()
}

fn exclusion_keys(space: &Space) -> HashSet<String> {
    space
        .exclude_folders
        .iter()
        .filter_map(|folder| normalize_relative(folder).ok())
        .filter(|folder| !folder.is_empty())
        .map(|folder| folder.to_lowercase())
        .collect()
}

fn is_excluded(folder: &str, excluded: &HashSet<String>) -> bool {
    excluded
        .iter()
        .any(|entry| folder == entry || folder.starts_with(&format!("{entry}/")))
}

fn tag_keys(space: &Space) -> HashSet<String> {
    normalize_tags(space.include_tags.clone())
        .into_iter()
        .map(|tag| tag.to_lowercase())
        .collect()
}

fn matches_tags(path: &Path, tags: &HashSet<String>) -> bool {
    if !is_markdown(path) {
        return false;
    }
    head_fields(path)
        .into_iter()
        .filter(|field| field.key.trim().eq_ignore_ascii_case("tags"))
        .flat_map(|field| {
            if field.items.is_empty() {
                field
                    .text
                    .split(|character: char| character == ',' || character.is_whitespace())
                    .map(|value| value.trim().to_owned())
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            } else {
                field
                    .items
                    .iter()
                    .map(|value| value.trim().to_owned())
                    .collect::<Vec<_>>()
            }
        })
        .map(|value| tag_name(&value).to_lowercase())
        .any(|tag| !tag.is_empty() && tags.contains(&tag))
}

fn tag_name(value: &str) -> &str {
    let trimmed = value.trim();
    let stripped = trimmed.strip_prefix('#').unwrap_or(trimmed);
    stripped.trim()
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag_name(&tag);
        if tag.is_empty() {
            continue;
        }
        if seen.insert(tag.to_lowercase()) {
            normalized.push(tag.to_owned());
        }
    }
    normalized
}

fn normalize_relative(value: &str) -> Result<String, String> {
    let replaced = value.replace('\\', "/");
    let trimmed = replaced.trim();
    if trimmed.starts_with('/') {
        return Err(format!("путь должен быть относительным: {value}"));
    }
    if trimmed.contains(':') {
        return Err(format!("путь не может содержать букву диска: {value}"));
    }

    let mut cleaned = trimmed;
    while let Some(rest) = cleaned.strip_prefix("./") {
        cleaned = rest;
    }

    let mut parts = Vec::new();
    for part in cleaned.trim_matches('/').split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(format!("путь не может содержать «..»: {value}"));
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

fn slug(name: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for character in name.to_lowercase().chars() {
        if character.is_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(character);
        } else if !slug.is_empty() {
            pending_dash = true;
        }
    }
    if slug.is_empty() {
        "space".to_owned()
    } else {
        slug
    }
}

fn unique_id(settings: &SpaceSettings, base: &str) -> String {
    if !settings.spaces.iter().any(|space| space.id == base) {
        return base.to_owned();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base}-{index}");
        if !settings.spaces.iter().any(|space| space.id == candidate) {
            return candidate;
        }
        index += 1;
    }
}
