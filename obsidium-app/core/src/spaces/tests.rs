use super::{delete_space, list_space_files, save_space, Space, SpaceSettings};
use crate::settings::models::AppConfig;
use std::path::Path;

fn write(vault: &Path, relative: &str, content: &str) {
    let path = vault.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn expected(vault: &Path, relative: &[&str]) -> Vec<String> {
    let mut values = relative
        .iter()
        .map(|value| vault.join(value).to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    values.sort();
    values
}

#[test]
fn default_config_has_one_space_covering_the_vault() {
    let config: AppConfig = serde_json::from_str("{}").unwrap();

    assert_eq!(config.spaces.spaces.len(), 1);
    let space = &config.spaces.spaces[0];
    assert_eq!(space.id, "all");
    assert_eq!(space.name, "Всё");
    assert!(space.root.is_empty());
    assert!(space.include_tags.is_empty());
    assert!(space.exclude_folders.is_empty());
}

#[test]
fn space_round_trips_with_camel_case_keys() {
    let space = Space {
        id: "notes".to_owned(),
        name: "Заметки".to_owned(),
        root: "notes".to_owned(),
        include_tags: vec!["alpha".to_owned()],
        exclude_folders: vec!["archive".to_owned()],
    };

    let value = serde_json::to_value(&space).unwrap();

    assert_eq!(value["id"], serde_json::json!("notes"));
    assert_eq!(value["includeTags"], serde_json::json!(["alpha"]));
    assert_eq!(value["excludeFolders"], serde_json::json!(["archive"]));
    assert!(value.get("include_tags").is_none());
    assert_eq!(serde_json::from_value::<Space>(value).unwrap(), space);
}

#[test]
fn save_space_generates_unique_ids_and_replaces_in_place() {
    let mut settings = SpaceSettings::default();

    let first = save_space(
        &mut settings,
        Space {
            id: String::new(),
            name: "  Work Notes ".to_owned(),
            root: "./notes/".to_owned(),
            include_tags: vec![
                "#alpha".to_owned(),
                " alpha ".to_owned(),
                "Beta".to_owned(),
                String::new(),
            ],
            exclude_folders: vec!["archive\\old/".to_owned()],
        },
    )
    .unwrap();

    assert_eq!(first.id, "work-notes");
    assert_eq!(first.name, "Work Notes");
    assert_eq!(first.root, "notes");
    assert_eq!(first.include_tags, vec!["alpha", "Beta"]);
    assert_eq!(first.exclude_folders, vec!["archive/old"]);
    assert_eq!(settings.spaces.len(), 2);
    assert_eq!(settings.spaces[1], first);

    let second = save_space(
        &mut settings,
        Space {
            id: String::new(),
            name: "work notes".to_owned(),
            ..Space::default()
        },
    )
    .unwrap();

    assert_eq!(second.id, "work-notes-2");
    assert_eq!(settings.spaces.len(), 3);

    let replaced = save_space(
        &mut settings,
        Space {
            id: "work-notes".to_owned(),
            name: "Renamed".to_owned(),
            ..Space::default()
        },
    )
    .unwrap();

    assert_eq!(replaced.id, "work-notes");
    assert_eq!(settings.spaces.len(), 3);
    assert_eq!(settings.spaces[0].id, "all");
    assert_eq!(settings.spaces[1].name, "Renamed");
    assert_eq!(settings.spaces[1].root, "");
}

#[test]
fn save_space_rejects_empty_names_and_escaping_roots() {
    let mut settings = SpaceSettings::default();

    assert!(save_space(
        &mut settings,
        Space {
            name: "   ".to_owned(),
            ..Space::default()
        }
    )
    .is_err());
    for root in ["../outside", "notes/../outside", "/etc", "C:\\notes"] {
        assert!(
            save_space(
                &mut settings,
                Space {
                    name: "Notes".to_owned(),
                    root: root.to_owned(),
                    ..Space::default()
                }
            )
            .is_err(),
            "{root}"
        );
    }
    assert_eq!(settings.spaces.len(), 1);
}

#[test]
fn delete_space_keeps_the_last_space() {
    let mut settings = SpaceSettings::default();

    assert!(delete_space(&mut settings, "missing").is_err());
    assert!(delete_space(&mut settings, "all").is_err());

    save_space(
        &mut settings,
        Space {
            id: "extra".to_owned(),
            name: "Extra".to_owned(),
            ..Space::default()
        },
    )
    .unwrap();

    delete_space(&mut settings, "all").unwrap();
    assert_eq!(settings.spaces.len(), 1);
    assert_eq!(settings.spaces[0].id, "extra");
    assert!(delete_space(&mut settings, "extra").is_err());
}

#[test]
fn list_space_files_respects_the_root_and_missing_roots() {
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "root/b.md", "# b");
    write(vault.path(), "root/a.md", "# a");
    write(vault.path(), "root/nested/c.md", "# c");
    write(vault.path(), "other/d.md", "# d");

    let space = Space {
        root: "root".to_owned(),
        ..Space::default()
    };

    assert_eq!(
        list_space_files(vault.path(), &space).unwrap(),
        expected(
            vault.path(),
            &["root/a.md", "root/b.md", "root/nested/c.md"]
        )
    );
    assert_eq!(
        list_space_files(vault.path(), &Space::default()).unwrap(),
        expected(
            vault.path(),
            &["other/d.md", "root/a.md", "root/b.md", "root/nested/c.md"]
        )
    );
    assert!(list_space_files(
        vault.path(),
        &Space {
            root: "missing".to_owned(),
            ..Space::default()
        }
    )
    .unwrap()
    .is_empty());
    assert!(list_space_files(
        vault.path(),
        &Space {
            root: "../outside".to_owned(),
            ..Space::default()
        }
    )
    .unwrap()
    .is_empty());
}

#[cfg(unix)]
#[test]
fn list_space_files_rejects_roots_that_symlink_outside_the_workspace() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "secret.md", "# secret");
    std::os::unix::fs::symlink(outside.path(), vault.path().join("escape")).unwrap();
    let space = Space {
        root: "escape".to_owned(),
        ..Space::default()
    };

    assert!(list_space_files(vault.path(), &space).unwrap().is_empty());
}

#[test]
fn list_space_files_skips_excluded_folders_and_their_children() {
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "keep/a.md", "# a");
    write(vault.path(), "archive/b.md", "# b");
    write(vault.path(), "archive/deep/c.md", "# c");
    write(vault.path(), "nested/archive/d.md", "# d");
    write(vault.path(), "nested/keep/e.md", "# e");

    let space = Space {
        exclude_folders: vec!["Archive".to_owned(), "nested/archive".to_owned()],
        ..Space::default()
    };

    assert_eq!(
        list_space_files(vault.path(), &space).unwrap(),
        expected(vault.path(), &["keep/a.md", "nested/keep/e.md"])
    );
}

#[test]
fn list_space_files_filters_markdown_by_frontmatter_tags() {
    let vault = tempfile::tempdir().unwrap();
    write(
        vault.path(),
        "list.md",
        "---\ntags: [alpha, beta]\n---\n# list\n",
    );
    write(
        vault.path(),
        "scalar.md",
        "---\ntags: Alpha\n---\n# scalar\n",
    );
    write(
        vault.path(),
        "other.md",
        "---\ntags: [gamma]\n---\n# other\n",
    );
    write(vault.path(), "plain.md", "# plain\n");
    write(vault.path(), "notes.txt", "alpha");

    let space = Space {
        include_tags: vec!["#ALPHA".to_owned()],
        ..Space::default()
    };

    assert_eq!(
        list_space_files(vault.path(), &space).unwrap(),
        expected(vault.path(), &["list.md", "scalar.md"])
    );
}
