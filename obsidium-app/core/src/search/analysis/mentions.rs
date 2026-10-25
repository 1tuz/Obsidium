use super::bm25f::source::{stored_text, title};
use super::graph::GraphSnapshot;
use super::models::AnalysisResult;
use crate::search::error::SearchError;
use crate::search::index::SearchIndex;
use crate::search::matching::analyzed_query_terms;
use crate::search::paths::identity;
use std::path::{Path, PathBuf};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, TermQuery};
use tantivy::schema::IndexRecordOption;
use tantivy::{TantivyDocument, Term};

const MAX_TITLE_TERMS: usize = 8;
const CANDIDATE_LIMIT: usize = 200;

pub fn analyze(
    index: &SearchIndex,
    graph: &GraphSnapshot,
    document_path: &Path,
    limit: usize,
) -> Result<Vec<AnalysisResult>, SearchError> {
    let needle = title(&document_path.to_string_lossy()).to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let terms = analyzed_query_terms(&needle);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let clauses: Vec<(Occur, Box<dyn Query>)> = terms
        .iter()
        .take(MAX_TITLE_TERMS)
        .map(|term| {
            (
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(index.fields.body, term),
                    IndexRecordOption::WithFreqs,
                )) as Box<dyn Query>,
            )
        })
        .collect();
    let searcher = index.reader.searcher();
    let hits = searcher.search(
        &BooleanQuery::new(clauses),
        &TopDocs::with_limit(CANDIDATE_LIMIT).order_by_score(),
    )?;

    let source = identity(document_path);
    let mut seen = std::collections::HashSet::new();
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
        let mentions = count_mentions(&body, &needle);
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
    let body = body.to_lowercase();
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

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::count_mentions;

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
}
