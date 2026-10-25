use super::bm25f::source::{stored_text, title};
use super::graph::GraphSnapshot;
use super::models::AnalysisResult;
use crate::search::error::SearchError;
use crate::search::fields::{note_fields, FieldKind};
use crate::search::index::SearchIndex;
use crate::search::matching::analyzed_query_terms;
use crate::search::paths::identity;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, TermQuery};
use tantivy::schema::IndexRecordOption;
use tantivy::{TantivyDocument, Term};

const MAX_NEEDLE_TERMS: usize = 8;
const CANDIDATE_LIMIT: usize = 200;

pub fn analyze(
    index: &SearchIndex,
    graph: &GraphSnapshot,
    document_path: &Path,
    limit: usize,
) -> Result<Vec<AnalysisResult>, SearchError> {
    let title_needle = title(&document_path.to_string_lossy()).to_lowercase();
    let content = index.content.read(document_path).unwrap_or_default();
    let aliases = alias_needles(&content, &title_needle);
    let needles: Vec<&str> = std::iter::once(title_needle.as_str())
        .chain(aliases.iter().map(String::as_str))
        .filter(|needle| !needle.is_empty())
        .collect();
    let Some(query) = candidate_query(index, &title_needle, &aliases) else {
        return Ok(Vec::new());
    };

    let searcher = index.reader.searcher();
    let hits = searcher.search(
        &query,
        &TopDocs::with_limit(CANDIDATE_LIMIT).order_by_score(),
    )?;

    let source = identity(document_path);
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for (_score, address) in hits {
        let candidate = searcher.doc::<TantivyDocument>(address)?;
        let path = stored_text(&candidate, index.fields.id).unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        let candidate_path = PathBuf::from(&path);
        let candidate_identity = identity(&candidate_path);
        if candidate_identity == source
            || !seen.insert(candidate_identity)
            || graph.links_to(&candidate_path, document_path)
        {
            continue;
        }
        let body = index.content.read(&candidate_path).unwrap_or_default();
        let mentions = count_needles(&body, &needles);
        if mentions == 0 {
            continue;
        }
        results.push(AnalysisResult {
            title: title(&path),
            path,
            raw_score: mentions as f64,
            similarity: None,
            confidence: None,
            reasons: Vec::new(),
        });
    }

    results.sort_by(|left, right| {
        right
            .raw_score
            .partial_cmp(&left.raw_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
    });
    results.truncate(limit);
    Ok(results)
}

/// Whole-word, case-insensitive occurrences: `План` must not match inside `Планер`.
pub fn count_mentions(body: &str, needle: &str) -> usize {
    count_in(&body.to_lowercase(), needle)
}

fn count_needles(body: &str, needles: &[&str]) -> usize {
    let body = body.to_lowercase();
    needles
        .iter()
        .map(|needle| count_in(&body, needle))
        .sum()
}

fn count_in(body: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut from = 0;
    while let Some(relative) = body[from..].find(needle) {
        let start = from + relative;
        let end = start + needle.len();
        let before = body[..start].chars().next_back();
        let after = body[end..].chars().next();
        if !before.is_some_and(is_word_character) && !after.is_some_and(is_word_character) {
            count += 1;
        }
        from = end;
    }
    count
}

fn alias_needles(content: &str, title: &str) -> Vec<String> {
    let mut seen = HashSet::from([title.trim().to_lowercase()]);
    let mut aliases = Vec::new();
    for field in note_fields(content) {
        if !field.key.eq_ignore_ascii_case("aliases") && !field.key.eq_ignore_ascii_case("alias") {
            continue;
        }
        let values: &[String] = if field.kind == FieldKind::List {
            &field.items
        } else {
            std::slice::from_ref(&field.text)
        };
        for value in values {
            let alias = value.trim().to_lowercase();
            if !alias.is_empty() && seen.insert(alias.clone()) {
                aliases.push(alias);
            }
        }
    }
    aliases
}

fn candidate_query(
    index: &SearchIndex,
    title_needle: &str,
    aliases: &[String],
) -> Option<Box<dyn Query>> {
    let title_clauses = term_clauses(index, title_needle, Occur::Must);
    let mut alias_clauses = Vec::new();
    for alias in aliases {
        alias_clauses.extend(term_clauses(index, alias, Occur::Should));
    }
    match (title_clauses.is_empty(), alias_clauses.is_empty()) {
        (true, true) => None,
        (false, true) => Some(Box::new(BooleanQuery::new(title_clauses))),
        (true, false) => Some(Box::new(BooleanQuery::new(alias_clauses))),
        (false, false) => Some(Box::new(BooleanQuery::new(vec![
            (
                Occur::Should,
                Box::new(BooleanQuery::new(title_clauses)) as Box<dyn Query>,
            ),
            (
                Occur::Should,
                Box::new(BooleanQuery::new(alias_clauses)) as Box<dyn Query>,
            ),
        ]))),
    }
}

fn term_clauses(index: &SearchIndex, needle: &str, occur: Occur) -> Vec<(Occur, Box<dyn Query>)> {
    analyzed_query_terms(needle)
        .into_iter()
        .take(MAX_NEEDLE_TERMS)
        .map(|term| {
            (
                occur,
                Box::new(TermQuery::new(
                    Term::from_field_text(index.fields.body, &term),
                    IndexRecordOption::WithFreqs,
                )) as Box<dyn Query>,
            )
        })
        .collect()
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::{analyze, count_mentions};
    use crate::search::analysis::graph::GraphSnapshot;
    use crate::search::index::SearchIndex;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tantivy::doc;

    fn graph(root: &Path) -> GraphSnapshot {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE wiki_documents(path TEXT, relative_key TEXT, title_key TEXT);
                 CREATE TABLE wiki_links(source_path TEXT, target_key TEXT, target_kind TEXT, link_type TEXT);
                 CREATE TABLE note_fields(path TEXT, key_lower TEXT, text TEXT, items TEXT, ordinal INTEGER);",
            )
            .unwrap();
        GraphSnapshot::load(&connection, root).unwrap()
    }

    fn indexed(directory: &Path, files: &[(&str, &str)]) -> (PathBuf, SearchIndex) {
        let vault = directory.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let index = SearchIndex::open(&directory.join("index")).unwrap();
        let mut writer = index.index.writer(15_000_000).unwrap();
        for (name, body) in files {
            let path = vault.join(name);
            fs::write(&path, body).unwrap();
            writer
                .add_document(doc!(
                    index.fields.id => path.to_string_lossy().as_ref(),
                    index.fields.path => path.to_string_lossy().as_ref(),
                    index.fields.title => name.trim_end_matches(".md"),
                    index.fields.body => *body,
                ))
                .unwrap();
        }
        writer.commit().unwrap();
        index.reload().unwrap();
        (vault, index)
    }

    #[test]
    fn counts_whole_word_mentions_in_any_case() {
        let body = "План на неделю. Здесь план упомянут дважды, а планер — нет.";
        assert_eq!(count_mentions(body, "план"), 2);
    }

    #[test]
    fn ignores_russian_case_and_punctuation() {
        assert_eq!(count_mentions("См. «Проект X», проект Y.", "проект x"), 1);
    }

    #[test]
    fn a_missing_title_scores_zero() {
        assert_eq!(count_mentions("Совсем другой текст.", "план"), 0);
    }

    #[test]
    fn finds_a_note_that_mentions_only_an_alias() {
        let directory = tempfile::tempdir().unwrap();
        let (vault, index) = indexed(
            directory.path(),
            &[
                ("источник.md", "---\naliases:\n  - Гроза\n---\nтело"),
                ("обзор.md", "Гроза стартует в мае, остальное позже."),
            ],
        );

        let results = analyze(&index, &graph(&vault), &vault.join("источник.md"), 10).unwrap();

        assert_eq!(results.len(), 1, "{results:?}");
        assert!(results[0].path.ends_with("обзор.md"));
        assert_eq!(results[0].raw_score, 1.0);
    }

    #[test]
    fn finds_a_note_that_mentions_the_title() {
        let directory = tempfile::tempdir().unwrap();
        let (vault, index) = indexed(
            directory.path(),
            &[
                ("план.md", "---\ntype: note\n---\nтело"),
                ("отчёт.md", "План на неделю уже готов."),
            ],
        );

        let results = analyze(&index, &graph(&vault), &vault.join("план.md"), 10).unwrap();

        assert_eq!(results.len(), 1, "{results:?}");
        assert!(results[0].path.ends_with("отчёт.md"));
        assert_eq!(results[0].raw_score, 1.0);
    }

    #[test]
    fn an_alias_inside_another_word_is_not_counted() {
        let directory = tempfile::tempdir().unwrap();
        let (vault, index) = indexed(
            directory.path(),
            &[
                ("источник.md", "---\nalias: книга\n---\nтело"),
                ("полка.md", "Обменялся книгами с другом."),
            ],
        );

        let results = analyze(&index, &graph(&vault), &vault.join("источник.md"), 10).unwrap();

        assert!(results.is_empty(), "{results:?}");
    }

    #[test]
    fn an_alias_equal_to_the_title_does_not_double_count() {
        let directory = tempfile::tempdir().unwrap();
        let (vault, index) = indexed(
            directory.path(),
            &[
                ("план.md", "---\naliases: [План]\n---\nтело"),
                ("неделя.md", "План на неделю. Ещё раз план к среде."),
            ],
        );

        let results = analyze(&index, &graph(&vault), &vault.join("план.md"), 10).unwrap();

        assert_eq!(results.len(), 1, "{results:?}");
        assert_eq!(results[0].raw_score, 2.0);
    }

    #[test]
    fn list_and_scalar_alias_forms_both_count() {
        let directory = tempfile::tempdir().unwrap();
        let (vault, index) = indexed(
            directory.path(),
            &[
                ("список.md", "---\naliases: [Шторм, Гроза]\n---\nтело"),
                ("скаляр.md", "---\nalias: \"Шторм\"\n---\nтело"),
                ("сводка.md", "Шторм усиливается, гроза близко."),
            ],
        );

        let listed = analyze(&index, &graph(&vault), &vault.join("список.md"), 10).unwrap();
        assert_eq!(listed.len(), 1, "{listed:?}");
        assert_eq!(listed[0].raw_score, 2.0);

        let scalar = analyze(&index, &graph(&vault), &vault.join("скаляр.md"), 10).unwrap();
        assert_eq!(scalar.len(), 1, "{scalar:?}");
        assert_eq!(scalar[0].raw_score, 1.0);
    }
}
