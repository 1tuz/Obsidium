use super::duplicates::analyze;
use crate::search::index::SearchIndex;
use crate::settings::models::{Bm25fParams, SearchIndexSettings};
use std::fs;
use tantivy::doc;

const COPY: &str = "планирование недели обзор встреч команды решения по задачам \
     сроки релиза риски зависимости итоги ретроспективы заметки архив ссылки";

fn indexed(documents: &[(std::path::PathBuf, &str, String)]) -> (tempfile::TempDir, SearchIndex) {
    let directory = tempfile::tempdir().unwrap();
    let index = SearchIndex::open(&directory.path().join("index")).unwrap();
    let mut writer = index.index.writer(15_000_000).unwrap();
    for (path, title, body) in documents {
        writer
            .add_document(doc!(
                index.fields.id => path.to_string_lossy().as_ref(),
                index.fields.path => path.to_string_lossy().as_ref(),
                index.fields.title => *title,
                index.fields.body => body.as_str(),
            ))
            .unwrap();
    }
    writer.commit().unwrap();
    index.reload().unwrap();
    (directory, index)
}

#[test]
fn a_copy_of_the_note_surfaces_and_unrelated_notes_do_not() {
    let directory = tempfile::tempdir().unwrap();
    let vault = directory.path().join("vault");
    fs::create_dir_all(&vault).unwrap();
    let source = vault.join("источник.md");
    let copy = vault.join("копия.md");
    let other = vault.join("другое.md");
    fs::write(&source, COPY).unwrap();
    fs::write(&copy, COPY).unwrap();
    fs::write(&other, "рецепт борща свёкла капуста бульон сметана").unwrap();

    let (_index_directory, index) = indexed(&[
        (source.clone(), "источник", COPY.to_owned()),
        (copy.clone(), "копия", COPY.to_owned()),
        (
            other.clone(),
            "другое",
            "рецепт борща свёкла капуста бульон сметана".to_owned(),
        ),
    ]);

    let results = analyze(
        &index,
        &source,
        10,
        &SearchIndexSettings::default(),
        &Bm25fParams::default(),
    )
    .unwrap();

    assert_eq!(
        results.len(),
        1,
        "only the copy must be reported: {results:?}"
    );
    assert!(results[0].path.contains("копия.md"));
    assert_eq!(results[0].similarity, Some(1.0));
    assert!(!results[0].reasons.is_empty());
}

#[test]
fn a_short_note_never_claims_duplicates() {
    let directory = tempfile::tempdir().unwrap();
    let vault = directory.path().join("vault");
    fs::create_dir_all(&vault).unwrap();
    let source = vault.join("short.md");
    let copy = vault.join("short-copy.md");
    fs::write(&source, "две заметки").unwrap();
    fs::write(&copy, "две заметки").unwrap();

    let (_index_directory, index) = indexed(&[
        (source.clone(), "short", "две заметки".to_owned()),
        (copy, "short-copy", "две заметки".to_owned()),
    ]);

    let results = analyze(
        &index,
        &source,
        10,
        &SearchIndexSettings::default(),
        &Bm25fParams::default(),
    )
    .unwrap();

    assert!(results.is_empty(), "short notes have too little signal");
}
