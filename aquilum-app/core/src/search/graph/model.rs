use super::timeline::{NoteChange, NoteState, TimelineChangeBatch};
use crate::search::wiki::target::{pick_candidate, target_key};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

type TargetKey = (String, String);
type EdgePair = (String, String);
type EdgeContributionKey = (bool, u32);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedEdge {
    pub target: String,
    pub link_type: u32,
    pub reverse: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DirectedEdge {
    pub source: String,
    pub target: String,
    pub link_type: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphEdgePairUpdate {
    pub left: String,
    pub right: String,
    pub direction_mask: u32,
    pub type_mask: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GraphModelDiff {
    pub changed_notes: Vec<String>,
    pub removed_notes: Vec<String>,
    pub added_edges: Vec<DirectedEdge>,
    pub removed_edges: Vec<DirectedEdge>,
    pub changed_pairs: Vec<GraphEdgePairUpdate>,
    pub processed_sources: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphModel {
    pub root: PathBuf,
    pub notes: BTreeMap<String, NoteState>,
    contributions_by_source: BTreeMap<String, Vec<ResolvedEdge>>,
    by_title: HashMap<String, BTreeSet<String>>,
    by_relative: HashMap<String, BTreeSet<String>>,
    sources_by_target: HashMap<TargetKey, HashSet<String>>,
    edge_contributions_by_pair: BTreeMap<EdgePair, BTreeMap<EdgeContributionKey, usize>>,
}

impl GraphModel {
    pub fn from_notes(root: &Path, notes: Vec<NoteState>) -> Self {
        let mut model = Self {
            root: root.to_path_buf(),
            notes: BTreeMap::new(),
            contributions_by_source: BTreeMap::new(),
            by_title: HashMap::new(),
            by_relative: HashMap::new(),
            sources_by_target: HashMap::new(),
            edge_contributions_by_pair: BTreeMap::new(),
        };
        for note in notes {
            model.insert_note(note);
        }
        let paths = model.notes.keys().cloned().collect::<Vec<_>>();
        for path in paths {
            model.resolve_source(&path);
        }
        model
    }

    pub fn apply_batch(&mut self, batch: &TimelineChangeBatch) -> GraphModelDiff {
        let date_only = batch
            .changes
            .iter()
            .filter_map(|change| {
                let previous = self.notes.get(&change.path)?;
                let updated = change.state.as_ref()?;
                modified_date_only(previous, updated).then(|| change.path.clone())
            })
            .collect::<HashSet<_>>();
        let original_notes = batch
            .changes
            .iter()
            .map(|change| (change.path.clone(), self.notes.get(&change.path).cloned()))
            .collect::<BTreeMap<_, _>>();
        let mut affected = HashSet::new();
        for NoteChange { path, state } in &batch.changes {
            if date_only.contains(path) {
                continue;
            }
            affected.insert(path.clone());
            if let Some(note) = self.notes.get(path) {
                self.collect_dependents(&note.title_key, "name", &mut affected);
                self.collect_dependents(&note.relative_key, "path", &mut affected);
            }
            if let Some(note) = state {
                self.collect_dependents(&note.title_key, "name", &mut affected);
                self.collect_dependents(&note.relative_key, "path", &mut affected);
            }
        }
        for change in &batch.changes {
            if date_only.contains(&change.path) {
                if let Some(note) = self.notes.get_mut(&change.path) {
                    note.modified_ns = change.state.as_ref().unwrap().modified_ns;
                }
                continue;
            }
            self.remove_note(&change.path);
        }
        for change in &batch.changes {
            if !date_only.contains(&change.path) {
                if let Some(note) = &change.state {
                    self.insert_note(note.clone());
                }
            }
        }
        let mut affected = affected.into_iter().collect::<Vec<_>>();
        affected.sort_unstable();
        let mut previous_pair_masks = BTreeMap::new();
        for path in &affected {
            if let Some(edges) = self.contributions_by_source.get(path) {
                for edge in edges {
                    let directed = directed_edge(path, edge);
                    let pair = edge_pair_key(&directed.source, &directed.target);
                    previous_pair_masks
                        .entry(pair.clone())
                        .or_insert_with(|| self.edge_pair_masks(&pair));
                }
            }
        }
        let previous_edges = affected
            .iter()
            .flat_map(|path| {
                self.contributions_by_source
                    .get(path)
                    .into_iter()
                    .flatten()
                    .map(|edge| directed_edge(path, edge))
            })
            .collect::<BTreeSet<_>>();
        for path in &affected {
            self.remove_contributions(path);
        }
        for path in &affected {
            self.resolve_source(path);
        }
        for path in &affected {
            if let Some(edges) = self.contributions_by_source.get(path) {
                for edge in edges {
                    let directed = directed_edge(path, edge);
                    let pair = edge_pair_key(&directed.source, &directed.target);
                    previous_pair_masks.entry(pair.clone()).or_insert((0, 0));
                }
            }
        }
        let updated_edges = affected
            .iter()
            .flat_map(|path| {
                self.contributions_by_source
                    .get(path)
                    .into_iter()
                    .flatten()
                    .map(|edge| directed_edge(path, edge))
            })
            .collect::<BTreeSet<_>>();
        let mut diff = GraphModelDiff {
            processed_sources: affected
                .iter()
                .filter(|path| self.notes.contains_key(*path))
                .count(),
            removed_edges: previous_edges.difference(&updated_edges).cloned().collect(),
            added_edges: updated_edges.difference(&previous_edges).cloned().collect(),
            changed_pairs: previous_pair_masks
                .into_iter()
                .filter_map(|((left, right), previous)| {
                    let current = self.edge_pair_masks(&(left.clone(), right.clone()));
                    (previous != current).then_some(GraphEdgePairUpdate {
                        left,
                        right,
                        direction_mask: current.0,
                        type_mask: current.1,
                    })
                })
                .collect(),
            ..GraphModelDiff::default()
        };
        for (path, original) in original_notes {
            match (original, self.notes.get(&path)) {
                (Some(_), None) => diff.removed_notes.push(path),
                (None, Some(_)) => diff.changed_notes.push(path),
                (Some(original), Some(updated)) if original != *updated => {
                    diff.changed_notes.push(path)
                }
                _ => {}
            }
        }
        diff
    }

    pub fn for_each_directed_edge(&self, mut visit: impl FnMut(&str, &str, u32)) {
        for (source, edges) in &self.contributions_by_source {
            for edge in edges {
                if edge.reverse {
                    visit(&edge.target, source, edge.link_type);
                } else {
                    visit(source, &edge.target, edge.link_type);
                }
            }
        }
    }

    #[cfg(test)]
    fn directed_edges(&self) -> Vec<(String, String, u32)> {
        let mut edges = Vec::new();
        self.for_each_directed_edge(|source, target, link_type| {
            edges.push((source.to_owned(), target.to_owned(), link_type));
        });
        edges
    }

    fn insert_note(&mut self, note: NoteState) {
        let path = note.path.clone();
        self.by_title
            .entry(note.title_key.clone())
            .or_default()
            .insert(path.clone());
        self.by_relative
            .entry(note.relative_key.clone())
            .or_default()
            .insert(path.clone());
        for (kind, key) in target_keys(&note) {
            self.sources_by_target
                .entry((kind, key))
                .or_default()
                .insert(path.clone());
        }
        self.notes.insert(path, note);
    }

    fn remove_note(&mut self, path: &str) {
        let Some(note) = self.notes.remove(path) else {
            return;
        };
        remove_candidate(&mut self.by_title, &note.title_key, path);
        remove_candidate(&mut self.by_relative, &note.relative_key, path);
        for (kind, key) in target_keys(&note) {
            remove_source(&mut self.sources_by_target, &(kind, key), path);
        }
    }

    fn collect_dependents(&self, key: &str, kind: &str, affected: &mut HashSet<String>) {
        if let Some(sources) = self
            .sources_by_target
            .get(&(kind.to_owned(), key.to_owned()))
        {
            affected.extend(sources.iter().cloned());
        }
    }

    fn resolve_source(&mut self, path: &str) {
        let Some(note) = self.notes.get(path) else {
            return;
        };
        let mut contributions = Vec::new();
        for link in &note.links {
            let Some(target) = self.pick_target(path, &link.target_kind, &link.target_key) else {
                continue;
            };
            let link_type = if link.link_type == "markdown" { 2 } else { 1 };
            contributions.push(ResolvedEdge {
                target,
                link_type,
                reverse: false,
            });
        }
        for link in &note.structural_links {
            let clean = clean_structural_target(&link.target);
            if clean.is_empty() || clean.eq_ignore_ascii_case("null") {
                continue;
            }
            let (key, kind) = target_key(&clean);
            let Some(target) = self.pick_target(path, kind, &key) else {
                continue;
            };
            let link_type = structural_type_mask(&link.field);
            contributions.push(ResolvedEdge {
                target: target.clone(),
                link_type,
                reverse: false,
            });
            if link.field == "related" {
                contributions.push(ResolvedEdge {
                    target,
                    link_type,
                    reverse: true,
                });
            }
        }
        for edge in &contributions {
            let directed = directed_edge(path, edge);
            self.add_edge_contribution(&directed.source, &directed.target, directed.link_type);
        }
        self.contributions_by_source
            .insert(path.to_owned(), contributions);
    }

    fn remove_contributions(&mut self, owner: &str) {
        if let Some(contributions) = self.contributions_by_source.remove(owner) {
            for edge in contributions {
                let directed = directed_edge(owner, &edge);
                self.remove_edge_contribution(
                    &directed.source,
                    &directed.target,
                    directed.link_type,
                );
            }
        }
    }

    fn edge_pair_masks(&self, pair: &EdgePair) -> (u32, u32) {
        let Some(contributions) = self.edge_contributions_by_pair.get(pair) else {
            return (0, 0);
        };
        contributions
            .iter()
            .fold((0, 0), |mut masks, ((forward, link_type), count)| {
                if *count > 0 {
                    masks.0 |= if *forward {
                        *link_type
                    } else {
                        *link_type << 6
                    };
                    masks.1 |= *link_type;
                }
                masks
            })
    }

    fn add_edge_contribution(&mut self, source: &str, target: &str, link_type: u32) {
        let pair = edge_pair_key(source, target);
        let key = (source < target, link_type);
        *self
            .edge_contributions_by_pair
            .entry(pair)
            .or_default()
            .entry(key)
            .or_default() += 1;
    }

    fn remove_edge_contribution(&mut self, source: &str, target: &str, link_type: u32) {
        let pair = edge_pair_key(source, target);
        let key = (source < target, link_type);
        let Some(contributions) = self.edge_contributions_by_pair.get_mut(&pair) else {
            return;
        };
        if let Some(count) = contributions.get_mut(&key) {
            *count -= 1;
            if *count == 0 {
                contributions.remove(&key);
            }
        }
        if contributions.is_empty() {
            self.edge_contributions_by_pair.remove(&pair);
        }
    }

    fn pick_target(&self, source: &str, kind: &str, key: &str) -> Option<String> {
        let candidates = if kind == "path" {
            self.by_relative.get(key)
        } else {
            self.by_title.get(key)
        }?;
        let candidates = candidates.iter().map(String::as_str).collect::<Vec<_>>();
        pick_candidate(&self.root, Path::new(source), &candidates).map(str::to_owned)
    }
}

fn edge_pair_key(source: &str, target: &str) -> EdgePair {
    if source <= target {
        (source.to_owned(), target.to_owned())
    } else {
        (target.to_owned(), source.to_owned())
    }
}

pub(crate) fn modified_date_only(previous: &NoteState, updated: &NoteState) -> bool {
    previous.path == updated.path
        && previous.relative_key == updated.relative_key
        && previous.title_key == updated.title_key
        && previous.created_ns == updated.created_ns
        && previous.modified_ns <= updated.modified_ns
        && previous.links == updated.links
        && previous.structural_links == updated.structural_links
}

fn directed_edge(owner: &str, edge: &ResolvedEdge) -> DirectedEdge {
    if edge.reverse {
        DirectedEdge {
            source: edge.target.clone(),
            target: owner.to_owned(),
            link_type: edge.link_type,
        }
    } else {
        DirectedEdge {
            source: owner.to_owned(),
            target: edge.target.clone(),
            link_type: edge.link_type,
        }
    }
}

fn target_keys(note: &NoteState) -> HashSet<(String, String)> {
    note.links
        .iter()
        .map(|link| (link.target_kind.clone(), link.target_key.clone()))
        .chain(note.structural_links.iter().filter_map(|link| {
            let clean = clean_structural_target(&link.target);
            (!clean.is_empty() && !clean.eq_ignore_ascii_case("null"))
                .then(|| target_key(&clean))
                .map(|(key, kind)| (kind.to_owned(), key))
        }))
        .collect()
}

fn remove_candidate(index: &mut HashMap<String, BTreeSet<String>>, key: &str, path: &str) {
    if let Some(paths) = index.get_mut(key) {
        paths.remove(path);
        if paths.is_empty() {
            index.remove(key);
        }
    }
}

fn remove_source(index: &mut HashMap<TargetKey, HashSet<String>>, key: &TargetKey, path: &str) {
    if let Some(paths) = index.get_mut(key) {
        paths.remove(path);
        if paths.is_empty() {
            index.remove(key);
        }
    }
}

fn clean_structural_target(value: &str) -> String {
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

fn structural_type_mask(field: &str) -> u32 {
    match field {
        "parent" => 4,
        "related" => 8,
        "depends_on" => 16,
        "blocks" => 32,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::GraphModel;
    use crate::search::graph::timeline::{
        LinkState, NoteChange, NoteState, StructuralLinkState, TimelineChangeBatch,
    };
    use std::path::Path;

    fn note(path: &str, title: &str, links: Vec<LinkState>) -> NoteState {
        NoteState {
            path: path.to_owned(),
            relative_key: path
                .trim_start_matches("/vault/")
                .trim_end_matches(".md")
                .to_lowercase(),
            title_key: title.to_lowercase(),
            created_ns: 1,
            modified_ns: 1,
            links,
            structural_links: Vec::new(),
        }
    }

    fn link(key: &str) -> LinkState {
        LinkState {
            target_key: key.to_owned(),
            target_kind: "name".to_owned(),
            link_type: "wiki".to_owned(),
        }
    }

    #[test]
    fn adding_or_renaming_a_target_only_reprocesses_dependent_sources() {
        let root = Path::new("/vault");
        let source = note("/vault/Folder/Source.md", "Source", vec![link("target")]);
        let unrelated = note("/vault/Else.md", "Else", Vec::new());
        let mut model = GraphModel::from_notes(root, vec![source.clone(), unrelated]);
        let target = note("/vault/Target.md", "Target", Vec::new());

        let diff = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: target.path.clone(),
                state: Some(target.clone()),
            }],
        });

        assert_eq!(diff.processed_sources, 2);
        assert_eq!(diff.changed_notes, vec![target.path.clone()]);
        assert_eq!(diff.removed_notes, Vec::<String>::new());
        assert_eq!(
            diff.added_edges,
            vec![directed(source.path, target.path.clone(), 1)]
        );
        assert!(diff.removed_edges.is_empty());
        assert_eq!(target_for(&model, "/vault/Folder/Source.md"), target.path);
        assert_eq!(model.directed_edges().len(), 1);
    }

    #[test]
    fn structural_related_edges_are_symmetric_and_keep_their_type() {
        let root = Path::new("/vault");
        let mut source = note("/vault/Source.md", "Source", Vec::new());
        source.structural_links.push(StructuralLinkState {
            field: "related".to_owned(),
            target: "Target".to_owned(),
        });
        let target = note("/vault/Target.md", "Target", Vec::new());
        let model = GraphModel::from_notes(root, vec![source, target]);

        let edges = model.directed_edges();
        assert!(edges.contains(&(
            "/vault/Source.md".to_owned(),
            "/vault/Target.md".to_owned(),
            8
        )));
        assert!(edges.contains(&(
            "/vault/Target.md".to_owned(),
            "/vault/Source.md".to_owned(),
            8
        )));
    }

    #[test]
    fn delta_batches_match_a_full_model_after_add_delete_rename_and_ambiguity() {
        let root = Path::new("/vault");
        let source_path = "/vault/Folder/Source.md";
        let source = note(source_path, "Source", vec![link("target")]);
        let mut model = GraphModel::from_notes(root, vec![source.clone()]);
        let target = note("/vault/Target.md", "Target", Vec::new());
        apply_and_compare(
            &mut model,
            vec![NoteChange {
                path: target.path.clone(),
                state: Some(target.clone()),
            }],
        );

        let nearer = note("/vault/Folder/Target.md", "Target", Vec::new());
        apply_and_compare(
            &mut model,
            vec![NoteChange {
                path: nearer.path.clone(),
                state: Some(nearer.clone()),
            }],
        );
        assert_eq!(target_for(&model, source_path), nearer.path);

        let renamed = note("/vault/Renamed.md", "Target", Vec::new());
        apply_and_compare(
            &mut model,
            vec![
                NoteChange {
                    path: nearer.path,
                    state: None,
                },
                NoteChange {
                    path: renamed.path.clone(),
                    state: Some(renamed),
                },
            ],
        );
        assert_eq!(target_for(&model, source_path), "/vault/Renamed.md");

        apply_and_compare(
            &mut model,
            vec![NoteChange {
                path: target.path,
                state: None,
            }],
        );
    }

    #[test]
    fn typed_structural_change_matches_full_model_and_skips_unrelated_sources() {
        let root = Path::new("/vault");
        let mut source = note("/vault/Source.md", "Source", Vec::new());
        source.structural_links = vec![StructuralLinkState {
            field: "depends_on".to_owned(),
            target: "Target".to_owned(),
        }];
        let mut notes = vec![source.clone()];
        for index in 0..100 {
            notes.push(note(
                &format!("/vault/Unrelated{index}.md"),
                &format!("Unrelated{index}"),
                vec![link(&format!("missing{index}"))],
            ));
        }
        let mut model = GraphModel::from_notes(root, notes.clone());
        let target = note("/vault/Target.md", "Target", Vec::new());
        let processed = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: target.path.clone(),
                state: Some(target.clone()),
            }],
        });
        notes.push(target);
        assert!(processed.processed_sources <= 2);
        assert_eq!(model, GraphModel::from_notes(root, notes));
        assert!(model.directed_edges().contains(&(
            "/vault/Source.md".to_owned(),
            "/vault/Target.md".to_owned(),
            16
        )));

        let no_op = model.apply_batch(&TimelineChangeBatch {
            event_id: 2,
            changes: Vec::new(),
        });
        assert_eq!(no_op.processed_sources, 0);
        assert!(no_op.changed_notes.is_empty());
        assert!(no_op.removed_notes.is_empty());
        assert!(no_op.added_edges.is_empty());
        assert!(no_op.removed_edges.is_empty());
        assert_eq!(
            model,
            GraphModel::from_notes(root, model.notes.values().cloned().collect())
        );
    }

    #[test]
    fn modified_date_only_change_updates_metadata_without_resolving_contributions() {
        let root = Path::new("/vault");
        let source = note("/vault/Source.md", "Source", vec![link("target")]);
        let target = note("/vault/Target.md", "Target", Vec::new());
        let mut model = GraphModel::from_notes(root, vec![source, target]);
        let edges = model.directed_edges();
        let mut updated = model.notes["/vault/Source.md"].clone();
        updated.modified_ns = 42;

        let diff = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: updated.path.clone(),
                state: Some(updated.clone()),
            }],
        });

        assert_eq!(diff.changed_notes, vec![updated.path.clone()]);
        assert_eq!(diff.processed_sources, 0);
        assert!(diff.added_edges.is_empty());
        assert!(diff.removed_edges.is_empty());
        assert_eq!(model.notes[&updated.path].modified_ns, 42);
        assert_eq!(model.directed_edges(), edges);
    }

    #[test]
    fn deleting_or_renaming_a_target_reports_only_affected_edges() {
        let root = Path::new("/vault");
        let source_path = "/vault/Folder/Source.md";
        let source = note(source_path, "Source", vec![link("target")]);
        let target = note("/vault/Target.md", "Target", Vec::new());
        let mut model = GraphModel::from_notes(root, vec![source.clone(), target.clone()]);

        let renamed = note("/vault/Renamed.md", "Target", Vec::new());
        let rename = model.apply_batch(&TimelineChangeBatch {
            event_id: 3,
            changes: vec![
                NoteChange {
                    path: target.path.clone(),
                    state: None,
                },
                NoteChange {
                    path: renamed.path.clone(),
                    state: Some(renamed.clone()),
                },
            ],
        });

        assert_eq!(rename.removed_notes, vec![target.path.clone()]);
        assert_eq!(rename.changed_notes, vec![renamed.path.clone()]);
        assert_eq!(
            rename.removed_edges,
            vec![directed(source_path, target.path, 1)]
        );
        assert_eq!(
            rename.added_edges,
            vec![directed(source_path, renamed.path.clone(), 1)]
        );
        assert_eq!(rename.processed_sources, 2);

        let deletion = model.apply_batch(&TimelineChangeBatch {
            event_id: 4,
            changes: vec![NoteChange {
                path: renamed.path.clone(),
                state: None,
            }],
        });
        assert_eq!(deletion.removed_notes, vec![renamed.path.clone()]);
        assert_eq!(
            deletion.removed_edges,
            vec![directed(source_path, renamed.path, 1)]
        );
        assert!(deletion.added_edges.is_empty());
        assert_eq!(deletion.processed_sources, 1);
        assert_eq!(model, GraphModel::from_notes(root, vec![source]));
    }

    #[test]
    fn structural_related_diff_reports_both_directions_and_type() {
        let root = Path::new("/vault");
        let mut source = note("/vault/Source.md", "Source", Vec::new());
        source.structural_links.push(StructuralLinkState {
            field: "related".to_owned(),
            target: "Target".to_owned(),
        });
        let target = note("/vault/Target.md", "Target", Vec::new());
        let mut model = GraphModel::from_notes(root, vec![source.clone()]);

        let diff = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: target.path.clone(),
                state: Some(target.clone()),
            }],
        });

        assert_eq!(
            diff.added_edges,
            vec![
                directed(source.path.clone(), target.path.clone(), 8),
                directed(target.path.clone(), source.path.clone(), 8),
            ]
        );
        assert_eq!(diff.processed_sources, 2);
        assert_eq!(model, GraphModel::from_notes(root, vec![source, target]));
    }

    #[test]
    fn pair_delta_reports_aggregated_masks_and_tombstones_without_losing_shared_edges() {
        let root = Path::new("/vault");
        let mut source = note(
            "/vault/Source.md",
            "Source",
            vec![link("target"), link("target")],
        );
        let mut target = note("/vault/Target.md", "Target", vec![link("source")]);
        target.links[0].link_type = "markdown".to_owned();
        let mut model = GraphModel::from_notes(root, vec![source.clone(), target.clone()]);

        source.links.pop();
        let shared = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: source.path.clone(),
                state: Some(source.clone()),
            }],
        });

        assert!(shared.changed_pairs.is_empty());

        source.links.clear();
        let shared = model.apply_batch(&TimelineChangeBatch {
            event_id: 2,
            changes: vec![NoteChange {
                path: source.path.clone(),
                state: Some(source.clone()),
            }],
        });

        assert_eq!(
            shared.changed_pairs,
            vec![super::GraphEdgePairUpdate {
                left: "/vault/Source.md".to_owned(),
                right: "/vault/Target.md".to_owned(),
                direction_mask: 128,
                type_mask: 2,
            }]
        );

        target.links.clear();
        let removed = model.apply_batch(&TimelineChangeBatch {
            event_id: 3,
            changes: vec![NoteChange {
                path: target.path.clone(),
                state: Some(target),
            }],
        });

        assert_eq!(
            removed.changed_pairs,
            vec![super::GraphEdgePairUpdate {
                left: "/vault/Source.md".to_owned(),
                right: "/vault/Target.md".to_owned(),
                direction_mask: 0,
                type_mask: 0,
            }]
        );
    }

    #[test]
    fn removing_one_related_contribution_keeps_edges_contributed_by_the_other_note() {
        let root = Path::new("/vault");
        let mut source = note("/vault/Source.md", "Source", Vec::new());
        source.structural_links.push(StructuralLinkState {
            field: "related".to_owned(),
            target: "Target".to_owned(),
        });
        let mut target = note("/vault/Target.md", "Target", Vec::new());
        target.structural_links.push(StructuralLinkState {
            field: "related".to_owned(),
            target: "Source".to_owned(),
        });
        let mut model = GraphModel::from_notes(root, vec![source.clone(), target.clone()]);

        source.structural_links.clear();
        let diff = model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes: vec![NoteChange {
                path: "/vault/Source.md".to_owned(),
                state: Some(source),
            }],
        });

        assert!(diff.removed_edges.is_empty());
        assert_eq!(model.directed_edges().len(), 2);
        assert_eq!(
            model,
            GraphModel::from_notes(root, model.notes.values().cloned().collect())
        );
    }

    #[test]
    fn changing_link_type_reports_a_typed_edge_replacement() {
        let root = Path::new("/vault");
        let source = note("/vault/Source.md", "Source", vec![link("target")]);
        let target = note("/vault/Target.md", "Target", Vec::new());
        let mut model = GraphModel::from_notes(root, vec![source.clone(), target]);
        let mut markdown_source = source;
        markdown_source.links[0].link_type = "markdown".to_owned();

        let diff = model.apply_batch(&TimelineChangeBatch {
            event_id: 2,
            changes: vec![NoteChange {
                path: markdown_source.path.clone(),
                state: Some(markdown_source.clone()),
            }],
        });

        assert_eq!(diff.changed_notes, vec![markdown_source.path.clone()]);
        assert_eq!(
            diff.removed_edges,
            vec![directed("/vault/Source.md", "/vault/Target.md", 1)]
        );
        assert_eq!(
            diff.added_edges,
            vec![directed("/vault/Source.md", "/vault/Target.md", 2)]
        );
        assert_eq!(
            model,
            GraphModel::from_notes(
                root,
                vec![markdown_source, model.notes["/vault/Target.md"].clone()]
            )
        );
    }

    fn directed(
        source: impl Into<String>,
        target: impl Into<String>,
        link_type: u32,
    ) -> super::DirectedEdge {
        super::DirectedEdge {
            source: source.into(),
            target: target.into(),
            link_type,
        }
    }

    fn apply_and_compare(model: &mut GraphModel, changes: Vec<NoteChange>) {
        model.apply_batch(&TimelineChangeBatch {
            event_id: 1,
            changes,
        });
        let notes = model.notes.values().cloned().collect();
        assert_eq!(*model, GraphModel::from_notes(&model.root, notes));
    }

    fn target_for(model: &GraphModel, source: &str) -> String {
        model
            .directed_edges()
            .into_iter()
            .find_map(|(from, target, _)| (from == source).then_some(target))
            .unwrap()
    }
}
