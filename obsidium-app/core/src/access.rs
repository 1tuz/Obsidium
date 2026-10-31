use crate::files::error::FileCommandError;
use crate::search::paths::{canonicalize_with_missing_tail, same_path, strip_root};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;

#[derive(Default)]
pub struct PathGrants {
    roots: RwLock<HashSet<PathBuf>>,
    files: RwLock<HashSet<PathBuf>>,
}

impl PathGrants {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn grant_root(&self, root: &Path) -> bool {
        let Ok(canonical) = fs::canonicalize(root) else {
            return false;
        };
        if !canonical.is_dir() {
            return false;
        }
        let mut roots = self.roots.write().expect("granted path roots");
        let mut files = self.files.write().expect("granted path files");
        files.retain(|file| strip_root(&canonical, file).is_none());
        roots.insert(canonical)
    }

    pub fn grant_roots(&self, roots: impl IntoIterator<Item = PathBuf>) {
        for root in roots {
            self.grant_root(&root);
        }
    }

    pub fn grant_file(&self, path: &str) -> Result<PathBuf, FileCommandError> {
        let resolved = resolve(path)?;
        let roots = self.roots.read().expect("granted path roots");
        if !roots
            .iter()
            .any(|root| strip_root(root, &resolved).is_some())
        {
            self.files
                .write()
                .expect("granted path files")
                .insert(resolved.clone());
        }
        Ok(resolved)
    }

    pub fn revoke_root(&self, root: &Path) {
        let canonical = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let mut roots = self.roots.write().expect("granted path roots");
        let mut files = self.files.write().expect("granted path files");
        roots.retain(|granted| !same_path(granted, &canonical));
        files.retain(|file| strip_root(&canonical, file).is_none());
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.roots
            .read()
            .expect("granted path roots")
            .iter()
            .cloned()
            .collect()
    }

    pub fn check(&self, input: &str) -> Result<PathBuf, FileCommandError> {
        let resolved = resolve(input)?;
        if self.is_within_root(&resolved) || {
            let mut files = self.files.write().expect("granted path files");
            let granted = files.iter().any(|file| same_path(file, &resolved));
            if granted {
                files.retain(|file| !same_path(file, &resolved));
            }
            granted
        } {
            Ok(resolved)
        } else {
            Err(outside(input))
        }
    }

    pub fn check_root(&self, input: &str) -> Result<PathBuf, FileCommandError> {
        let resolved = resolve(input)?;
        if self.is_root(&resolved) {
            Ok(resolved)
        } else {
            Err(outside(input))
        }
    }

    fn is_root(&self, path: &Path) -> bool {
        self.roots
            .read()
            .expect("granted path roots")
            .iter()
            .any(|root| same_path(root, path))
    }

    fn is_within_root(&self, path: &Path) -> bool {
        self.roots
            .read()
            .expect("granted path roots")
            .iter()
            .any(|root| strip_root(root, path).is_some())
    }
}

fn outside(path: &str) -> FileCommandError {
    FileCommandError::OutsideWorkspace {
        path: path.to_owned(),
    }
}

fn is_absolute(input: &str) -> bool {
    let bytes = input.as_bytes();
    Path::new(input).is_absolute()
        || (bytes.get(1) == Some(&b':') && bytes.first().is_some_and(u8::is_ascii_alphabetic))
        || input.starts_with(r"\\")
}

fn resolve(input: &str) -> Result<PathBuf, FileCommandError> {
    if input.is_empty() || !is_absolute(input) {
        return Err(outside(input));
    }
    let candidate = Path::new(input);
    if candidate
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err(outside(input));
    }
    canonicalize_with_missing_tail(candidate).map_err(|_| outside(input))
}

#[cfg(test)]
mod tests {
    use super::PathGrants;
    use crate::files::error::FileCommandError;
    use std::fs;
    use std::path::Path;

    fn scratch(name: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("obsidium-grants-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        fs::canonicalize(path).unwrap()
    }

    fn grants(root: &Path) -> PathGrants {
        let grants = PathGrants::new();
        assert!(grants.grant_root(root));
        grants
    }

    #[test]
    fn allows_paths_inside_a_granted_root() {
        let root = scratch("inside");
        let note = root.join("Notes").join("a.md");
        fs::create_dir_all(note.parent().unwrap()).unwrap();
        fs::write(&note, "text").unwrap();
        let grants = grants(&root);

        assert_eq!(grants.check(&note.to_string_lossy()).unwrap(), note);
        assert_eq!(grants.check(&root.to_string_lossy()).unwrap(), root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_root_must_match_a_registered_root() {
        let root = scratch("root-only");
        let nested = root.join("Nested");
        fs::create_dir(&nested).unwrap();
        let grants = grants(&root);

        assert!(grants.check_root(&root.to_string_lossy()).is_ok());
        assert!(grants.check_root(&nested.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_directories_can_be_granted_as_roots() {
        let root = scratch("file-root");
        let file = root.join("workspace.md");
        fs::write(&file, "text").unwrap();
        let grants = PathGrants::new();

        assert!(!grants.grant_root(&file));
        assert!(grants.check_root(&file.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_whitespace_in_path_names() {
        let root = scratch("path-whitespace");
        let plain = root.join("note.md");
        let spaced = root.join("note.md ");
        fs::write(&plain, "plain").unwrap();
        fs::write(&spaced, "spaced").unwrap();
        let grants = grants(&root);

        assert_eq!(grants.check(&spaced.to_string_lossy()).unwrap(), spaced);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_granted_roots() {
        let root = scratch("outside-root");
        let other = scratch("outside-other");
        let secret = other.join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        let grants = grants(&root);

        assert!(matches!(
            grants.check(&secret.to_string_lossy()),
            Err(FileCommandError::OutsideWorkspace { .. })
        ));
        assert!(grants.check_root(&other.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn rejects_parent_components() {
        let root = scratch("parent-candidate");
        let grants = grants(&root);
        let escape = format!("{}/../other/a.md", root.to_string_lossy());

        assert!(grants.check(&escape).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_escaping_the_root() {
        let root = scratch("symlink-root");
        let outside = scratch("symlink-outside");
        let secret = outside.join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let grants = grants(&root);

        assert!(grants
            .check(&link.join("secret.txt").to_string_lossy())
            .is_err());
        assert!(grants.check(&link.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn allows_targets_that_do_not_exist_yet() {
        let root = scratch("new-file");
        let created = root.join("Files").join("new.png");
        fs::create_dir_all(created.parent().unwrap()).unwrap();
        let grants = grants(&root);

        assert_eq!(grants.check(&created.to_string_lossy()).unwrap(), created);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn single_file_grant_covers_the_file_but_not_its_siblings() {
        let root = scratch("single-file");
        let picked = root.join("picked.png");
        let sibling = root.join("sibling.png");
        fs::write(&picked, "picked").unwrap();
        fs::write(&sibling, "sibling").unwrap();
        let grants = PathGrants::new();

        assert!(grants.check(&picked.to_string_lossy()).is_err());
        assert_eq!(
            grants.grant_file(&picked.to_string_lossy()).unwrap(),
            picked
        );
        assert!(grants.check(&picked.to_string_lossy()).is_ok());
        assert!(grants.check(&picked.to_string_lossy()).is_err());
        assert!(grants.check(&sibling.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_picked_file_inside_a_forgotten_root_keeps_no_separate_grant() {
        let root = scratch("picked-inside-root");
        let picked = root.join("picked.png");
        fs::write(&picked, "picked").unwrap();
        let grants = PathGrants::new();
        assert!(grants.grant_root(&root));

        grants.grant_file(&picked.to_string_lossy()).unwrap();
        grants.revoke_root(&root);

        assert!(grants.check(&picked.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adding_a_root_absorbs_an_existing_exact_file_grant() {
        let root = scratch("file-grant-root");
        let picked = root.join("picked.png");
        fs::write(&picked, "picked").unwrap();
        let grants = PathGrants::new();

        grants.grant_file(&picked.to_string_lossy()).unwrap();
        assert!(grants.grant_root(&root));
        grants.revoke_root(&root);

        assert!(grants.check(&picked.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn forgotten_root_stops_allowing_its_paths() {
        let root = scratch("forgotten");
        let note = root.join("a.md");
        fs::write(&note, "text").unwrap();
        let grants = grants(&root);

        assert!(grants.check(&note.to_string_lossy()).is_ok());
        grants.revoke_root(&root);

        assert!(grants.check(&note.to_string_lossy()).is_err());
        assert!(grants.roots().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn forgetting_a_missing_root_does_not_grant_a_recreated_path() {
        let root = scratch("forgotten-missing");
        let grants = grants(&root);
        fs::remove_dir_all(&root).unwrap();

        grants.revoke_root(&root);
        fs::create_dir_all(&root).unwrap();
        let note = root.join("a.md");
        fs::write(&note, "text").unwrap();

        assert!(grants.check(&note.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
