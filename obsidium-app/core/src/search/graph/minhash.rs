use crate::search::error::SearchError;
use crate::search::index::SearchIndex;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DocAddress, DocSet, TantivyDocument, TERMINATED};

pub const LSH_BANDS: usize = 32;
pub const LSH_ROWS: usize = 4;
pub const SIGNATURE_LENGTH: usize = LSH_BANDS * LSH_ROWS;
pub const SIMILARITY_THRESHOLD: f32 = 0.4;
pub const MAX_SIMILAR_PAIRS_PER_NOTE: usize = 8;
pub const MAX_CANDIDATES_PER_BAND: usize = 64;
pub const MIN_TERM_BYTES: usize = 2;
pub const SIGNATURE_MARGIN: f32 = 0.15;

const HASH_MULTIPLIER: u64 = 0x9e37_79b9_7f4a_7c15;
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x100_0000_01b3;

pub fn similar_note_pairs(
    index: &SearchIndex,
    allowed: &BTreeSet<String>,
) -> Result<Vec<(String, String)>, SearchError> {
    let terms = term_sets(index, allowed)?;
    Ok(similar_pairs(&terms))
}

fn term_sets(
    index: &SearchIndex,
    allowed: &BTreeSet<String>,
) -> Result<BTreeMap<String, BTreeSet<u64>>, SearchError> {
    let searcher = index.reader.searcher();
    let mut terms_by_path = BTreeMap::<String, BTreeSet<u64>>::new();
    for (segment_ord, segment) in searcher.segment_readers().iter().enumerate() {
        let mut paths = HashMap::<u32, String>::new();
        for doc_id in segment.doc_ids_alive() {
            let address = DocAddress::new(segment_ord as u32, doc_id);
            let document = searcher.doc::<TantivyDocument>(address)?;
            let Some(path) = document
                .get_first(index.fields.id)
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            if !allowed.contains(path) {
                continue;
            }
            paths.insert(doc_id, path.to_owned());
            terms_by_path.entry(path.to_owned()).or_default();
        }
        if paths.is_empty() {
            continue;
        }
        for field in [index.fields.title, index.fields.body] {
            let inverted = segment.inverted_index(field)?;
            let mut stream = inverted.terms().stream()?;
            while stream.advance() {
                let key = stream.key();
                if key.len() < MIN_TERM_BYTES {
                    continue;
                }
                let term = hash_term(key);
                let mut postings = inverted
                    .read_postings_from_terminfo(stream.value(), IndexRecordOption::Basic)?;
                let mut doc_id = postings.doc();
                while doc_id != TERMINATED {
                    if let Some(path) = paths.get(&doc_id) {
                        if let Some(terms) = terms_by_path.get_mut(path) {
                            terms.insert(term);
                        }
                    }
                    doc_id = postings.advance();
                }
            }
        }
    }
    Ok(terms_by_path)
}

pub fn similar_pairs(terms_by_path: &BTreeMap<String, BTreeSet<u64>>) -> Vec<(String, String)> {
    let paths = terms_by_path.keys().cloned().collect::<Vec<_>>();
    let signatures = paths
        .iter()
        .map(|path| signature(terms_by_path[path].iter().copied()))
        .collect::<Vec<_>>();
    let mut buckets = HashMap::<u64, Vec<usize>>::new();
    for (document, signature) in signatures.iter().enumerate() {
        if terms_by_path[&paths[document]].is_empty() {
            continue;
        }
        for band in 0..LSH_BANDS {
            let start = band * LSH_ROWS;
            let key = band_key(band, &signature[start..start + LSH_ROWS]);
            buckets.entry(key).or_default().push(document);
        }
    }
    let mut candidates = Vec::<(f32, usize, usize)>::new();
    let mut seen = BTreeSet::<(usize, usize)>::new();
    for bucket in buckets.values() {
        if bucket.len() < 2 || bucket.len() > MAX_CANDIDATES_PER_BAND {
            continue;
        }
        for (position, left) in bucket.iter().enumerate() {
            for right in &bucket[position + 1..] {
                let pair = (*left.min(right), *left.max(right));
                if !seen.insert(pair) {
                    continue;
                }
                if estimated_similarity(&signatures[pair.0], &signatures[pair.1]) + SIGNATURE_MARGIN
                    < SIMILARITY_THRESHOLD
                {
                    continue;
                }
                let similarity = jaccard(
                    &terms_by_path[&paths[pair.0]],
                    &terms_by_path[&paths[pair.1]],
                );
                if similarity >= SIMILARITY_THRESHOLD {
                    candidates.push((similarity, pair.0, pair.1));
                }
            }
        }
    }
    candidates.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| paths[left.1].cmp(&paths[right.1]))
            .then_with(|| paths[left.2].cmp(&paths[right.2]))
    });
    let mut kept_per_note = HashMap::<usize, usize>::new();
    let mut pairs = BTreeSet::<(String, String)>::new();
    for (_, left, right) in candidates {
        let left_count = kept_per_note.get(&left).copied().unwrap_or_default();
        let right_count = kept_per_note.get(&right).copied().unwrap_or_default();
        if left_count >= MAX_SIMILAR_PAIRS_PER_NOTE || right_count >= MAX_SIMILAR_PAIRS_PER_NOTE {
            continue;
        }
        kept_per_note.insert(left, left_count + 1);
        kept_per_note.insert(right, right_count + 1);
        pairs.insert((paths[left].clone(), paths[right].clone()));
    }
    pairs.into_iter().collect()
}

pub fn signature(terms: impl IntoIterator<Item = u64>) -> Vec<u64> {
    let mut signature = vec![u64::MAX; SIGNATURE_LENGTH];
    for term in terms {
        for (index, slot) in signature.iter_mut().enumerate() {
            let value = mix(term ^ (index as u64 + 1).wrapping_mul(HASH_MULTIPLIER));
            if value < *slot {
                *slot = value;
            }
        }
    }
    signature
}

pub fn estimated_similarity(left: &[u64], right: &[u64]) -> f32 {
    let matches = left
        .iter()
        .zip(right)
        .filter(|(left, right)| left == right)
        .count();
    matches as f32 / left.len().max(1) as f32
}

fn jaccard(left: &BTreeSet<u64>, right: &BTreeSet<u64>) -> f32 {
    if left.is_empty() && right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count();
    let union = left.len() + right.len() - intersection;
    intersection as f32 / union.max(1) as f32
}

fn band_key(band: usize, rows: &[u64]) -> u64 {
    let mut key = (band as u64).wrapping_mul(HASH_MULTIPLIER);
    for row in rows {
        key = mix(key ^ *row);
    }
    key
}

fn hash_term(bytes: &[u8]) -> u64 {
    let mut hash = FNV_OFFSET;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    mix(hash)
}

fn mix(mut value: u64) -> u64 {
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::{
        estimated_similarity, hash_term, signature, similar_pairs, LSH_BANDS, LSH_ROWS,
        SIGNATURE_LENGTH,
    };
    use std::collections::{BTreeMap, BTreeSet};

    fn terms(words: &[&str]) -> BTreeSet<u64> {
        words
            .iter()
            .map(|word| hash_term(word.as_bytes()))
            .collect()
    }

    fn corpus() -> BTreeMap<String, BTreeSet<u64>> {
        BTreeMap::from([
            (
                "a.md".to_owned(),
                terms(&["graph", "similarity", "minhash", "bands", "rows", "notes"]),
            ),
            (
                "b.md".to_owned(),
                terms(&["graph", "similarity", "minhash", "bands", "rows"]),
            ),
            (
                "c.md".to_owned(),
                terms(&["recipe", "flour", "sugar", "oven", "dough", "baking"]),
            ),
        ])
    }

    #[test]
    fn banding_constants_cover_the_signature() {
        assert_eq!(LSH_BANDS * LSH_ROWS, SIGNATURE_LENGTH);
    }

    #[test]
    fn signatures_do_not_depend_on_term_order() {
        let forward = signature(terms(&["alpha", "beta", "gamma"]).into_iter());
        let shuffled = signature(terms(&["gamma", "alpha", "beta"]).into_iter());

        assert_eq!(forward, shuffled);
        assert_eq!(forward.len(), SIGNATURE_LENGTH);
        assert_eq!(estimated_similarity(&forward, &shuffled), 1.0);
    }

    #[test]
    fn bands_join_notes_that_share_most_terms() {
        let pairs = similar_pairs(&corpus());

        assert_eq!(pairs, vec![("a.md".to_owned(), "b.md".to_owned())]);
    }

    #[test]
    fn unrelated_notes_stay_unlinked() {
        let mut isolated = corpus();
        isolated.insert(
            "d.md".to_owned(),
            terms(&["painting", "canvas", "brush", "pigment"]),
        );

        assert!(!similar_pairs(&isolated)
            .iter()
            .any(|(left, right)| (left == "c.md" || right == "c.md")
                || (left == "d.md" || right == "d.md")));
    }

    #[test]
    fn empty_notes_never_match_each_other() {
        let empty = BTreeMap::from([
            ("a.md".to_owned(), BTreeSet::new()),
            ("b.md".to_owned(), BTreeSet::new()),
        ]);

        assert!(similar_pairs(&empty).is_empty());
    }

    #[test]
    fn signature_similarity_tracks_jaccard() {
        let left = terms(&["alpha", "beta", "gamma", "delta"]);
        let right = terms(&["alpha", "beta", "gamma"]);

        let estimate = estimated_similarity(
            &signature(left.iter().copied()),
            &signature(right.iter().copied()),
        );
        assert!((0.5..=1.0).contains(&estimate));
    }
}
