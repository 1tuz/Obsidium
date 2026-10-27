use crate::app_core::Core;
use crate::search::paths::{markdown_files, relative_slash_path, strip_root};
use std::path::{Component, Path, PathBuf};

const SIMILAR_LIMIT: usize = 5;

#[derive(Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub visible: bool,
}

impl Vault {
    pub fn active(core: &Core) -> Result<Self, String> {
        core.search
            .active_root()
            .map(|root| Self {
                root,
                visible: true,
            })
            .ok_or_else(|| "База знаний не открыта — выберите её в приложении".to_owned())
    }

    pub fn note(&self, core: &Core, input: &str) -> Result<PathBuf, String> {
        let direct = self.note_path(input)?;
        if direct.is_file() {
            return Ok(direct);
        }
        let workspace = self.root.to_string_lossy();
        let indexed = core
            .search
            .paths_by_title(&workspace, input)
            .ok()
            .flatten()
            .filter(|paths| !paths.is_empty());
        let mut matches = match indexed {
            Some(paths) => paths,
            None => self.find_by_title(input),
        };
        match matches.len() {
            0 => Err(self.not_found(input)),
            1 => Ok(matches.remove(0)),
            _ => Err(self.ambiguous(&matches)),
        }
    }

    fn ambiguous(&self, matches: &[PathBuf]) -> String {
        format!(
            "Несколько заметок с таким названием, укажите путь: {}",
            matches
                .iter()
                .map(|path| self.relative(path))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    fn not_found(&self, input: &str) -> String {
        let similar = self.similar_titles(input);
        if similar.is_empty() {
            return format!("Заметка не найдена: {input}");
        }
        format!(
            "Заметка не найдена: {input}. Похожие: {}",
            similar.join(", ")
        )
    }

    fn similar_titles(&self, input: &str) -> Vec<String> {
        let name = Path::new(input.trim())
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let words = name
            .split(|symbol: char| !symbol.is_alphanumeric())
            .filter(|word| word.chars().count() >= 3)
            .collect::<Vec<_>>();
        if words.is_empty() {
            return Vec::new();
        }
        let mut scored = self
            .markdown_files()
            .filter_map(|path| {
                let title = Self::title(&path).to_lowercase();
                let score = words.iter().filter(|word| title.contains(*word)).count();
                (score > 0).then(|| (score, self.relative(&path)))
            })
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
        scored
            .into_iter()
            .take(SIMILAR_LIMIT)
            .map(|(_, path)| path)
            .collect()
    }

    pub fn note_path(&self, input: &str) -> Result<PathBuf, String> {
        let path = self.any_path(input)?;
        Ok(match path.extension() {
            Some(extension) if extension.eq_ignore_ascii_case("md") => path,
            _ => {
                let mut value = path.into_os_string();
                value.push(".md");
                PathBuf::from(value)
            }
        })
    }

    pub fn folder(&self, input: &str) -> Result<PathBuf, String> {
        if input.trim().is_empty() {
            return Ok(self.root.clone());
        }
        self.any_path(input)
    }

    pub fn relative(&self, path: &Path) -> String {
        relative_slash_path(&self.root, path)
    }

    pub fn title(path: &Path) -> String {
        path.file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    pub fn markdown_files(&self) -> impl Iterator<Item = PathBuf> + '_ {
        markdown_files(&self.root)
    }

    fn any_path(&self, input: &str) -> Result<PathBuf, String> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err("Пустой путь".to_owned());
        }
        let bytes = trimmed.as_bytes();
        let windows_drive_path =
            bytes.get(1) == Some(&b':') && bytes.first().is_some_and(u8::is_ascii_alphabetic);
        if Path::new(trimmed).is_absolute() || windows_drive_path || trimmed.starts_with(r"\\") {
            let mut candidate = PathBuf::from(trimmed);
            if candidate
                .components()
                .any(|component| component == Component::ParentDir)
            {
                return Err(format!("Путь должен быть внутри базы знаний: {input}"));
            }
            let mut suffix = Vec::new();
            loop {
                match std::fs::canonicalize(&candidate) {
                    Ok(canonical) => {
                        let mut resolved =
                            self.ensure_inside(crate::search::paths::canonical_path(&canonical))?;
                        for component in suffix.iter().rev() {
                            resolved.push(component);
                        }
                        return Ok(resolved);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        match std::fs::symlink_metadata(&candidate) {
                            Err(metadata_error)
                                if metadata_error.kind() == std::io::ErrorKind::NotFound => {}
                            _ => {
                                return Err(format!(
                                    "Не удалось проверить путь: {}",
                                    candidate.to_string_lossy()
                                ));
                            }
                        }
                        let Some(name) = candidate.file_name() else {
                            return Err(format!(
                                "Не удалось проверить путь: {}",
                                candidate.to_string_lossy()
                            ));
                        };
                        suffix.push(name.to_os_string());
                        if !candidate.pop() {
                            return Err(format!(
                                "Не удалось проверить путь: {}",
                                candidate.to_string_lossy()
                            ));
                        }
                    }
                    Err(_) => {
                        return Err(format!(
                            "Не удалось проверить путь: {}",
                            candidate.to_string_lossy()
                        ));
                    }
                }
            }
        }
        let mut components = Vec::new();
        let normalized = trimmed.replace('\\', "/");
        for component in Path::new(&normalized).components() {
            match component {
                Component::Normal(value) => components.push(value),
                Component::CurDir => {}
                _ => return Err(format!("Путь должен быть внутри базы знаний: {input}")),
            }
        }
        if components.is_empty() {
            return Err("Пустой путь".to_owned());
        }
        let mut path = self.root.clone();
        for (index, component) in components.iter().enumerate() {
            let candidate = path.join(component);
            match std::fs::canonicalize(&candidate) {
                Ok(canonical) => path = self.ensure_inside(canonical)?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    match std::fs::symlink_metadata(&candidate) {
                        Err(metadata_error)
                            if metadata_error.kind() == std::io::ErrorKind::NotFound => {}
                        _ => {
                            return Err(format!(
                                "Не удалось проверить путь: {}",
                                candidate.to_string_lossy()
                            ));
                        }
                    }
                    path.extend(components[index..].iter());
                    break;
                }
                Err(_) => {
                    return Err(format!(
                        "Не удалось проверить путь: {}",
                        candidate.to_string_lossy()
                    ));
                }
            }
        }
        Ok(path)
    }

    fn ensure_inside(&self, path: PathBuf) -> Result<PathBuf, String> {
        if strip_root(&self.root, &path).is_some() {
            Ok(path)
        } else {
            Err(format!("Путь вне базы знаний: {}", path.to_string_lossy()))
        }
    }

    fn find_by_title(&self, title: &str) -> Vec<PathBuf> {
        let needle = title.trim().trim_end_matches(".md").to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        self.markdown_files()
            .filter(|path| Self::title(path).to_lowercase() == needle)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Vault;
    use crate::app_core::{Core, EventSink};
    use std::fs;
    use std::sync::Arc;

    fn vault() -> (tempfile::TempDir, Arc<Core>, Vault) {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        fs::create_dir_all(&data).unwrap();
        let root = crate::search::paths::canonical_path(directory.path());
        fs::create_dir_all(root.join("Проекты")).unwrap();
        fs::write(root.join("Проекты/Obsidium.md"), "заметка").unwrap();
        fs::write(root.join("Идея.md"), "другая").unwrap();
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let core = Core::open(&data, events);
        (
            directory,
            core,
            Vault {
                root,
                visible: true,
            },
        )
    }

    #[test]
    fn resolves_relative_path_with_and_without_extension() {
        let (_guard, core, vault) = vault();
        assert_eq!(
            vault.relative(&vault.note(&core, "Проекты/Obsidium.md").unwrap()),
            "Проекты/Obsidium.md"
        );
        assert_eq!(
            vault.relative(&vault.note(&core, "Проекты\\Obsidium").unwrap()),
            "Проекты/Obsidium.md"
        );
    }

    #[test]
    fn resolves_note_by_title() {
        let (_guard, core, vault) = vault();
        assert_eq!(
            vault.relative(&vault.note(&core, "obsidium").unwrap()),
            "Проекты/Obsidium.md"
        );
    }

    #[test]
    fn rejects_paths_that_escape_the_vault() {
        let (_guard, core, vault) = vault();
        assert!(vault.note_path("../secrets.md").is_err());
        assert!(vault.note_path("Проекты/../../secrets.md").is_err());
        assert!(vault.note_path("C:/Windows/system.ini").is_err());
        assert!(vault.note_path("/etc/passwd").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_paths_through_a_symlink_outside_the_vault() {
        use std::os::unix::fs::symlink;

        let (_guard, _core, vault) = vault();
        let sibling = vault.root.parent().unwrap().join("sibling-vault");
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("secret.md"), "чужое").unwrap();
        symlink(&sibling, vault.root.join("outside")).unwrap();

        assert!(vault.note_path("outside/secret.md").is_err());
        assert!(vault.note_path("outside/new.md").is_err());
        assert!(vault
            .note_path(&vault.root.join("outside/new.md").to_string_lossy())
            .is_err());
        assert_eq!(
            vault.note_path("inside/new.md").unwrap(),
            vault.root.join("inside/new.md")
        );
        assert_eq!(
            vault
                .note_path(&vault.root.join("inside/absolute-new.md").to_string_lossy())
                .unwrap(),
            vault.root.join("inside/absolute-new.md")
        );
    }

    #[test]
    fn rejects_a_sibling_folder_whose_name_starts_with_the_vault_name() {
        let (_guard, core, vault) = vault();
        let sibling = vault
            .root
            .parent()
            .unwrap()
            .join(format!("{}-private", Vault::title(&vault.root)));
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("secrets.md"), "чужое").unwrap();
        assert!(vault
            .note_path(&sibling.join("secrets.md").to_string_lossy())
            .is_err());
    }

    #[test]
    fn a_foreign_vault_keeps_its_own_boundary() {
        let (_guard, core, vault) = vault();
        let other = tempfile::tempdir().unwrap();
        let foreign = Vault {
            root: crate::search::paths::canonical_path(other.path()),
            visible: false,
        };

        assert!(
            foreign
                .note_path(&vault.root.join("Идея.md").to_string_lossy())
                .is_err(),
            "чужая база не пускает пути из другой базы"
        );
        assert_eq!(foreign.relative(&foreign.root.join("Новая.md")), "Новая.md");
    }

    #[test]
    fn reports_missing_and_ambiguous_notes() {
        let (_guard, core, vault) = vault();
        assert!(vault.note(&core, "Нет такой").is_err());
        let similar = vault.note(&core, "Идея старая").unwrap_err();
        assert!(similar.contains("Похожие: Идея.md"), "{similar}");

        fs::create_dir_all(vault.root.join("Архив")).unwrap();
        fs::write(vault.root.join("Архив/Obsidium.md"), "копия").unwrap();
        assert!(
            vault.note(&core, "Проекты/Obsidium.md").is_ok(),
            "точный путь остаётся однозначным"
        );
        assert!(
            vault.note(&core, "Obsidium").is_err(),
            "по названию два кандидата"
        );
    }

    #[test]
    fn skips_hidden_folders_such_as_trash() {
        let (_guard, core, vault) = vault();
        let trash = vault.root.join(crate::files::trash::TRASH_FOLDER);
        fs::create_dir_all(&trash).unwrap();
        fs::write(trash.join("Удалённая.md"), "мусор").unwrap();
        assert!(!vault
            .markdown_files()
            .any(|path| Vault::title(&path) == "Удалённая"));
    }
}
