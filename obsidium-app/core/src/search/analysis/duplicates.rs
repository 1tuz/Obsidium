use super::bm25f::source::{load_source, stored_text, title};
use super::bm25f::terms::{candidate_query, select_terms};
use super::models::AnalysisResult;
use crate::search::analyzer::indexing_tokenizer;
use crate::search::error::SearchError;
use crate::search::index::SearchIndex;
use crate::search::paths::identity;
use crate::settings::models::{Bm25fParams, SearchIndexSettings};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::tokenizer::TokenStream;
use tantivy::TantivyDocument;

const MIN_TERMS: usize = 12;
const MIN_JACCARD: f64 = 0.5;
const MIN_LENGTH_RATIO: f64 = 0.6;
const MAX_REASONS: usize = 5;

pub fn analyze(
    index: &SearchIndex,
    document_path: &Path,
    limit: usize,
    search: &SearchIndexSettings,
    params: &Bm25fParams,
) -> Result<Vec<AnalysisResult>, SearchError> {
    let searcher = index.reader.searcher();
    let (source_title, source_body) = load_source(&searcher, index, document_path)?;
    let source = Profile::new(&source_body);
    if source.frequencies.len() < MIN_TERMS || source.shingles.is_empty() {
        return Ok(Vec::new());
    }
    let terms = select_terms(
        &searcher,
        index,
        &source_body,
        &source_title,
        search.max_query_terms,
    )?;
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let candidate_limit = search
        .candidate_pool_size
        .clamp(16, 2048)
        .min(searcher.num_docs() as usize);
    if candidate_limit == 0 {
        return Ok(Vec::new());
    }

    let hits = searcher.search(
        &candidate_query(index, &terms, params),
        &TopDocs::with_limit(candidate_limit).order_by_score(),
    )?;
    let source_identity = identity(document_path);
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for (_retrieval_score, address) in hits {
        let candidate = searcher.doc::<TantivyDocument>(address)?;
        let path = stored_text(&candidate, index.fields.id).unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        let candidate_identity = identity(Path::new(&path));
        if candidate_identity == source_identity || !seen.insert(candidate_identity) {
            continue;
        }
        let body = stored_text(&candidate, index.fields.body).unwrap_or_default();
        let profile = Profile::new(&body);
        let overlap = source.jaccard(&profile);
        if overlap < MIN_JACCARD || source.length_ratio(&profile) < MIN_LENGTH_RATIO {
            continue;
        }
        let candidate_title = stored_text(&candidate, index.fields.title)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| title(&path));
        results.push(AnalysisResult {
            path,
            title: candidate_title,
            raw_score: overlap,
            similarity: Some(overlap),
            confidence: Some(overlap),
            reasons: source.shared_terms(&profile),
        });
    }

    results.sort_by(|left, right| {
        right
            .raw_score
            .partial_cmp(&left.raw_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
    });
    results.truncate(limit);
    Ok(results)
}

struct Profile {
    frequencies: HashMap<String, u32>,
    shingles: HashSet<String>,
    tokens: u32,
}

impl Profile {
    fn new(text: &str) -> Self {
        let mut frequencies = HashMap::<String, u32>::new();
        let mut sequence = Vec::new();
        let mut tokens = 0u32;
        indexing_tokenizer()
            .token_stream(text)
            .process(&mut |token| {
                tokens = tokens.saturating_add(1);
                sequence.push(token.text.clone());
                let frequency = frequencies.entry(token.text.clone()).or_insert(0);
                *frequency = frequency.saturating_add(1);
            });
        let shingles = sequence
            .windows(2)
            .map(|pair| format!("{} {}", pair[0], pair[1]))
            .collect();
        Self {
            frequencies,
            shingles,
            tokens,
        }
    }

    fn jaccard(&self, other: &Self) -> f64 {
        let shared = self.shingles.intersection(&other.shingles).count();
        let total = self.shingles.union(&other.shingles).count();
        if total == 0 {
            return 0.0;
        }
        shared as f64 / total as f64
    }

    fn length_ratio(&self, other: &Self) -> f64 {
        let longest = self.tokens.max(other.tokens);
        if longest == 0 {
            return 0.0;
        }
        self.tokens.min(other.tokens) as f64 / longest as f64
    }

    fn shared_terms(&self, other: &Self) -> Vec<String> {
        let mut shared = self
            .frequencies
            .iter()
            .filter(|(term, _)| other.frequencies.contains_key(*term))
            .map(|(term, frequency)| (term.clone(), *frequency))
            .collect::<Vec<_>>();
        shared.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        shared
            .into_iter()
            .take(MAX_REASONS)
            .map(|(term, _)| term)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Profile;

    #[test]
    fn identical_text_is_a_full_match() {
        let text = "Заметка про планирование недели и обзор встреч команды.";
        let profile = Profile::new(text);
        assert!((profile.jaccard(&Profile::new(text)) - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn a_reordered_copy_is_not_a_full_match() {
        let original = Profile::new("планирование недели обзор встреч команды планирование недели");
        let reordered =
            Profile::new("обзор встреч команды планирование недели планирование недели");
        let overlap = original.jaccard(&reordered);
        assert!(overlap < 1.0, "shingles must stay order sensitive");
        assert!(overlap > 0.0);
    }

    #[test]
    fn an_unrelated_note_scores_near_zero() {
        let notes = Profile::new("Про планирование недели и встречи команды.");
        let other = Profile::new("Рецепт борща со свёклой и капустой.");
        assert_eq!(notes.jaccard(&other), 0.0);
    }
}
