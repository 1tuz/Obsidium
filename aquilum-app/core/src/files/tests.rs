use super::document::{
    create_file_impl, hash_bytes, normalize_line_endings, read_file_snapshot_impl,
    read_file_stat_impl, rename_file_impl, write_file_atomic_impl,
};
use super::error::FileCommandError;
use super::models::FileItemType;
use super::workspace::{list_vault_snippets_impl, read_directory_impl};
use std::fs;

#[test]
fn stat_returns_byte_length_without_reading_content() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("book.epub");
    fs::write(&path, b"0123456789abcdef").expect("fixture");

    let stat = read_file_stat_impl(&path).expect("stat");

    assert_eq!(stat.byte_length, 16);
}

#[test]
fn snapshot_contains_content_and_hash() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("note.md");
    fs::write(&path, "Привет, Aquilum!").expect("fixture");

    let snapshot = read_file_snapshot_impl(&path).expect("snapshot");

    assert_eq!(snapshot.content, "Привет, Aquilum!");
    assert_eq!(snapshot.hash, hash_bytes(snapshot.content.as_bytes()));
}

#[test]
fn atomic_write_replaces_the_complete_file() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("note.md");
    fs::write(&path, "before").expect("fixture");

    let result = write_file_atomic_impl(&path, "after", None).expect("write");

    assert_eq!(fs::read_to_string(&path).expect("result"), "after");
    assert_eq!(result.hash, hash_bytes(b"after"));
}

#[test]
fn obsidian_fixture_round_trips_unknown_data_and_unicode_paths() {
    let directory = tempfile::tempdir().expect("temp directory");
    let vault = directory.path().join("Vault with spaces");
    fs::create_dir_all(&vault).expect("vault");
    let path = vault.join("Заметка.md");
    let fixture = include_str!("../../../tests/fixtures/obsidian-vault/frontmatter.md");
    fs::write(&path, fixture).expect("fixture");

    let original = read_file_snapshot_impl(&path).expect("open fixture");
    let changed = original
        .content
        .replacen("# Заметка", "# Заметка изменена", 1);
    write_file_atomic_impl(&path, &changed, Some(&original.hash)).expect("save edit");
    let saved = read_file_snapshot_impl(&path).expect("read saved fixture");

    assert!(saved
        .content
        .starts_with("---\ntitle: Round trip\naliases:"));
    assert!(saved.content.contains("unknown_plugin:\n  settings:"));
    assert!(saved.content.contains("![[Folder/Note#Заголовок]]"));
    assert!(saved.content.contains("```dataview\nTABLE status"));
    assert!(saved
        .content
        .contains("<custom-block data-plugin=\"unknown\">"));
    assert!(saved.content.contains("> [!warning] Callout"));
    assert!(saved.content.contains("- [ ] Задача"));
    assert!(saved.content.contains("# Заметка изменена"));
}

#[test]
fn expected_hash_prevents_overwrite() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("note.md");
    fs::write(&path, "external change").expect("fixture");

    let error = write_file_atomic_impl(&path, "aquilum change", Some("stale-hash"))
        .expect_err("conflict expected");

    assert!(matches!(error, FileCommandError::Conflict { .. }));
    assert_eq!(
        fs::read_to_string(&path).expect("unchanged file"),
        "external change"
    );
}

#[test]
fn create_file_never_overwrites_an_existing_note() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("note.md");
    fs::write(&path, "keep me").expect("fixture");

    let error = create_file_impl(&path, "replacement").expect_err("already exists");

    assert!(matches!(error, FileCommandError::AlreadyExists { .. }));
    assert_eq!(fs::read_to_string(&path).expect("result"), "keep me");
}

#[test]
fn rename_file_never_overwrites_an_existing_note() {
    let directory = tempfile::tempdir().expect("temp directory");
    let old_path = directory.path().join("old.md");
    let new_path = directory.path().join("new.md");
    fs::write(&old_path, "old content").expect("old fixture");
    fs::write(&new_path, "new content").expect("new fixture");

    let error = rename_file_impl(&old_path, &new_path).expect_err("already exists");

    assert!(matches!(error, FileCommandError::AlreadyExists { .. }));
    assert_eq!(
        fs::read_to_string(old_path).expect("old result"),
        "old content"
    );
    assert_eq!(
        fs::read_to_string(new_path).expect("new result"),
        "new content"
    );
}

#[test]
fn rename_file_moves_content_to_a_new_name() {
    let directory = tempfile::tempdir().expect("temp directory");
    let old_path = directory.path().join("old.md");
    let new_path = directory.path().join("new.md");
    fs::write(&old_path, "content").expect("fixture");

    rename_file_impl(&old_path, &new_path).expect("rename");

    assert!(!old_path.exists());
    assert_eq!(fs::read_to_string(new_path).expect("result"), "content");
}

#[test]
fn invalid_utf8_is_rejected() {
    let directory = tempfile::tempdir().expect("temp directory");
    let path = directory.path().join("note.md");
    fs::write(&path, [0xff, 0xfe]).expect("fixture");

    let error = read_file_snapshot_impl(&path).expect_err("invalid UTF-8");

    assert!(matches!(error, FileCommandError::InvalidUtf8 { .. }));
}

#[test]
fn command_error_has_a_stable_serialized_code() {
    let error = FileCommandError::AlreadyExists {
        path: "note.md".to_owned(),
    };

    let value = serde_json::to_value(error).expect("serialized error");

    assert_eq!(value["code"], "already_exists");
    assert_eq!(value["details"]["path"], "note.md");
}

#[test]
fn workspace_filters_and_sorts_entries() {
    let directory = tempfile::tempdir().expect("temp directory");
    fs::create_dir(directory.path().join("Folder")).expect("folder fixture");
    fs::write(directory.path().join("Beta.md"), "").expect("beta fixture");
    fs::write(directory.path().join("alpha.md"), "").expect("alpha fixture");
    fs::write(directory.path().join("Gamma.MD"), "").expect("gamma fixture");
    fs::write(directory.path().join("photo.png"), "").expect("image fixture");
    fs::write(directory.path().join("doc.pdf"), "").expect("pdf fixture");
    fs::write(directory.path().join("novel.epub"), "").expect("epub fixture");
    fs::write(directory.path().join("notes.txt"), "").expect("text fixture");
    fs::write(directory.path().join(".hidden.md"), "").expect("hidden fixture");

    let items = read_directory_impl(directory.path()).expect("workspace");
    let names: Vec<_> = items.iter().map(|item| item.name.as_str()).collect();

    assert_eq!(
        names,
        vec![
            "Folder",
            "alpha",
            "Beta",
            "doc.pdf",
            "Gamma",
            "novel.epub",
            "photo.png"
        ]
    );
    assert_eq!(items[0].item_type, FileItemType::Folder);
    assert_eq!(items[1].item_type, FileItemType::File);
}

#[test]
fn vault_snippets_list_only_css_files_inside_the_vault() {
    let directory = tempfile::tempdir().expect("workspace");
    let snippets = directory.path().join(".obsidian/snippets");
    fs::create_dir_all(&snippets).expect("snippets folder");
    fs::write(snippets.join("zebra.css"), "body {}").expect("css fixture");
    fs::write(snippets.join("Alpha.CSS"), "body {}").expect("css fixture");
    fs::write(snippets.join("ignored.js"), "").expect("non-css fixture");

    let found = list_vault_snippets_impl(directory.path()).expect("list snippets");

    assert_eq!(
        found.iter().map(|item| item.name.as_str()).collect::<Vec<_>>(),
        vec!["Alpha.CSS", "zebra.css"]
    );
}

#[test]
fn vault_snippet_list_is_empty_when_the_vault_has_no_snippets_folder() {
    let directory = tempfile::tempdir().expect("workspace");

    assert!(list_vault_snippets_impl(directory.path())
        .expect("list snippets")
        .is_empty());
}

#[test]
fn a_snapshot_normalises_crlf_but_keeps_the_hash_of_the_bytes_on_disk() {
    let directory = tempfile::tempdir().expect("workspace");
    let path = directory.path().join("Заметка.md");
    fs::write(&path, "первая\r\nвторая\r\nтретья").expect("fixture");

    let snapshot = read_file_snapshot_impl(&path).expect("snapshot");

    assert_eq!(snapshot.content, "первая\nвторая\nтретья");
    assert_eq!(
        snapshot.hash,
        hash_bytes("первая\r\nвторая\r\nтретья".as_bytes()),
        "хэш остаётся хэшем файла: на нём держится проверка при записи"
    );
    assert_eq!(
        snapshot.text_hash,
        hash_bytes("первая\nвторая\nтретья".as_bytes()),
        "text_hash считается от нормализованного текста — его и видит документ в ядре"
    );
}

#[test]
fn a_snapshot_of_an_lf_file_reports_the_same_hash_twice() {
    let directory = tempfile::tempdir().expect("workspace");
    let path = directory.path().join("Заметка.md");
    fs::write(&path, "первая\nвторая").expect("fixture");

    let snapshot = read_file_snapshot_impl(&path).expect("snapshot");

    assert_eq!(snapshot.content, "первая\nвторая");
    assert_eq!(snapshot.hash, snapshot.text_hash);
}

#[test]
fn a_lone_carriage_return_is_normalised_too() {
    assert_eq!(normalize_line_endings("одна\rдве".to_owned()), "одна\nдве");
    assert_eq!(normalize_line_endings("без переносов".to_owned()), "без переносов");
}
