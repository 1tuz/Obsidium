use crate::search::paths::{is_visible_entry, slash_path};
use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

pub const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEntry {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

pub fn list_images(workspace: &Path) -> Vec<ImageEntry> {
    let mut images: Vec<ImageEntry> = WalkDir::new(workspace)
        .into_iter()
        .filter_entry(is_visible_entry)
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_image(entry.path()))
        .filter_map(|entry| image_entry(&entry))
        .collect();

    images.sort_by(|left, right| {
        right
            .mtime
            .cmp(&left.mtime)
            .then_with(|| left.path.cmp(&right.path))
    });

    images
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
}

fn image_entry(entry: &DirEntry) -> Option<ImageEntry> {
    let metadata = entry.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(ImageEntry {
        path: slash_path(entry.path()),
        size: metadata.len(),
        mtime: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::{list_images, MAX_IMAGE_BYTES};
    use std::fs;
    use std::path::Path;

    fn relative_paths(root: &Path) -> Vec<String> {
        let mut found: Vec<String> = list_images(root)
            .into_iter()
            .map(|image| {
                Path::new(&image.path)
                    .strip_prefix(root)
                    .unwrap_or_else(|_| Path::new(&image.path))
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        found.sort();
        found
    }

    #[test]
    fn collects_every_supported_image_and_ignores_the_service_folder() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::create_dir_all(root.join("Files")).unwrap();
        fs::create_dir_all(root.join("Notes").join("deep")).unwrap();
        fs::create_dir_all(root.join(".obsidium").join("cache")).unwrap();
        fs::create_dir_all(root.join(".trash")).unwrap();

        fs::write(root.join("Files").join("photo.PNG"), b"png").unwrap();
        fs::write(root.join("Files").join("scan.jpeg"), b"jpeg").unwrap();
        fs::write(root.join("Notes").join("deep").join("anim.gif"), b"gif").unwrap();
        fs::write(root.join("Notes").join("art.webp"), b"webp").unwrap();
        fs::write(root.join("Notes").join("vector.svg"), b"svg").unwrap();
        fs::write(root.join("Note.md"), b"text").unwrap();
        fs::write(
            root.join(".obsidium").join("cache").join("thumb.png"),
            b"png",
        )
        .unwrap();
        fs::write(root.join(".obsidium").join("state.jpg"), b"jpg").unwrap();
        fs::write(root.join(".trash").join("deleted.png"), b"png").unwrap();
        fs::write(root.join(".hidden.png"), b"png").unwrap();
        fs::write(root.join("Notes").join("vector.svgz"), b"svgz").unwrap();

        assert_eq!(
            relative_paths(root),
            vec![
                "Files/photo.PNG".to_owned(),
                "Files/scan.jpeg".to_owned(),
                "Notes/art.webp".to_owned(),
                "Notes/deep/anim.gif".to_owned(),
                "Notes/vector.svg".to_owned(),
            ]
        );
    }

    #[test]
    fn reports_the_file_size_and_an_absolute_path() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::write(root.join("cover.jpg"), b"0123456789").unwrap();

        let images = list_images(root);
        let expected = root.join("cover.jpg");

        assert_eq!(images.len(), 1);
        assert_eq!(images[0].size, 10);
        assert!(images[0].mtime > 0);
        assert_eq!(Path::new(&images[0].path), expected.as_path());
    }

    #[test]
    fn skips_files_above_the_size_limit() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::write(root.join("small.png"), b"png").unwrap();
        let huge = fs::File::create(root.join("huge.png")).unwrap();
        huge.set_len(MAX_IMAGE_BYTES + 1).unwrap();

        assert_eq!(relative_paths(root), vec!["small.png".to_owned()]);
    }

    #[test]
    fn a_missing_workspace_lists_nothing() {
        let directory = tempfile::tempdir().unwrap();
        assert!(list_images(&directory.path().join("absent")).is_empty());
    }
}
