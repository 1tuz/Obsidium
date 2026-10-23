use super::models::AnalysisResult;
use crate::search::error::SearchError;
use crate::search::paths::identity;
use crate::search::wiki;
use crate::search::wiki::target::{pick_candidate, target_key};
use rusqlite::Connection;
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

pub struct GraphSnapshot {
    neighbours: HashMap<String, HashSet<String>>,
    outgoing: HashMap<String, HashSet<String>>,
    paths: HashMap<String, String>,
    links: HashMap<(String, String), BTreeSet<&'static str>>,
}

struct CandidateScore {
    raw_score: f64,
    common_neighbours: HashSet<String>,
}

impl GraphSnapshot {
    pub fn load(connection: &Connection, root: &Path) -> Result<Self, SearchError> {
        let documents = wiki::read_documents(connection)?;
        let mut neighbours = HashMap::<String, HashSet<String>>::new();
        let mut outgoing = HashMap::<String, HashSet<String>>::new();
        let mut paths = HashMap::<String, String>::new();
        let mut links = HashMap::<(String, String), BTreeSet<&'static str>>::new();
        wiki::for_each_typed_link(
            connection,
            root,
            documents.iter().map(|document| {
                (
                    document.path.as_str(),
                    document.relative_key.as_str(),
                    document.title_key.as_str(),
                )
            }),
            |source, target, link_type| {
                let source_path = source;
                let target_path = target;
                let source = identity(Path::new(source_path));
                let target = identity(Path::new(target_path));
                if source == target {
                    return;
                }
                paths
                    .entry(source.clone())
                    .or_insert_with(|| source_path.to_owned());
                paths
                    .entry(target.clone())
                    .or_insert_with(|| target_path.to_owned());
                neighbours
                    .entry(source.clone())
                    .or_default()
                    .insert(target.clone());
                neighbours
                    .entry(target.clone())
                    .or_default()
                    .insert(source.clone());
                let label = if link_type == "markdown" {
                    "markdown"
                } else {
                    "wiki"
                };
                links
                    .entry((source.clone(), target.clone()))
                    .or_default()
                    .insert(label);
                outgoing.entry(source).or_default().insert(target);
            },
        )?;
        append_structural(connection, root, &documents, &mut links, &mut paths)?;
        Ok(Self {
            neighbours,
            outgoing,
            paths,
            links,
        })
    }

    pub fn incoming_counts(&self, documents: &[PathBuf]) -> Vec<usize> {
        let mut counts = HashMap::<&str, usize>::new();
        for targets in self.outgoing.values() {
            for target in targets {
                *counts.entry(target.as_str()).or_default() += 1;
            }
        }
        documents
            .iter()
            .map(|document| {
                counts
                    .get(identity(document).as_str())
                    .copied()
                    .unwrap_or(0)
            })
            .collect()
    }

    pub fn links_to(&self, source: &Path, target: &Path) -> bool {
        let target = identity(target);
        self.outgoing
            .get(&identity(source))
            .is_some_and(|targets| targets.contains(&target))
    }

    pub fn path_of(&self, identity: &str) -> Option<&str> {
        self.paths.get(identity).map(String::as_str)
    }

    pub fn labels_between(&self, left: &Path, right: &Path) -> Vec<&'static str> {
        let left = identity(left);
        let right = identity(right);
        let mut labels = Vec::new();
        if let Some(found) = self.links.get(&(left.clone(), right.clone())) {
            labels.extend(found.iter().copied());
        }
        if let Some(found) = self.links.get(&(right, left)) {
            labels.extend(found.iter().copied());
        }
        labels.sort_unstable();
        labels.dedup();
        labels
    }

    pub(crate) fn edges(&self) -> impl Iterator<Item = (&str, &str, &BTreeSet<&'static str>)> + '_ {
        self.links
            .iter()
            .map(|((source, target), labels)| (source.as_str(), target.as_str(), labels))
    }

    pub fn adamic_adar(&self, document: &Path, limit: usize) -> Vec<AnalysisResult> {
        let current = identity(document);
        let Some(current_neighbours) = self.neighbours.get(&current) else {
            return Vec::new();
        };
        let mut shared = HashMap::<String, CandidateScore>::new();
        for neighbour in current_neighbours {
            let weight = self.neighbour_weight(neighbour);
            if weight == 0.0 {
                continue;
            }
            if let Some(candidates) = self.neighbours.get(neighbour) {
                for candidate in candidates {
                    if candidate != &current && !current_neighbours.contains(candidate) {
                        let entry =
                            shared
                                .entry(candidate.clone())
                                .or_insert_with(|| CandidateScore {
                                    raw_score: 0.0,
                                    common_neighbours: HashSet::new(),
                                });
                        entry.raw_score += weight;
                        entry.common_neighbours.insert(neighbour.clone());
                    }
                }
            }
        }
        self.rank(shared, limit)
    }

    fn neighbour_weight(&self, neighbour: &str) -> f64 {
        let out_degree = self.outgoing.get(neighbour).map_or(0, HashSet::len);
        if out_degree == 0 {
            return 0.0;
        }
        1.0 / (out_degree.max(2) as f64).ln()
    }

    fn rank(&self, values: HashMap<String, CandidateScore>, limit: usize) -> Vec<AnalysisResult> {
        let mut results = values
            .into_iter()
            .filter(|(_, candidate)| candidate.raw_score > 0.0)
            .filter_map(|(identity, candidate)| {
                let path = self.paths.get(&identity)?.clone();
                let mut reasons = candidate
                    .common_neighbours
                    .into_iter()
                    .filter_map(|identity| self.paths.get(&identity))
                    .map(|path| title(path))
                    .collect::<Vec<_>>();
                reasons.sort();
                Some(AnalysisResult {
                    title: title(&path),
                    path,
                    raw_score: candidate.raw_score,
                    similarity: None,
                    confidence: None,
                    reasons,
                })
            })
            .collect::<Vec<_>>();
        results.sort_by(|left, right| {
            right
                .raw_score
                .partial_cmp(&left.raw_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.reasons.len().cmp(&left.reasons.len()))
                .then_with(|| left.title.cmp(&right.title))
        });
        results.truncate(limit);
        results
    }
}

fn append_structural(
    connection: &Connection,
    root: &Path,
    documents: &[wiki::edges::WikiDocument],
    links: &mut HashMap<(String, String), BTreeSet<&'static str>>,
    paths: &mut HashMap<String, String>,
) -> Result<(), SearchError> {
    let mut by_title = HashMap::<&str, Vec<&str>>::new();
    let mut by_relative = HashMap::<&str, Vec<&str>>::new();
    for document in documents {
        by_title
            .entry(&document.title_key)
            .or_default()
            .push(&document.path);
        by_relative
            .entry(&document.relative_key)
            .or_default()
            .push(&document.path);
    }
    let mut statement = connection.prepare(
        "SELECT path, key_lower, text, items FROM note_fields
         WHERE key_lower IN ('parent', 'related', 'depends_on', 'blocks')
         ORDER BY path, ordinal",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (source, field, text, items) = row?;
        let Some(label) = structural_label(&field) else {
            continue;
        };
        let values = items
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| vec![text]);
        for value in values {
            let clean = structural_target(&value);
            if clean.is_empty() || clean.eq_ignore_ascii_case("null") {
                continue;
            }
            let (key, kind) = target_key(&clean);
            let candidates = if kind == "path" {
                by_relative.get(key.as_str())
            } else {
                by_title.get(key.as_str())
            };
            let Some(target) =
                candidates.and_then(|paths| pick_candidate(root, Path::new(&source), paths))
            else {
                continue;
            };
            let source_identity = identity(Path::new(&source));
            let target_identity = identity(Path::new(target));
            if source_identity == target_identity {
                continue;
            }
            paths
                .entry(source_identity.clone())
                .or_insert_with(|| source.clone());
            paths
                .entry(target_identity.clone())
                .or_insert_with(|| target.to_owned());
            links
                .entry((source_identity.clone(), target_identity.clone()))
                .or_default()
                .insert(label);
            if label == "related" {
                links
                    .entry((target_identity, source_identity))
                    .or_default()
                    .insert(label);
            }
        }
    }
    Ok(())
}

fn structural_label(field: &str) -> Option<&'static str> {
    match field {
        "parent" => Some("parent"),
        "related" => Some("related"),
        "depends_on" => Some("depends_on"),
        "blocks" => Some("blocks"),
        _ => None,
    }
}

fn structural_target(value: &str) -> String {
    let value = value.trim();
    let value = if value.starts_with("[[") && value.ends_with("]]") {
        &value[2..value.len() - 2]
    } else {
        value
            .strip_prefix('[')
            .and_then(|target| target.strip_suffix(']'))
            .unwrap_or(value)
    };
    value
        .split('|')
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn title(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{identity, GraphSnapshot};
    use std::collections::{HashMap, HashSet};
    use std::path::Path;

    fn node(name: &str) -> String {
        identity(Path::new(&format!("C:/vault/{name}.md")))
    }

    #[test]
    fn returns_candidates_and_their_common_neighbours() {
        let mut neighbours = HashMap::<String, HashSet<String>>::new();
        let mut connect = |left: &str, right: &str| {
            neighbours
                .entry(node(left))
                .or_default()
                .insert(node(right));
            neighbours
                .entry(node(right))
                .or_default()
                .insert(node(left));
        };

        connect("A", "X");
        connect("A", "Y");
        connect("X", "C");
        connect("Y", "C");
        connect("X", "B");

        let paths = ["A", "B", "C", "X", "Y"]
            .into_iter()
            .map(|name| (node(name), format!("C:/vault/{name}.md")))
            .collect();
        let outgoing = HashMap::from([
            (node("X"), HashSet::from([node("A"), node("B"), node("C")])),
            (node("Y"), HashSet::from([node("A"), node("C")])),
        ]);
        let graph = GraphSnapshot {
            neighbours,
            outgoing,
            paths,
            links: HashMap::new(),
        };

        let results = graph.adamic_adar(Path::new("C:/vault/A.md"), 10);

        let result = results.iter().find(|result| result.title == "C").unwrap();
        assert_eq!(result.reasons, vec!["X".to_owned(), "Y".to_owned()]);
        let expected = 1.0 / 3_f64.ln() + 1.0 / 2_f64.ln();
        assert!((result.raw_score - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn excludes_notes_already_directly_connected_to_the_query() {
        let a = node("A");
        let b = node("B");
        let x = node("X");
        let neighbours = HashMap::from([
            (a.clone(), HashSet::from([b.clone(), x.clone()])),
            (b.clone(), HashSet::from([a.clone(), x.clone()])),
            (x.clone(), HashSet::from([a.clone(), b.clone()])),
        ]);
        let outgoing = HashMap::from([
            (a.clone(), HashSet::from([b.clone(), x.clone()])),
            (x.clone(), HashSet::from([b.clone()])),
        ]);
        let paths = ["A", "B", "X"]
            .into_iter()
            .map(|name| (node(name), format!("C:/vault/{name}.md")))
            .collect();
        let graph = GraphSnapshot {
            neighbours,
            outgoing,
            paths,
            links: HashMap::new(),
        };

        let results = graph.adamic_adar(Path::new("C:/vault/A.md"), 10);

        assert!(results.iter().all(|result| result.title != "B"));
    }

    #[test]
    fn keeps_candidates_sharing_a_neighbour_with_a_single_outgoing_link() {
        let a = node("A");
        let b = node("B");
        let x = node("X");
        let neighbours = HashMap::from([
            (a.clone(), HashSet::from([x.clone()])),
            (b.clone(), HashSet::from([x.clone()])),
            (x.clone(), HashSet::from([a.clone(), b.clone()])),
        ]);
        let outgoing = HashMap::from([(x, HashSet::from([b.clone()]))]);
        let paths = ["A", "B", "X"]
            .into_iter()
            .map(|name| (node(name), format!("C:/vault/{name}.md")))
            .collect();
        let graph = GraphSnapshot {
            neighbours,
            outgoing,
            paths,
            links: HashMap::new(),
        };

        let result = graph
            .adamic_adar(Path::new("C:/vault/A.md"), 10)
            .into_iter()
            .find(|result| result.title == "B")
            .expect("candidate behind a single-link neighbour must survive ranking");

        assert!((result.raw_score - 1.0 / 2_f64.ln()).abs() < f64::EPSILON);
    }

    #[test]
    fn weights_common_neighbours_by_outgoing_links_like_obsidian_graph_analysis() {
        let a = node("A");
        let b = node("B");
        let x = node("X");
        let y = node("Y");
        let z = node("Z");
        let neighbours = HashMap::from([
            (a.clone(), HashSet::from([x.clone()])),
            (b.clone(), HashSet::from([x.clone()])),
            (
                x.clone(),
                HashSet::from([a.clone(), b.clone(), y.clone(), z.clone()]),
            ),
        ]);
        let outgoing = HashMap::from([(x, HashSet::from([node("A"), node("B")]))]);
        let paths = ["A", "B", "X", "Y", "Z"]
            .into_iter()
            .map(|name| (node(name), format!("C:/vault/{name}.md")))
            .collect();
        let graph = GraphSnapshot {
            neighbours,
            outgoing,
            paths,
            links: HashMap::new(),
        };

        let result = graph
            .adamic_adar(Path::new("C:/vault/A.md"), 10)
            .into_iter()
            .find(|result| result.title == "B")
            .unwrap();

        assert!((result.raw_score - 1.0 / 2_f64.ln()).abs() < f64::EPSILON);
    }

    #[test]
    fn counts_distinct_notes_linking_to_each_document() {
        let outgoing = HashMap::from([
            (node("X"), HashSet::from([node("A"), node("B")])),
            (node("Y"), HashSet::from([node("A")])),
        ]);
        let graph = GraphSnapshot {
            neighbours: HashMap::new(),
            outgoing,
            paths: HashMap::new(),
            links: HashMap::new(),
        };
        let documents =
            ["A", "B", "X"].map(|name| std::path::PathBuf::from(format!("C:/vault/{name}.md")));
        assert_eq!(graph.incoming_counts(&documents), vec![2, 1, 0]);
    }

    #[test]
    fn reports_a_direct_link_between_two_documents() {
        let outgoing = HashMap::from([(node("X"), HashSet::from([node("A")]))]);
        let graph = GraphSnapshot {
            neighbours: HashMap::new(),
            outgoing,
            paths: HashMap::new(),
            links: HashMap::new(),
        };

        assert!(graph.links_to(Path::new("C:/vault/X.md"), Path::new("C:/vault/A.md")));
        assert!(!graph.links_to(Path::new("C:/vault/A.md"), Path::new("C:/vault/X.md")));
    }
}
