use super::matching::make_excerpt;
use super::models::SearchResult;
use super::semantic::SemanticHit;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const RRF_K: f64 = 60.0;
const LEXICAL_WEIGHT: f64 = 0.40;
const SEMANTIC_WEIGHT: f64 = 0.60;
const BOTH_BONUS: f64 = 0.002;
const MIN_SEMANTIC_SCORE: f32 = 0.35;

#[derive(Default)]
struct Ranked {
    lexical_rank: Option<usize>,
    semantic_rank: Option<usize>,
    result: Option<SearchResult>,
    path: String,
}

pub fn rerank(
    root: &Path,
    lexical: Vec<SearchResult>,
    semantic: Vec<SemanticHit>,
    limit: usize,
) -> Vec<SearchResult> {
    if semantic.is_empty() {
        return lexical.into_iter().take(limit).collect();
    }
    let mut by_path = HashMap::<String, Ranked>::new();
    for (rank, result) in lexical.into_iter().enumerate() {
        let path = result.path.clone();
        by_path.insert(
            path.clone(),
            Ranked {
                lexical_rank: Some(rank),
                semantic_rank: None,
                result: Some(result),
                path,
            },
        );
    }
    for (rank, hit) in semantic
        .into_iter()
        .filter(|hit| hit.score >= MIN_SEMANTIC_SCORE)
        .enumerate()
    {
        let entry = by_path.entry(hit.path.clone()).or_insert_with(|| Ranked {
            path: hit.path,
            ..Ranked::default()
        });
        entry.semantic_rank = Some(rank);
    }

    let mut ranked = by_path.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        score(right)
            .partial_cmp(&score(left))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.path.cmp(&right.path))
    });
    ranked
        .into_iter()
        .filter_map(|entry| entry.result.or_else(|| semantic_result(root, &entry.path)))
        .take(limit)
        .collect()
}

fn score(entry: &Ranked) -> f64 {
    let lexical = entry
        .lexical_rank
        .map(|rank| LEXICAL_WEIGHT / (RRF_K + rank as f64 + 1.0))
        .unwrap_or(0.0);
    let semantic = entry
        .semantic_rank
        .map(|rank| SEMANTIC_WEIGHT / (RRF_K + rank as f64 + 1.0))
        .unwrap_or(0.0);
    lexical
        + semantic
        + if entry.lexical_rank.is_some() && entry.semantic_rank.is_some() {
            BOTH_BONUS
        } else {
            0.0
        }
}

fn semantic_result(root: &Path, path: &str) -> Option<SearchResult> {
    let path = PathBuf::from(path);
    if !path.starts_with(root) || !path.is_file() {
        return None;
    }
    let body = fs::read_to_string(&path).ok()?;
    let title = path.file_stem()?.to_string_lossy().into_owned();
    let extension = path.extension()?.to_string_lossy().into_owned();
    Some(SearchResult {
        path: path.to_string_lossy().into_owned(),
        title,
        extension,
        snippet: make_excerpt(&body, None),
        match_count: 0,
        match_offset: 0,
        heading: None,
        matched_terms: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::rerank;
    use crate::search::models::SearchResult;
    use crate::search::semantic::SemanticHit;
    use std::fs;

    fn result(path: String, title: &str) -> SearchResult {
        SearchResult {
            path,
            title: title.to_owned(),
            extension: "md".to_owned(),
            snippet: String::new(),
            match_count: 1,
            match_offset: 0,
            heading: None,
            matched_terms: vec![title.to_lowercase()],
        }
    }

    #[test]
    fn semantic_candidates_can_enter_the_final_result_set() {
        let directory = tempfile::tempdir().unwrap();
        let lexical_path = directory.path().join("literal.md");
        let semantic_path = directory.path().join("meaning.md");
        fs::write(&lexical_path, "literal").unwrap();
        fs::write(&semantic_path, "meaning without the query words").unwrap();
        let results = rerank(
            directory.path(),
            vec![result(
                lexical_path.to_string_lossy().into_owned(),
                "literal",
            )],
            vec![SemanticHit {
                path: semantic_path.to_string_lossy().into_owned(),
                score: 0.9,
            }],
            2,
        );
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .any(|item| item.path == semantic_path.to_string_lossy()));
    }

    #[test]
    fn semantic_rank_can_break_a_close_lexical_tie() {
        let directory = tempfile::tempdir().unwrap();
        let a = directory.path().join("a.md");
        let b = directory.path().join("b.md");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let results = rerank(
            directory.path(),
            vec![
                result(a.to_string_lossy().into_owned(), "a"),
                result(b.to_string_lossy().into_owned(), "b"),
            ],
            vec![
                SemanticHit {
                    path: b.to_string_lossy().into_owned(),
                    score: 0.99,
                },
                SemanticHit {
                    path: a.to_string_lossy().into_owned(),
                    score: 0.98,
                },
            ],
            2,
        );
        assert_eq!(results[0].path, b.to_string_lossy());
    }

    #[test]
    fn low_similarity_candidates_do_not_fill_search_results() {
        let directory = tempfile::tempdir().unwrap();
        let unrelated = directory.path().join("unrelated.md");
        fs::write(&unrelated, "unrelated note").unwrap();

        let results = rerank(
            directory.path(),
            Vec::new(),
            vec![SemanticHit {
                path: unrelated.to_string_lossy().into_owned(),
                score: 0.2,
            }],
            10,
        );

        assert!(results.is_empty());
    }

    #[test]
    fn semantic_candidates_outside_the_workspace_are_discarded() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = outside.path().join("outside.md");
        fs::write(&path, "outside workspace").unwrap();

        let results = rerank(
            workspace.path(),
            Vec::new(),
            vec![SemanticHit {
                path: path.to_string_lossy().into_owned(),
                score: 0.9,
            }],
            10,
        );

        assert!(results.is_empty());
    }
}
