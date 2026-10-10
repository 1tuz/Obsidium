use super::cluster::louvain;
use super::encode::encode;
use super::layout::Options;
use super::model::{modified_date_only, GraphModel, GraphModelDiff};
use super::snapshot::{paths_at, RenderSnapshot};
use super::timeline::{self, TimelineEvent, TimelineRange};
use crate::search::error::SearchError;
use crate::search::fields::{candidates, paths_with_tag};
use crate::search::models::SearchIndexState;
use crate::search::paths::{identity, same_workspace};
use crate::search::service::{CachedRenderGraph, SearchService};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

struct GraphSource {
    root: PathBuf,
    generation: u64,
    revision: u64,
    metadata_path: PathBuf,
}

#[derive(Default)]
pub struct GraphNodeFilter {
    pub folder: Option<String>,
    pub tag: Option<String>,
    pub property_key: Option<String>,
    pub property_value: Option<String>,
}

const MAX_POSITION_UPDATES: usize = 512;
const MAX_POSITION: f32 = 1_000_000.0;
const SNAPSHOT_HEADER_BYTES: usize = 16;
const MAX_DATE_DELTA_REVISIONS: usize = 64;
const MAX_DATE_DELTA_UPDATES: usize = 16_384;
const MAX_TOPOLOGY_DELTA_REVISIONS: usize = 64;
const MAX_TOPOLOGY_DELTA_UPDATES: usize = 16_384;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphModifiedDateDelta {
    pub base_epoch_low: u32,
    pub base_epoch_high: u32,
    pub revision: u64,
    pub modified_newest: f32,
    pub updates: Vec<GraphModifiedDateUpdate>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphModifiedDateUpdate {
    pub index: u32,
    pub modified_day: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphModifiedDateDeltaRevision {
    revision: u64,
    updates: Vec<GraphModifiedDateUpdate>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTopologyDelta {
    pub base_epoch_low: u32,
    pub base_epoch_high: u32,
    pub revision: u64,
    pub edge_slot_count: u32,
    pub edge_count: u32,
    pub metrics_stale: bool,
    pub node_updates: Vec<GraphTopologyNodeUpdate>,
    pub edge_updates: Vec<GraphTopologyEdgeUpdate>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTopologyNodeUpdate {
    pub index: u32,
    pub degree: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_day: Option<f32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTopologyEdgeUpdate {
    pub slot: u32,
    pub source: u32,
    pub target: u32,
    pub direction_mask: u32,
    pub type_mask: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphTopologyDeltaRevision {
    revision: u64,
    edge_updates: Vec<GraphTopologyEdgeUpdate>,
    node_updates: Vec<GraphTopologyNodeUpdate>,
    edge_count: u32,
}

fn layout_key(options: Options) -> String {
    format!(
        "{}:{:016x}:{:016x}",
        options.mode.as_str(),
        options.attraction.to_bits(),
        options.repulsion.to_bits()
    )
}

fn validate_layout_options(options: Options) -> Result<(), SearchError> {
    if !(0.5..=2.0).contains(&options.attraction) || !(0.5..=2.0).contains(&options.repulsion) {
        return Err(SearchError::InvalidWorkspace {
            message: "Силы раскладки должны быть от 0,5 до 2,0".to_owned(),
        });
    }
    Ok(())
}

impl SearchService {
    pub fn graph_timeline_range(&self, workspace: &str) -> Result<TimelineRange, SearchError> {
        let source = self.graph_source(workspace)?;
        let connection = Connection::open(&source.metadata_path)?;
        timeline::range(&connection)
    }

    pub fn graph_timeline_events(
        &self,
        workspace: &str,
        after: i64,
        limit: usize,
    ) -> Result<Vec<TimelineEvent>, SearchError> {
        let source = self.graph_source(workspace)?;
        let connection = Connection::open(&source.metadata_path)?;
        timeline::events(&connection, after, limit)
    }

    pub fn render_graph_at_event(
        &self,
        workspace: &str,
        event_id: i64,
        options: Options,
    ) -> Result<Arc<Vec<u8>>, SearchError> {
        validate_layout_options(options)?;
        let _building = self.render_lock.lock().map_err(SearchError::task)?;
        let source = self.graph_source(workspace)?;
        let connection = Connection::open(&source.metadata_path)?;
        let range = timeline::range(&connection)?;
        if event_id < range.baseline_event || event_id > range.latest_event {
            return Err(SearchError::InvalidWorkspace {
                message: "Событие графа вне доступного диапазона истории".to_owned(),
            });
        }
        let cached_positions = load_layout_coordinates(&connection, options)?;
        let snapshot = timeline::snapshot_at(
            &connection,
            &source.root,
            event_id,
            &cached_positions,
            options,
        )?;
        let epoch = self.next_render_epoch.fetch_add(1, Ordering::Relaxed) + 1;
        let bytes = Arc::new(encode(&snapshot, epoch));
        let newest = modified_newest(&snapshot.modified_days);
        let (edge_slots, edge_masks, edge_slot_indices, edge_count) = edge_slot_state(&snapshot);
        let degrees = snapshot.degrees.clone();
        let paths = Arc::new(snapshot.paths);
        let mut cache = self
            .historical_render_graph
            .write()
            .map_err(SearchError::task)?;
        *cache = Some(CachedRenderGraph {
            root: source.root,
            generation: source.generation,
            revision: source.revision,
            model_revision: source.revision,
            layout_key: format!("timeline:{event_id}:{}", layout_key(options)),
            epoch,
            paths,
            bytes: Arc::clone(&bytes),
            timeline_cursor: event_id,
            timeline_rescan_epoch: timeline::rescan_epoch(&connection)?,
            model: None,
            path_indices: HashMap::new(),
            modified_newest: newest,
            date_delta_floor_revision: source.revision,
            date_delta_journal: VecDeque::new(),
            edge_slots,
            edge_masks,
            edge_slot_indices,
            edge_count,
            degrees,
            topology_delta_floor_revision: source.revision,
            topology_delta_journal: VecDeque::new(),
            current: true,
            analysis_stale: false,
        });
        Ok(bytes)
    }

    pub fn render_graph(
        &self,
        workspace: &str,
        options: Options,
    ) -> Result<Arc<Vec<u8>>, SearchError> {
        validate_layout_options(options)?;
        let source = self.graph_source(workspace)?;
        let layout_key = layout_key(options);
        if let Some(ready) = self.cached_render_graph(&source, &layout_key)? {
            return Ok(ready);
        }
        let _building = self.render_lock.lock().map_err(SearchError::task)?;
        if let Some(ready) = self.cached_render_graph(&source, &layout_key)? {
            return Ok(ready);
        }
        let mut connection = Connection::open(&source.metadata_path)?;
        let cached_positions = load_layout_coordinates(&connection, options)?;
        let timeline_rescan_epoch = timeline::rescan_epoch(&connection)?;
        let mut cache = self.render_graph.write().map_err(SearchError::task)?;
        let reusable = cache.as_mut().filter(|cached| {
            cached.root == source.root
                && cached.generation == source.generation
                && cached.model.is_some()
        });
        let (snapshot, model, timeline_cursor) = if let Some(cached) = reusable {
            match if cached.timeline_rescan_epoch == timeline_rescan_epoch {
                timeline::changes_after(&connection, cached.timeline_cursor)?
            } else {
                None
            } {
                Some(changes) => {
                    let changed = !changes.is_empty();
                    let model = cached.model.as_mut().expect("reusable cache has model");
                    for batch in &changes {
                        model.apply_batch(batch);
                    }
                    let cursor = changes
                        .last()
                        .map_or(cached.timeline_cursor, |batch| batch.event_id);
                    if !changed
                        && cached.layout_key == layout_key
                        && cached.revision == source.revision
                        && cached.model_revision == source.revision
                    {
                        cached.revision = source.revision;
                        cached.timeline_cursor = cursor;
                        cached.timeline_rescan_epoch = timeline_rescan_epoch;
                        cached.current = true;
                        cached.analysis_stale = false;
                        return Ok(Arc::clone(&cached.bytes));
                    }
                    let snapshot =
                        RenderSnapshot::build_from_model(model, &cached_positions, options)?;
                    (snapshot, None, cursor)
                }
                None => {
                    let (model, cursor) = full_graph_model(&connection, &source.root)?;
                    let snapshot =
                        RenderSnapshot::build_from_model(&model, &cached_positions, options)?;
                    (snapshot, Some(model), cursor)
                }
            }
        } else {
            let (model, cursor) = full_graph_model(&connection, &source.root)?;
            let snapshot = RenderSnapshot::build_from_model(&model, &cached_positions, options)?;
            (snapshot, Some(model), cursor)
        };
        save_new_layout_coordinates(&mut connection, &snapshot, options)?;
        let epoch = self.next_render_epoch.fetch_add(1, Ordering::Relaxed) + 1;
        let bytes = Arc::new(encode(&snapshot, epoch));
        let (edge_slots, edge_masks, edge_slot_indices, edge_count) = edge_slot_state(&snapshot);
        let degrees = snapshot.degrees.clone();
        let indices = path_indices(&snapshot.paths);
        let newest = modified_newest(&snapshot.modified_days);
        let paths = Arc::new(snapshot.paths);
        if let Some(cached) = cache
            .as_mut()
            .filter(|cached| cached.root == source.root && cached.generation == source.generation)
        {
            if let Some(model) = model {
                cached.model = Some(model);
            }
            cached.revision = source.revision;
            cached.model_revision = source.revision;
            cached.layout_key = layout_key;
            cached.epoch = epoch;
            cached.paths = paths;
            cached.path_indices = path_indices(&cached.paths);
            cached.modified_newest = newest;
            cached.bytes = Arc::clone(&bytes);
            cached.timeline_cursor = timeline_cursor;
            cached.timeline_rescan_epoch = timeline_rescan_epoch;
            cached.date_delta_floor_revision = source.revision;
            cached.date_delta_journal.clear();
            cached.edge_slots = edge_slots;
            cached.edge_masks = edge_masks;
            cached.edge_slot_indices = edge_slot_indices;
            cached.edge_count = edge_count;
            cached.degrees = degrees;
            cached.topology_delta_floor_revision = source.revision;
            cached.topology_delta_journal.clear();
            cached.current = true;
            cached.analysis_stale = false;
        } else {
            *cache = Some(CachedRenderGraph {
                root: source.root,
                generation: source.generation,
                revision: source.revision,
                model_revision: source.revision,
                layout_key,
                epoch,
                paths,
                path_indices: indices,
                modified_newest: newest,
                bytes: Arc::clone(&bytes),
                timeline_cursor,
                timeline_rescan_epoch,
                model,
                date_delta_floor_revision: source.revision,
                date_delta_journal: VecDeque::new(),
                edge_slots,
                edge_masks,
                edge_slot_indices,
                edge_count,
                degrees,
                topology_delta_floor_revision: source.revision,
                topology_delta_journal: VecDeque::new(),
                current: true,
                analysis_stale: false,
            });
        }
        Ok(bytes)
    }

    pub fn graph_modified_date_delta(
        &self,
        workspace: &str,
        base_epoch: u64,
        since_revision: u64,
        options: Options,
    ) -> Result<Option<GraphModifiedDateDelta>, SearchError> {
        validate_layout_options(options)?;
        let _building = self.render_lock.lock().map_err(SearchError::task)?;
        let source = self.graph_source(workspace)?;
        let connection = Connection::open(&source.metadata_path)?;
        let rescan_epoch = timeline::rescan_epoch(&connection)?;
        let mut cache = self.render_graph.write().map_err(SearchError::task)?;
        let Some(cached) = cache.as_mut().filter(|cached| {
            cached.root == source.root
                && cached.generation == source.generation
                && cached.layout_key == layout_key(options)
                && cached.epoch == base_epoch
                && cached.model.is_some()
                && !cached.layout_key.starts_with("timeline:")
                && cached.timeline_rescan_epoch == rescan_epoch
                && cached.revision <= since_revision
                && since_revision >= cached.date_delta_floor_revision
                && since_revision <= cached.model_revision
                && cached.model_revision <= source.revision
        }) else {
            return Ok(None);
        };
        let Some(changes) = timeline::changes_after(&connection, cached.timeline_cursor)? else {
            return Ok(None);
        };
        let revision_count = source.revision - cached.model_revision;
        if usize::try_from(revision_count).ok() != Some(changes.len()) {
            return Ok(None);
        }
        let Some(model) = cached.model.as_ref() else {
            return Ok(None);
        };
        let mut staged = HashMap::<String, super::timeline::NoteState>::new();
        let mut staged_batches = Vec::with_capacity(changes.len());
        let mut update_count = 0usize;
        for batch in &changes {
            if batch.changes.is_empty() {
                return Ok(None);
            }
            let mut updates = Vec::with_capacity(batch.changes.len());
            for change in &batch.changes {
                let Some(updated) = change.state.as_ref() else {
                    return Ok(None);
                };
                let Some(previous) = staged
                    .get(&change.path)
                    .or_else(|| model.notes.get(&change.path))
                else {
                    return Ok(None);
                };
                if !modified_date_only(previous, updated) {
                    return Ok(None);
                }
                let Some(index) = cached.path_indices.get(&change.path).copied() else {
                    return Ok(None);
                };
                let Some(modified_day) = modified_day(updated.modified_ns) else {
                    return Ok(None);
                };
                staged.insert(change.path.clone(), updated.clone());
                updates.push(GraphModifiedDateUpdate {
                    index,
                    modified_day,
                });
            }
            updates.sort_unstable_by_key(|update| update.index);
            update_count = update_count.saturating_add(updates.len());
            if update_count > MAX_DATE_DELTA_UPDATES {
                return Ok(None);
            }
            staged_batches.push(updates);
        }

        let mut date_delta_journal = cached.date_delta_journal.clone();
        let mut date_delta_floor_revision = cached.date_delta_floor_revision;
        let mut next_revision = cached.model_revision;
        for updates in &staged_batches {
            next_revision += 1;
            date_delta_journal.push_back(GraphModifiedDateDeltaRevision {
                revision: next_revision,
                updates: updates.clone(),
            });
        }
        trim_date_delta_journal(&mut date_delta_journal, &mut date_delta_floor_revision);
        if since_revision < date_delta_floor_revision {
            return Ok(None);
        }

        let model = cached
            .model
            .as_mut()
            .expect("cache filter requires graph model");
        for batch in &changes {
            model.apply_batch(batch);
        }
        cached.date_delta_journal = date_delta_journal;
        cached.date_delta_floor_revision = date_delta_floor_revision;
        cached.model_revision = source.revision;
        cached.timeline_cursor = changes
            .last()
            .map_or(cached.timeline_cursor, |batch| batch.event_id);
        let newest = staged
            .values()
            .filter_map(|note| modified_day(note.modified_ns))
            .fold(cached.modified_newest, f32::max);
        cached.modified_newest = newest;
        cached.current = true;
        cached.analysis_stale = false;
        let mut latest_by_index = BTreeMap::new();
        for entry in cached
            .date_delta_journal
            .iter()
            .filter(|entry| entry.revision > since_revision)
        {
            for update in &entry.updates {
                latest_by_index.insert(update.index, update.modified_day);
            }
        }
        Ok(Some(GraphModifiedDateDelta {
            base_epoch_low: base_epoch as u32,
            base_epoch_high: (base_epoch >> 32) as u32,
            revision: source.revision,
            modified_newest: cached.modified_newest,
            updates: latest_by_index
                .into_iter()
                .map(|(index, modified_day)| GraphModifiedDateUpdate {
                    index,
                    modified_day,
                })
                .collect(),
        }))
    }

    pub fn graph_topology_delta(
        &self,
        workspace: &str,
        base_epoch: u64,
        since_revision: u64,
        options: Options,
    ) -> Result<Option<GraphTopologyDelta>, SearchError> {
        validate_layout_options(options)?;
        let _building = self.render_lock.lock().map_err(SearchError::task)?;
        let source = self.graph_source(workspace)?;
        let connection = Connection::open(&source.metadata_path)?;
        let rescan_epoch = timeline::rescan_epoch(&connection)?;
        let mut cache = self.render_graph.write().map_err(SearchError::task)?;
        let Some(cached) = cache.as_mut().filter(|cached| {
            cached.root == source.root
                && cached.generation == source.generation
                && cached.layout_key == layout_key(options)
                && cached.epoch == base_epoch
                && cached.model.is_some()
                && !cached.layout_key.starts_with("timeline:")
                && cached.timeline_rescan_epoch == rescan_epoch
                && cached.revision <= since_revision
                && since_revision >= cached.topology_delta_floor_revision
                && since_revision <= cached.model_revision
                && cached.model_revision <= source.revision
        }) else {
            return Ok(None);
        };
        let Some(changes) = timeline::changes_after(&connection, cached.timeline_cursor)? else {
            return Ok(None);
        };
        if usize::try_from(source.revision - cached.model_revision).ok() != Some(changes.len()) {
            return Ok(None);
        }

        let model = cached
            .model
            .as_ref()
            .ok_or_else(|| SearchError::Unavailable {
                message: "Снимок графа устарел".to_owned(),
            })?;
        let mut known_modified = HashMap::<String, i64>::new();
        for batch in &changes {
            if batch.changes.is_empty() {
                return Ok(None);
            }
            for change in &batch.changes {
                let Some(previous) = known_modified
                    .get(&change.path)
                    .copied()
                    .or_else(|| model.notes.get(&change.path).map(|note| note.modified_ns))
                else {
                    return Ok(None);
                };
                let Some(updated) = change.state.as_ref() else {
                    return Ok(None);
                };
                if !cached.path_indices.contains_key(&change.path)
                    || updated.modified_ns < previous
                    || (updated.modified_ns != previous
                        && modified_day(updated.modified_ns).is_none())
                {
                    return Ok(None);
                }
                known_modified.insert(change.path.clone(), updated.modified_ns);
            }
        }

        let mut new_edge_slots = Vec::<(u32, u32)>::new();
        let mut new_edge_indices = HashMap::<(u32, u32), u32>::new();
        let mut staged_edge_masks = HashMap::<u32, (u32, u32)>::new();
        let mut edge_count = cached.edge_count;
        let mut staged_degrees = BTreeMap::<u32, u32>::new();
        let mut topology_journal = cached.topology_delta_journal.clone();
        let mut topology_floor = cached.topology_delta_floor_revision;
        let mut date_journal = cached.date_delta_journal.clone();
        let mut date_floor = cached.date_delta_floor_revision;
        let mut revision = cached.model_revision;
        let mut modified_newest = cached.modified_newest;
        let mut total_updates = 0usize;

        for batch in &changes {
            let previous_notes = batch
                .changes
                .iter()
                .filter_map(|change| {
                    cached
                        .model
                        .as_ref()?
                        .notes
                        .get(&change.path)
                        .map(|note| (change.path.as_str(), note.modified_ns))
                })
                .collect::<HashMap<_, _>>();
            let model = cached.model.as_mut().expect("validated graph model");
            let diff: GraphModelDiff = model.apply_batch(batch);
            if !diff.removed_notes.is_empty()
                || diff
                    .changed_notes
                    .iter()
                    .any(|path| !cached.path_indices.contains_key(path))
            {
                cached.model = Some(GraphModel::from_notes(
                    &source.root,
                    timeline::state_at(&connection, cached.timeline_cursor)?,
                ));
                return Ok(None);
            }

            let mut node_updates = BTreeMap::<u32, GraphTopologyNodeUpdate>::new();
            for change in &batch.changes {
                let index = cached.path_indices[&change.path];
                let note = &cached
                    .model
                    .as_ref()
                    .expect("graph model remains cached")
                    .notes[&change.path];
                if previous_notes.get(change.path.as_str()) != Some(&note.modified_ns) {
                    let day = modified_day(note.modified_ns).expect("prevalidated modified day");
                    modified_newest = modified_newest.max(day);
                    node_updates.insert(
                        index,
                        GraphTopologyNodeUpdate {
                            index,
                            degree: staged_degrees
                                .get(&index)
                                .copied()
                                .unwrap_or(cached.degrees[index as usize]),
                            modified_day: Some(day),
                        },
                    );
                }
            }

            let mut edge_updates = BTreeMap::<u32, GraphTopologyEdgeUpdate>::new();
            for pair in &diff.changed_pairs {
                let left = cached.path_indices[&pair.left];
                let right = cached.path_indices[&pair.right];
                let slot_pair = ordered_pair(left, right);
                let new_masks = if left <= right {
                    (pair.direction_mask, pair.type_mask)
                } else {
                    (reverse_direction_mask(pair.direction_mask), pair.type_mask)
                };
                let is_live_slot = |slot| {
                    staged_edge_masks
                        .get(&slot)
                        .copied()
                        .or_else(|| cached.edge_masks.get(slot as usize).copied())
                        .is_some_and(|masks| masks.1 != 0)
                };
                let slot = match new_edge_indices
                    .get(&slot_pair)
                    .copied()
                    .filter(|slot| is_live_slot(*slot))
                    .or_else(|| {
                        cached
                            .edge_slot_indices
                            .get(&slot_pair)
                            .copied()
                            .filter(|slot| is_live_slot(*slot))
                    }) {
                    Some(slot) => slot,
                    None if new_masks.1 != 0 => {
                        let slot = (cached.edge_slots.len() + new_edge_slots.len()) as u32;
                        new_edge_slots.push(slot_pair);
                        new_edge_indices.insert(slot_pair, slot);
                        staged_edge_masks.insert(slot, (0, 0));
                        slot
                    }
                    None => {
                        cached.model = Some(GraphModel::from_notes(
                            &source.root,
                            timeline::state_at(&connection, cached.timeline_cursor)?,
                        ));
                        return Ok(None);
                    }
                };
                let Some(previous_masks) = staged_edge_masks
                    .get(&slot)
                    .copied()
                    .or_else(|| cached.edge_masks.get(slot as usize).copied())
                else {
                    cached.model = Some(GraphModel::from_notes(
                        &source.root,
                        timeline::state_at(&connection, cached.timeline_cursor)?,
                    ));
                    return Ok(None);
                };
                if previous_masks == new_masks {
                    continue;
                }
                let previous_live = previous_masks.1 != 0;
                let next_live = new_masks.1 != 0;
                if slot as usize >= cached.edge_slots.len() && previous_live && !next_live {
                    cached.model = Some(GraphModel::from_notes(
                        &source.root,
                        timeline::state_at(&connection, cached.timeline_cursor)?,
                    ));
                    return Ok(None);
                }
                if previous_live != next_live {
                    if next_live {
                        edge_count = edge_count.saturating_add(1);
                        for index in [slot_pair.0, slot_pair.1] {
                            let degree = staged_degrees
                                .entry(index)
                                .or_insert(cached.degrees[index as usize]);
                            *degree = degree.saturating_add(1);
                            node_updates.insert(
                                index,
                                GraphTopologyNodeUpdate {
                                    index,
                                    degree: *degree,
                                    modified_day: node_updates
                                        .get(&index)
                                        .and_then(|update| update.modified_day),
                                },
                            );
                        }
                    } else {
                        edge_count = edge_count.saturating_sub(1);
                        for index in [slot_pair.0, slot_pair.1] {
                            let degree = staged_degrees
                                .entry(index)
                                .or_insert(cached.degrees[index as usize]);
                            *degree = degree.saturating_sub(1);
                            node_updates.insert(
                                index,
                                GraphTopologyNodeUpdate {
                                    index,
                                    degree: *degree,
                                    modified_day: node_updates
                                        .get(&index)
                                        .and_then(|update| update.modified_day),
                                },
                            );
                        }
                    }
                }
                staged_edge_masks.insert(slot, new_masks);
                edge_updates.insert(
                    slot,
                    GraphTopologyEdgeUpdate {
                        slot,
                        source: slot_pair.0,
                        target: slot_pair.1,
                        direction_mask: new_masks.0,
                        type_mask: new_masks.1,
                    },
                );
            }

            let node_updates = node_updates.into_values().collect::<Vec<_>>();
            let edge_updates = edge_updates.into_values().collect::<Vec<_>>();
            total_updates = total_updates
                .saturating_add(node_updates.len())
                .saturating_add(edge_updates.len());
            if total_updates > MAX_TOPOLOGY_DELTA_UPDATES {
                cached.model = Some(GraphModel::from_notes(
                    &source.root,
                    timeline::state_at(&connection, cached.timeline_cursor)?,
                ));
                return Ok(None);
            }
            revision += 1;
            topology_journal.push_back(GraphTopologyDeltaRevision {
                revision,
                edge_updates: edge_updates.clone(),
                node_updates: node_updates.clone(),
                edge_count,
            });
            date_journal.push_back(GraphModifiedDateDeltaRevision {
                revision,
                updates: node_updates
                    .iter()
                    .filter_map(|update| {
                        update
                            .modified_day
                            .map(|modified_day| GraphModifiedDateUpdate {
                                index: update.index,
                                modified_day,
                            })
                    })
                    .collect(),
            });
        }

        trim_topology_delta_journal(&mut topology_journal, &mut topology_floor);
        trim_date_delta_journal(&mut date_journal, &mut date_floor);
        if since_revision < topology_floor || since_revision < date_floor {
            cached.model = Some(GraphModel::from_notes(
                &source.root,
                timeline::state_at(&connection, cached.timeline_cursor)?,
            ));
            return Ok(None);
        }

        let mut latest_edges = BTreeMap::new();
        let mut latest_nodes = BTreeMap::<u32, GraphTopologyNodeUpdate>::new();
        let mut metrics_stale = cached.analysis_stale;
        for entry in topology_journal
            .iter()
            .filter(|entry| entry.revision > since_revision)
        {
            for update in &entry.edge_updates {
                latest_edges.insert(update.slot, update.clone());
                metrics_stale = true;
            }
            for update in &entry.node_updates {
                let merged = latest_nodes
                    .entry(update.index)
                    .or_insert_with(|| update.clone());
                merged.degree = update.degree;
                if update.modified_day.is_some() {
                    merged.modified_day = update.modified_day;
                }
            }
        }

        cached.edge_slots.extend(new_edge_slots);
        let first_new_slot = cached.edge_masks.len() as u32;
        cached
            .edge_masks
            .extend((0..new_edge_indices.len()).map(|offset| {
                staged_edge_masks
                    .get(&(first_new_slot + offset as u32))
                    .copied()
                    .unwrap_or((0, 0))
            }));
        cached.edge_slot_indices.extend(new_edge_indices);
        for (slot, masks) in staged_edge_masks {
            if let Some(cached_masks) = cached.edge_masks.get_mut(slot as usize) {
                *cached_masks = masks;
            }
        }
        cached.edge_count = edge_count;
        for (index, degree) in staged_degrees {
            cached.degrees[index as usize] = degree;
        }
        cached.topology_delta_journal = topology_journal;
        cached.topology_delta_floor_revision = topology_floor;
        cached.date_delta_journal = date_journal;
        cached.date_delta_floor_revision = date_floor;
        cached.modified_newest = modified_newest;
        cached.model_revision = source.revision;
        cached.timeline_cursor = changes
            .last()
            .map_or(cached.timeline_cursor, |batch| batch.event_id);
        cached.analysis_stale = metrics_stale;
        cached.current = true;

        Ok(Some(GraphTopologyDelta {
            base_epoch_low: base_epoch as u32,
            base_epoch_high: (base_epoch >> 32) as u32,
            revision: source.revision,
            edge_slot_count: cached.edge_slots.len() as u32,
            edge_count: cached.edge_count,
            metrics_stale,
            node_updates: latest_nodes.into_values().collect(),
            edge_updates: latest_edges.into_values().collect(),
        }))
    }

    pub fn graph_paths(&self, epoch: u64, indices: &[u32]) -> Result<Vec<String>, SearchError> {
        Ok(paths_at(&self.paths_for_epoch(epoch)?, indices))
    }

    pub fn save_graph_positions(
        &self,
        workspace: &str,
        epoch: u64,
        options: Options,
        updates: &[(u32, f32, f32)],
    ) -> Result<(), SearchError> {
        validate_layout_options(options)?;
        validate_position_updates(updates)?;
        if updates.is_empty() {
            return Ok(());
        }
        let _building = self.render_lock.lock().map_err(SearchError::task)?;
        let source = self.graph_source(workspace)?;
        let paths = {
            let cache = self.render_graph.read().map_err(SearchError::task)?;
            let cached = cache
                .as_ref()
                .filter(|cached| {
                    cached.epoch == epoch
                        && cached.current
                        && cached.root == source.root
                        && cached.generation == source.generation
                        && cached.model_revision == source.revision
                        && cached.layout_key == layout_key(options)
                })
                .ok_or_else(|| SearchError::Unavailable {
                    message: "Снимок графа устарел".to_owned(),
                })?;
            updates
                .iter()
                .map(|(index, _, _)| {
                    cached.paths.get(*index as usize).cloned().ok_or_else(|| {
                        SearchError::InvalidWorkspace {
                            message: "Индекс узла за пределами снимка графа".to_owned(),
                        }
                    })
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut connection = Connection::open(&source.metadata_path)?;
        persist_graph_positions(&mut connection, &paths, updates, options)?;
        let mut cache = self.render_graph.write().map_err(SearchError::task)?;
        let cached = cache
            .as_mut()
            .filter(|cached| {
                cached.epoch == epoch
                    && cached.current
                    && cached.root == source.root
                    && cached.generation == source.generation
                    && cached.model_revision == source.revision
            })
            .ok_or_else(|| SearchError::Unavailable {
                message: "Снимок графа устарел".to_owned(),
            })?;
        let mut bytes = cached.bytes.as_ref().clone();
        apply_position_updates(&mut bytes, updates)?;
        cached.bytes = Arc::new(bytes);
        Ok(())
    }

    pub fn graph_cluster_ids(
        &self,
        workspace: &str,
        epoch: u64,
        resolution: f64,
    ) -> Result<Vec<u32>, SearchError> {
        let source = self.graph_source(workspace)?;
        let bytes = self.bytes_for_epoch(epoch, &source)?;
        cluster_ids_from_snapshot(&bytes, resolution)
    }

    pub fn graph_filter_nodes(
        &self,
        workspace: &str,
        epoch: u64,
        filter: GraphNodeFilter,
    ) -> Result<Vec<u32>, SearchError> {
        validate_filter(&filter)?;
        let source = self.graph_source(workspace)?;
        let paths = self.paths_for_epoch_for_source(epoch, &source)?;
        let normalized_folder = filter
            .folder
            .as_deref()
            .unwrap_or_default()
            .replace('\\', "/");
        let relative_folder = normalized_folder.trim_matches('/');
        let folder_prefix = if relative_folder.is_empty() {
            None
        } else {
            Some(format!("{}/", identity(&source.root.join(relative_folder))))
        };
        let connection = Connection::open(&source.metadata_path)?;
        let allowed = metadata_paths(&connection, &filter)?;
        Ok(graph_indices(
            &paths,
            folder_prefix.as_deref(),
            allowed.as_ref(),
        ))
    }

    fn graph_source(&self, workspace: &str) -> Result<GraphSource, SearchError> {
        let active = self.active.read().map_err(SearchError::task)?;
        let active = active.as_ref().ok_or_else(|| SearchError::Unavailable {
            message: "Индекс ещё не готов".to_owned(),
        })?;
        if !same_workspace(&active.root, workspace) {
            return Err(SearchError::InvalidWorkspace {
                message: "Индекс принадлежит другой базе знаний".to_owned(),
            });
        }
        let status = active.progress.snapshot();
        if status.state == SearchIndexState::Error {
            return Err(SearchError::Unavailable {
                message: status
                    .error
                    .unwrap_or_else(|| "Поисковый индекс недоступен".to_owned()),
            });
        }
        if status.updating {
            return Err(SearchError::Unavailable {
                message: "Индекс обновляется".to_owned(),
            });
        }
        Ok(GraphSource {
            root: active.root.clone(),
            generation: active.generation,
            revision: status.revision,
            metadata_path: active.metadata_path.clone(),
        })
    }

    fn paths_for_epoch(&self, epoch: u64) -> Result<Arc<Vec<String>>, SearchError> {
        for cache in [&self.render_graph, &self.historical_render_graph] {
            if let Some(paths) = cache
                .read()
                .map_err(SearchError::task)?
                .as_ref()
                .filter(|cached| cached.epoch == epoch && cached.current)
                .map(|cached| Arc::clone(&cached.paths))
            {
                return Ok(paths);
            }
        }
        Err(stale_graph_error())
    }

    fn paths_for_epoch_for_source(
        &self,
        epoch: u64,
        source: &GraphSource,
    ) -> Result<Arc<Vec<String>>, SearchError> {
        self.cached_graph_for_epoch(epoch, source)
            .map(|cached| Arc::clone(&cached.paths))
    }

    fn bytes_for_epoch(
        &self,
        epoch: u64,
        source: &GraphSource,
    ) -> Result<Arc<Vec<u8>>, SearchError> {
        self.cached_graph_for_epoch(epoch, source)
            .map(|cached| Arc::clone(&cached.bytes))
    }

    fn cached_graph_for_epoch(
        &self,
        epoch: u64,
        source: &GraphSource,
    ) -> Result<CachedGraphView, SearchError> {
        for cache in [&self.render_graph, &self.historical_render_graph] {
            let guard = cache.read().map_err(SearchError::task)?;
            if let Some(cached) = guard.as_ref().filter(|cached| {
                cached.epoch == epoch
                    && cached.current
                    && cached.root == source.root
                    && cached.generation == source.generation
                    && (cached.layout_key.starts_with("timeline:")
                        || cached.model_revision == source.revision)
            }) {
                return Ok(CachedGraphView {
                    bytes: Arc::clone(&cached.bytes),
                    paths: Arc::clone(&cached.paths),
                });
            }
        }
        Err(stale_graph_error())
    }

    fn cached_render_graph(
        &self,
        source: &GraphSource,
        layout_key: &str,
    ) -> Result<Option<Arc<Vec<u8>>>, SearchError> {
        let cache = self.render_graph.read().map_err(SearchError::task)?;
        Ok(cache.as_ref().and_then(|cached| {
            (cached.root == source.root
                && cached.generation == source.generation
                && cached.revision == source.revision
                && cached.current
                && !cached.analysis_stale)
                .then_some(cached)
                .filter(|cached| cached.layout_key == layout_key)
                .map(|cached| Arc::clone(&cached.bytes))
        }))
    }
}

struct CachedGraphView {
    bytes: Arc<Vec<u8>>,
    paths: Arc<Vec<String>>,
}

fn stale_graph_error() -> SearchError {
    SearchError::Unavailable {
        message: "Снимок графа устарел".to_owned(),
    }
}

fn modified_day(modified_ns: i64) -> Option<f32> {
    (modified_ns > 0)
        .then_some((modified_ns as f64 / 86_400_000_000_000.0) as f32)
        .filter(|day| day.is_finite())
}

fn modified_newest(days: &[f32]) -> f32 {
    days.iter()
        .copied()
        .filter(|day| day.is_finite())
        .fold(0.0, f32::max)
}

fn path_indices(paths: &[String]) -> HashMap<String, u32> {
    paths
        .iter()
        .enumerate()
        .map(|(index, path)| (path.clone(), index as u32))
        .collect()
}

fn trim_date_delta_journal(
    journal: &mut VecDeque<GraphModifiedDateDeltaRevision>,
    floor_revision: &mut u64,
) {
    let mut update_count = journal
        .iter()
        .map(|entry| entry.updates.len())
        .sum::<usize>();
    while journal.len() > MAX_DATE_DELTA_REVISIONS || update_count > MAX_DATE_DELTA_UPDATES {
        let Some(removed) = journal.pop_front() else {
            break;
        };
        update_count -= removed.updates.len();
        *floor_revision = removed.revision;
    }
}

fn trim_topology_delta_journal(
    journal: &mut VecDeque<GraphTopologyDeltaRevision>,
    floor_revision: &mut u64,
) {
    let mut update_count = journal
        .iter()
        .map(|entry| entry.edge_updates.len() + entry.node_updates.len())
        .sum::<usize>();
    while journal.len() > MAX_TOPOLOGY_DELTA_REVISIONS || update_count > MAX_TOPOLOGY_DELTA_UPDATES
    {
        let Some(removed) = journal.pop_front() else {
            break;
        };
        update_count -= removed.edge_updates.len() + removed.node_updates.len();
        *floor_revision = removed.revision;
    }
}

fn ordered_pair(left: u32, right: u32) -> (u32, u32) {
    (left.min(right), left.max(right))
}

fn reverse_direction_mask(mask: u32) -> u32 {
    ((mask & 0x3f) << 6) | ((mask >> 6) & 0x3f)
}

fn edge_slot_state(
    snapshot: &RenderSnapshot,
) -> (
    Vec<(u32, u32)>,
    Vec<(u32, u32)>,
    HashMap<(u32, u32), u32>,
    u32,
) {
    let mut slots = Vec::with_capacity(snapshot.edge_count());
    let mut masks = Vec::with_capacity(snapshot.edge_count());
    let mut indices = HashMap::with_capacity(snapshot.edge_count());
    for (slot, endpoints) in snapshot.edges.chunks_exact(2).enumerate() {
        let pair = (endpoints[0], endpoints[1]);
        let slot = slot as u32;
        slots.push(pair);
        masks.push((
            snapshot.edge_directions[slot as usize],
            snapshot.edge_types[slot as usize],
        ));
        indices.insert(pair, slot);
    }
    let edge_count = slots.len() as u32;
    (slots, masks, indices, edge_count)
}

fn full_graph_model(
    connection: &Connection,
    root: &Path,
) -> Result<(GraphModel, i64), SearchError> {
    let cursor = timeline::range(connection)?.latest_event;
    Ok((
        GraphModel::from_notes(root, timeline::state_at(connection, cursor)?),
        cursor,
    ))
}

fn load_layout_coordinates(
    connection: &Connection,
    options: Options,
) -> Result<std::collections::HashMap<String, (f32, f32)>, SearchError> {
    ensure_layout_cache(connection)?;
    let mut statement = connection
        .prepare("SELECT path, x, y FROM graph_layout_coordinates_by_mode WHERE layout_key = ?1")?;
    let rows = statement.query_map([layout_key(options)], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, f64>(1)? as f32,
            row.get::<_, f64>(2)? as f32,
        ))
    })?;
    Ok(rows
        .filter_map(Result::ok)
        .filter(|(_, x, y)| x.is_finite() && y.is_finite())
        .map(|(path, x, y)| (path, (x, y)))
        .collect())
}

fn ensure_layout_cache(connection: &Connection) -> Result<(), SearchError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS graph_layout_coordinates (
            path TEXT PRIMARY KEY NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS graph_layout_coordinates_by_mode (
            layout_key TEXT NOT NULL,
            path TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            PRIMARY KEY(layout_key, path)
        ) WITHOUT ROWID;
        INSERT OR IGNORE INTO graph_layout_coordinates_by_mode (layout_key, path, x, y)
        SELECT 'force:3ff0000000000000:3ff0000000000000', path, x, y FROM graph_layout_coordinates;
        DELETE FROM graph_layout_coordinates
        WHERE NOT EXISTS (SELECT 1 FROM documents WHERE documents.path = graph_layout_coordinates.path)",
    )?;
    Ok(())
}

fn save_new_layout_coordinates(
    connection: &mut Connection,
    snapshot: &RenderSnapshot,
    options: Options,
) -> Result<(), SearchError> {
    ensure_layout_cache(connection)?;
    let transaction = connection.transaction()?;
    for (path, position) in snapshot
        .paths
        .iter()
        .zip(snapshot.positions.chunks_exact(2))
    {
        transaction.execute(
            "INSERT OR IGNORE INTO graph_layout_coordinates_by_mode
             (layout_key, path, x, y) VALUES (?1, ?2, ?3, ?4)",
            (
                layout_key(options),
                path,
                f64::from(position[0]),
                f64::from(position[1]),
            ),
        )?;
    }
    transaction.execute(
        "DELETE FROM graph_layout_coordinates_by_mode
         WHERE NOT EXISTS (SELECT 1 FROM documents WHERE documents.path = graph_layout_coordinates_by_mode.path)",
        [],
    )?;
    transaction.commit()?;
    Ok(())
}

fn validate_position_updates(updates: &[(u32, f32, f32)]) -> Result<(), SearchError> {
    if updates.len() > MAX_POSITION_UPDATES
        || updates.iter().any(|(_, x, y)| {
            !x.is_finite() || !y.is_finite() || x.abs() > MAX_POSITION || y.abs() > MAX_POSITION
        })
    {
        return Err(SearchError::InvalidWorkspace {
            message: "Некорректные координаты графа".to_owned(),
        });
    }
    let mut indices = HashSet::with_capacity(updates.len());
    if updates.iter().any(|(index, _, _)| !indices.insert(*index)) {
        return Err(SearchError::InvalidWorkspace {
            message: "Индекс узла повторяется в обновлении координат".to_owned(),
        });
    }
    Ok(())
}

fn persist_graph_positions(
    connection: &mut Connection,
    paths: &[String],
    updates: &[(u32, f32, f32)],
    options: Options,
) -> Result<(), SearchError> {
    ensure_layout_cache(connection)?;
    let transaction = connection.transaction()?;
    for (path, (_, x, y)) in paths.iter().zip(updates) {
        let exists = transaction.query_row(
            "SELECT EXISTS (SELECT 1 FROM documents WHERE path = ?1)",
            [path],
            |row| row.get::<_, bool>(0),
        )?;
        if !exists {
            return Err(SearchError::Unavailable {
                message: "Заметка графа больше не существует".to_owned(),
            });
        }
        transaction.execute(
            "INSERT INTO graph_layout_coordinates_by_mode (layout_key, path, x, y) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(layout_key, path) DO UPDATE SET x = excluded.x, y = excluded.y",
            (layout_key(options), path, f64::from(*x), f64::from(*y)),
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn apply_position_updates(
    bytes: &mut [u8],
    updates: &[(u32, f32, f32)],
) -> Result<(), SearchError> {
    if bytes.len() < SNAPSHOT_HEADER_BYTES {
        return Err(SearchError::Unavailable {
            message: "Бинарный снимок графа повреждён".to_owned(),
        });
    }
    let node_count = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    for (index, x, y) in updates {
        if *index >= node_count {
            return Err(SearchError::InvalidWorkspace {
                message: "Индекс узла за пределами снимка графа".to_owned(),
            });
        }
        let start = SNAPSHOT_HEADER_BYTES + *index as usize * 8;
        if start + 8 > bytes.len() {
            return Err(SearchError::Unavailable {
                message: "Бинарный снимок графа повреждён".to_owned(),
            });
        }
        bytes[start..start + 4].copy_from_slice(&x.to_le_bytes());
        bytes[start + 4..start + 8].copy_from_slice(&y.to_le_bytes());
    }
    Ok(())
}

fn cluster_ids_from_snapshot(bytes: &[u8], resolution: f64) -> Result<Vec<u32>, SearchError> {
    if !resolution.is_finite() || !(0.5..=2.5).contains(&resolution) {
        return Err(SearchError::InvalidWorkspace {
            message: "Детализация сообществ должна быть от 0,5 до 2,5".to_owned(),
        });
    }
    if bytes.len() < 16 {
        return Err(SearchError::Unavailable {
            message: "Бинарный снимок графа повреждён".to_owned(),
        });
    }
    let node_count = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
    let edge_count = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let edge_start = 16usize
        .checked_add(
            node_count
                .checked_mul(32)
                .ok_or_else(|| SearchError::Unavailable {
                    message: "Бинарный снимок графа повреждён".to_owned(),
                })?,
        )
        .ok_or_else(|| SearchError::Unavailable {
            message: "Бинарный снимок графа повреждён".to_owned(),
        })?;
    let edge_end = edge_start
        .checked_add(
            edge_count
                .checked_mul(16)
                .ok_or_else(|| SearchError::Unavailable {
                    message: "Бинарный снимок графа повреждён".to_owned(),
                })?,
        )
        .ok_or_else(|| SearchError::Unavailable {
            message: "Бинарный снимок графа повреждён".to_owned(),
        })?;
    if edge_end > bytes.len() {
        return Err(SearchError::Unavailable {
            message: "Бинарный снимок графа повреждён".to_owned(),
        });
    }
    let edges = bytes[edge_start..edge_start + edge_count * 8]
        .chunks_exact(8)
        .map(|edge| {
            (
                u32::from_le_bytes(edge[0..4].try_into().unwrap()),
                u32::from_le_bytes(edge[4..8].try_into().unwrap()),
            )
        })
        .collect::<Vec<_>>();
    Ok(louvain(node_count, &edges, resolution))
}

fn metadata_paths(
    connection: &Connection,
    filter: &GraphNodeFilter,
) -> Result<Option<HashSet<String>>, SearchError> {
    let mut allowed = filter
        .tag
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|tag| paths_with_tag(connection, tag))
        .transpose()?;
    if let Some(key) = filter
        .property_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let value = filter.property_value.as_deref().unwrap_or_default();
        let matches = if value.trim().is_empty() {
            candidates(connection, &[], &[key.to_owned()])?
        } else {
            candidates(connection, &[(key.to_owned(), value.to_owned())], &[])?
        }
        .into_iter()
        .collect::<HashSet<_>>();
        allowed = Some(match allowed {
            Some(current) => current.intersection(&matches).cloned().collect(),
            None => matches,
        });
    }
    Ok(allowed)
}

fn validate_filter(filter: &GraphNodeFilter) -> Result<(), SearchError> {
    for value in [
        filter.folder.as_deref(),
        filter.tag.as_deref(),
        filter.property_key.as_deref(),
        filter.property_value.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.len() > 256 {
            return Err(SearchError::InvalidWorkspace {
                message: "Значение фильтра графа превышает 256 байт".to_owned(),
            });
        }
    }
    if filter.folder.as_deref().is_some_and(|folder| {
        let normalized = folder.replace('\\', "/");
        normalized.split('/').any(|part| part == "..")
            || normalized.starts_with('/')
            || normalized.contains(':')
    }) {
        return Err(SearchError::InvalidWorkspace {
            message: "Папка фильтра должна быть относительным путём внутри базы знаний".to_owned(),
        });
    }
    Ok(())
}

fn graph_indices(
    paths: &[String],
    folder_prefix: Option<&str>,
    allowed: Option<&HashSet<String>>,
) -> Vec<u32> {
    paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            if folder_prefix.is_some_and(|prefix| !identity(Path::new(path)).starts_with(prefix)) {
                return None;
            }
            if allowed.is_some_and(|paths| !paths.contains(path)) {
                return None;
            }
            Some(index as u32)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_position_updates, cluster_ids_from_snapshot, graph_indices, load_layout_coordinates,
        metadata_paths, persist_graph_positions, save_new_layout_coordinates,
        trim_date_delta_journal, trim_topology_delta_journal, validate_filter,
        validate_position_updates, GraphModifiedDateDeltaRevision, GraphModifiedDateUpdate,
        GraphNodeFilter, GraphTopologyDeltaRevision, GraphTopologyEdgeUpdate,
        GraphTopologyNodeUpdate, MAX_DATE_DELTA_REVISIONS, MAX_TOPOLOGY_DELTA_REVISIONS,
    };
    use crate::search::fields::{index_document, open_schema};
    use crate::search::graph::layout::{Mode, Options};
    use crate::search::graph::snapshot::RenderSnapshot;
    use crate::search::models::SearchIndexState;
    use rusqlite::Connection;
    use std::collections::{HashMap, HashSet};
    use std::path::Path;
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};

    fn fields_database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        open_schema(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        for (path, body) in [
            (
                "C:/vault/Books/A.md",
                "---\ntags: [red, blue]\ntype: book\n---\n",
            ),
            (
                "C:/vault/Books/B.md",
                "---\ntags: [green]\ntype: book\n---\n",
            ),
            ("C:/vault/Notes/C.md", "---\ntags: red\ntype: note\n---\n"),
        ] {
            index_document(&transaction, Path::new(path), body).unwrap();
        }
        transaction.commit().unwrap();
        connection
    }

    #[test]
    fn loading_timeline_snapshot_preserves_the_live_incremental_model() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let service = crate::search::service::SearchService::new(
            directory.path().join("indexes"),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        );
        let opened = service.open_index(root.clone(), true).unwrap();
        let progress = Arc::clone(&opened.progress);
        *service.active.write().unwrap() = Some(opened);
        for _ in 0..500 {
            let status = progress.snapshot();
            if status.state == SearchIndexState::Ready && !status.updating {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let options = Options::default();
        let live = service
            .render_graph(root.to_string_lossy().as_ref(), options)
            .unwrap();
        let live_epoch = u32::from_le_bytes(live[8..12].try_into().unwrap());
        assert!(service
            .render_graph
            .read()
            .unwrap()
            .as_ref()
            .unwrap()
            .model
            .is_some());
        service
            .render_graph_at_event(root.to_string_lossy().as_ref(), 0, options)
            .unwrap();

        let live_cache = service.render_graph.read().unwrap();
        assert_eq!(
            u32::from_le_bytes(
                live_cache.as_ref().unwrap().bytes[8..12]
                    .try_into()
                    .unwrap()
            ),
            live_epoch
        );
        assert!(live_cache.as_ref().unwrap().model.is_some());
        assert!(service
            .historical_render_graph
            .read()
            .unwrap()
            .as_ref()
            .is_some());
    }

    #[test]
    fn folder_and_metadata_filters_intersect_without_matching_sibling_names() {
        let paths = vec![
            "C:/vault/Books/Novel.md".to_owned(),
            "C:/vault/Books/Novel Notes.md".to_owned(),
            "C:/vault/Bookshelf/Other.md".to_owned(),
        ];
        let allowed = HashSet::from([
            "C:/vault/Books/Novel.md".to_owned(),
            "C:/vault/Bookshelf/Other.md".to_owned(),
        ]);

        let folder_prefix = format!("{}/", super::identity(Path::new("C:/vault/Books")));
        let indices = graph_indices(&paths, Some(&folder_prefix), Some(&allowed));

        assert_eq!(indices, vec![0]);
    }

    #[test]
    fn empty_metadata_filter_keeps_every_node() {
        let paths = vec!["C:/vault/A.md".to_owned(), "C:/vault/B.md".to_owned()];

        assert_eq!(graph_indices(&paths, None, None), vec![0, 1]);
    }

    #[test]
    fn tag_and_frontmatter_property_filters_intersect_using_the_index() {
        let connection = fields_database();

        let paths = metadata_paths(
            &connection,
            &GraphNodeFilter {
                tag: Some("#red".to_owned()),
                property_key: Some("TYPE".to_owned()),
                property_value: Some("Book".to_owned()),
                ..GraphNodeFilter::default()
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(paths, HashSet::from(["C:/vault/Books/A.md".to_owned()]));
    }

    #[test]
    fn property_filter_without_value_matches_filled_properties() {
        let connection = fields_database();

        let paths = metadata_paths(
            &connection,
            &GraphNodeFilter {
                property_key: Some("type".to_owned()),
                ..GraphNodeFilter::default()
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(paths.len(), 3);
    }

    #[test]
    fn folder_filter_rejects_workspace_escape_and_oversized_values() {
        assert!(validate_filter(&GraphNodeFilter {
            folder: Some("../outside".to_owned()),
            ..GraphNodeFilter::default()
        })
        .is_err());
        assert!(validate_filter(&GraphNodeFilter {
            tag: Some("x".repeat(257)),
            ..GraphNodeFilter::default()
        })
        .is_err());
    }

    #[test]
    fn recalculates_communities_from_the_cached_edge_section() {
        let mut bytes = vec![0; 16 + 2 * 32 + 16];
        bytes[0..4].copy_from_slice(&2u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[80..84].copy_from_slice(&0u32.to_le_bytes());
        bytes[84..88].copy_from_slice(&1u32.to_le_bytes());

        assert_eq!(cluster_ids_from_snapshot(&bytes, 1.0).unwrap(), vec![0, 0]);
    }

    #[test]
    fn rejects_invalid_community_resolution_and_truncated_snapshot() {
        assert!(cluster_ids_from_snapshot(&[0; 16], 0.0).is_err());
        let mut truncated = [0; 16];
        truncated[0..4].copy_from_slice(&1u32.to_le_bytes());
        assert!(cluster_ids_from_snapshot(&truncated, 1.0).is_err());
    }

    #[test]
    fn layout_coordinates_persist_by_path_and_drop_deleted_notes() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE documents (path TEXT PRIMARY KEY);
                 INSERT INTO documents VALUES ('a.md'), ('b.md');",
            )
            .unwrap();
        let first = RenderSnapshot {
            paths: vec!["a.md".to_owned(), "b.md".to_owned()],
            node_ids: vec![1, 2],
            cluster_ids: vec![0, 0],
            positions: vec![1.0, 2.0, 3.0, 4.0],
            created_days: vec![0.0; 2],
            modified_days: vec![0.0; 2],
            degrees: vec![0; 2],
            edges: Vec::new(),
            edge_directions: Vec::new(),
            edge_types: Vec::new(),
        };

        let options = Options::default();
        save_new_layout_coordinates(&mut connection, &first, options).unwrap();
        assert_eq!(
            load_layout_coordinates(&connection, options).unwrap(),
            HashMap::from([
                ("a.md".to_owned(), (1.0, 2.0)),
                ("b.md".to_owned(), (3.0, 4.0)),
            ])
        );

        connection
            .execute("DELETE FROM documents WHERE path = 'b.md'", [])
            .unwrap();
        let second = RenderSnapshot {
            paths: vec!["a.md".to_owned()],
            positions: vec![1.0, 2.0],
            ..first
        };
        save_new_layout_coordinates(&mut connection, &second, options).unwrap();

        assert_eq!(
            load_layout_coordinates(&connection, options).unwrap(),
            HashMap::from([("a.md".to_owned(), (1.0, 2.0))])
        );
    }

    #[test]
    fn dragged_positions_replace_only_the_selected_note_coordinates() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE documents (path TEXT PRIMARY KEY);
                 INSERT INTO documents VALUES ('a.md'), ('b.md');",
            )
            .unwrap();
        let initial = RenderSnapshot {
            paths: vec!["a.md".to_owned(), "b.md".to_owned()],
            node_ids: vec![1, 2],
            cluster_ids: vec![0, 0],
            positions: vec![1.0, 2.0, 3.0, 4.0],
            created_days: vec![0.0; 2],
            modified_days: vec![0.0; 2],
            degrees: vec![0; 2],
            edges: Vec::new(),
            edge_directions: Vec::new(),
            edge_types: Vec::new(),
        };
        let options = Options::default();
        save_new_layout_coordinates(&mut connection, &initial, options).unwrap();

        persist_graph_positions(
            &mut connection,
            &["b.md".to_owned()],
            &[(1, 8.5, -2.25)],
            options,
        )
        .unwrap();

        assert_eq!(
            load_layout_coordinates(&connection, options).unwrap(),
            HashMap::from([
                ("a.md".to_owned(), (1.0, 2.0)),
                ("b.md".to_owned(), (8.5, -2.25)),
            ])
        );
    }

    #[test]
    fn legacy_coordinates_migrate_to_force_and_dragged_modes_stay_isolated() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE documents (path TEXT PRIMARY KEY);
             INSERT INTO documents VALUES ('a.md');
             CREATE TABLE graph_layout_coordinates (path TEXT PRIMARY KEY, x REAL, y REAL);
             INSERT INTO graph_layout_coordinates VALUES ('a.md', 2, 3);",
            )
            .unwrap();
        let force = Options::default();
        let ring = Options {
            mode: Mode::Ring,
            ..force
        };
        assert_eq!(
            load_layout_coordinates(&connection, force).unwrap()["a.md"],
            (2.0, 3.0)
        );
        assert!(load_layout_coordinates(&connection, ring)
            .unwrap()
            .is_empty());
        persist_graph_positions(
            &mut connection,
            &["a.md".to_owned()],
            &[(0, 9.0, -4.0)],
            ring,
        )
        .unwrap();
        assert_eq!(
            load_layout_coordinates(&connection, ring).unwrap()["a.md"],
            (9.0, -4.0)
        );
        assert_eq!(
            load_layout_coordinates(&connection, force).unwrap()["a.md"],
            (2.0, 3.0)
        );
    }

    #[test]
    fn coordinate_updates_validate_bounds_and_write_snapshot_positions() {
        assert!(validate_position_updates(&[(0, f32::NAN, 1.0)]).is_err());
        assert!(validate_position_updates(&[(0, 1_000_001.0, 1.0)]).is_err());
        assert!(validate_position_updates(&[(0, 1.0, 1.0), (0, 2.0, 2.0)]).is_err());
        assert!(validate_position_updates(&vec![(0, 1.0, 1.0); 513]).is_err());

        let mut bytes = vec![0; 16 + 2 * 32];
        bytes[0..4].copy_from_slice(&2u32.to_le_bytes());
        apply_position_updates(&mut bytes, &[(1, 7.25, -9.5)]).unwrap();

        assert_eq!(f32::from_le_bytes(bytes[24..28].try_into().unwrap()), 7.25);
        assert_eq!(f32::from_le_bytes(bytes[28..32].try_into().unwrap()), -9.5);
        assert!(apply_position_updates(&mut bytes, &[(2, 0.0, 0.0)]).is_err());
    }

    fn open_live_graph() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        crate::search::service::SearchService,
        Arc<crate::search::progress::IndexProgress>,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        let first = root.join("First.md");
        let second = root.join("Second.md");
        std::fs::write(&first, "[[Second]] initial").unwrap();
        std::fs::write(&second, "second note").unwrap();
        let root = root.canonicalize().unwrap();
        let service = crate::search::service::SearchService::new(
            directory.path().join("indexes"),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        );
        let opened = service.open_index(root.clone(), true).unwrap();
        let progress = Arc::clone(&opened.progress);
        *service.active.write().unwrap() = Some(opened);
        for _ in 0..500 {
            let status = progress.snapshot();
            if status.state == SearchIndexState::Ready && !status.updating {
                return (directory, root, service, progress);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("graph index did not finish initial scan");
    }

    fn wait_for_revision(progress: &crate::search::progress::IndexProgress, previous: u64) -> u64 {
        for _ in 0..500 {
            let status = progress.snapshot();
            if status.revision > previous && !status.updating {
                return status.revision;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("graph index did not publish a revision after {previous}");
    }

    fn set_modified_after(path: &Path, seconds: u64) {
        let file = std::fs::File::open(path).unwrap();
        let modified = SystemTime::now() + Duration::from_secs(seconds);
        file.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }

    fn set_modified_before(path: &Path, seconds: u64) {
        let file = std::fs::File::open(path).unwrap();
        let modified = SystemTime::now() - Duration::from_secs(seconds);
        file.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }

    #[test]
    fn date_only_delta_is_cumulative_and_keeps_epoch_bound_graph_operations_valid() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let base = service.render_graph(&root_text, options).unwrap();
        let base_epoch = u64::from(u32::from_le_bytes(base[8..12].try_into().unwrap()))
            | (u64::from(u32::from_le_bytes(base[12..16].try_into().unwrap())) << 32);
        let base_revision = progress.snapshot().revision;
        let paths = service.graph_paths(base_epoch, &[0, 1]).unwrap();
        let first_path = root.join("First.md");
        let second_path = root.join("Second.md");
        std::fs::write(&first_path, "[[Second]] revised first").unwrap();
        std::fs::write(&second_path, "revised second").unwrap();
        set_modified_after(&first_path, 5);
        set_modified_after(&second_path, 6);
        service.notify_paths(vec![first_path.clone(), second_path.clone()]);
        let revision_one = wait_for_revision(&progress, base_revision);

        let first_delta = service
            .graph_modified_date_delta(&root_text, base_epoch, base_revision, options)
            .unwrap()
            .unwrap();
        assert_eq!(first_delta.revision, revision_one);
        assert_eq!(first_delta.base_epoch_low, base_epoch as u32);
        assert_eq!(first_delta.base_epoch_high, (base_epoch >> 32) as u32);
        assert_eq!(first_delta.updates.len(), 2);
        assert!(first_delta.modified_newest > 0.0);
        let first_index = paths
            .iter()
            .position(|path| path.ends_with("First.md"))
            .unwrap() as u32;
        let first_day = first_delta
            .updates
            .iter()
            .find(|update| update.index == first_index)
            .unwrap()
            .modified_day;
        let second_revision_base = revision_one;
        std::fs::write(&first_path, "[[Second]] revised again").unwrap();
        set_modified_after(&first_path, 10);
        service.notify_content_path(first_path.clone());
        let revision_two = wait_for_revision(&progress, second_revision_base);

        let from_previous = service
            .graph_modified_date_delta(&root_text, base_epoch, revision_one, options)
            .unwrap()
            .unwrap();
        assert_eq!(from_previous.revision, revision_two);
        assert_eq!(from_previous.updates.len(), 1);
        assert_eq!(from_previous.updates[0].index, first_index);
        assert!(from_previous.updates[0].modified_day >= first_day);

        let cumulative = service
            .graph_modified_date_delta(&root_text, base_epoch, base_revision, options)
            .unwrap()
            .unwrap();
        assert_eq!(cumulative.updates.len(), 2);
        assert_eq!(
            cumulative
                .updates
                .iter()
                .find(|update| update.index == first_index)
                .unwrap()
                .modified_day,
            from_previous.updates[0].modified_day
        );
        assert!(service
            .graph_modified_date_delta(&root_text, base_epoch, revision_two, options)
            .unwrap()
            .unwrap()
            .updates
            .is_empty());
        assert_eq!(
            service.graph_paths(base_epoch, &[first_index]).unwrap()[0],
            first_path.to_string_lossy()
        );
        assert_eq!(
            service
                .graph_cluster_ids(&root_text, base_epoch, 1.0)
                .unwrap()
                .len(),
            2
        );
        service
            .save_graph_positions(&root_text, base_epoch, options, &[(first_index, 9.0, -4.0)])
            .unwrap();
        let cache = service.render_graph.read().unwrap();
        let cached = cache.as_ref().unwrap();
        assert_eq!(cached.revision, base_revision);
        assert_eq!(cached.model_revision, revision_two);
        assert_eq!(cached.epoch, base_epoch);
    }

    #[test]
    fn topology_changes_fall_back_without_mutating_the_cached_model_or_journal() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        let baseline_cache = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.model.clone(),
                cached.model_revision,
                cached.timeline_cursor,
                cached.date_delta_journal.clone(),
            )
        };
        assert!(service
            .graph_modified_date_delta(&root_text, epoch + 1, base_revision, options)
            .unwrap()
            .is_none());
        assert!(service
            .graph_modified_date_delta(
                &root_text,
                epoch,
                base_revision,
                Options {
                    mode: Mode::Ring,
                    ..options
                },
            )
            .unwrap()
            .is_none());
        {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            assert_eq!(cached.model, baseline_cache.0);
            assert_eq!(cached.model_revision, baseline_cache.1);
            assert_eq!(cached.timeline_cursor, baseline_cache.2);
            assert_eq!(cached.date_delta_journal, baseline_cache.3);
        }
        let first = root.join("First.md");
        std::fs::write(&first, "[[Missing]] topology changed").unwrap();
        set_modified_after(&first, 5);
        service.notify_content_path(first.clone());
        let revision = wait_for_revision(&progress, base_revision);
        let before = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.model.clone(),
                cached.model_revision,
                cached.timeline_cursor,
                cached.date_delta_journal.clone(),
            )
        };

        assert!(service
            .graph_modified_date_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        let guard = service.render_graph.read().unwrap();
        let cached = guard.as_ref().unwrap();
        assert_eq!(cached.model, before.0);
        assert_eq!(cached.model_revision, before.1);
        assert_eq!(cached.timeline_cursor, before.2);
        assert_eq!(cached.date_delta_journal, before.3);
        assert!(revision > base_revision);
    }

    #[test]
    fn same_node_set_edge_change_returns_a_slot_delta_and_keeps_the_base_epoch() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let base = service.render_graph(&root_text, options).unwrap();
        let base_epoch = u64::from(u32::from_le_bytes(base[8..12].try_into().unwrap()))
            | (u64::from(u32::from_le_bytes(base[12..16].try_into().unwrap())) << 32);
        assert_eq!(u32::from_le_bytes(base[4..8].try_into().unwrap()), 1);
        let base_revision = progress.snapshot().revision;
        let first = root.join("First.md");
        std::fs::write(&first, "removed link").unwrap();
        set_modified_after(&first, 5);
        service.notify_content_path(first);
        let revision = wait_for_revision(&progress, base_revision);

        let delta = service
            .graph_topology_delta(&root_text, base_epoch, base_revision, options)
            .unwrap()
            .unwrap();

        assert_eq!(delta.revision, revision);
        assert_eq!(delta.base_epoch_low, base_epoch as u32);
        assert_eq!(delta.base_epoch_high, (base_epoch >> 32) as u32);
        assert_eq!(delta.edge_slot_count, 1);
        assert_eq!(delta.edge_count, 0);
        assert!(delta.metrics_stale);
        assert!(delta.node_updates.iter().all(|update| update.degree == 0));
        assert_eq!(delta.edge_updates.len(), 1);
        assert_eq!(delta.edge_updates[0].slot, 0);
        assert_eq!(delta.edge_updates[0].type_mask, 0);
        assert_eq!(delta.edge_updates[0].direction_mask, 0);
        let first_index = service
            .graph_paths(base_epoch, &[0, 1])
            .unwrap()
            .iter()
            .position(|path| path.ends_with("First.md"))
            .unwrap() as u32;
        assert!(delta
            .node_updates
            .iter()
            .find(|update| update.index == first_index)
            .unwrap()
            .modified_day
            .is_some());
        assert_eq!(
            service.render_graph.read().unwrap().as_ref().unwrap().epoch,
            base_epoch
        );
    }

    #[test]
    fn topology_delta_appends_a_slot_and_catches_up_to_the_latest_pair_masks() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let first = root.join("First.md");
        let initial_revision = progress.snapshot().revision;
        std::fs::write(&first, "first note").unwrap();
        service.notify_content_path(first.clone());
        wait_for_revision(&progress, initial_revision);
        let base = service.render_graph(&root_text, options).unwrap();
        assert_eq!(u32::from_le_bytes(base[4..8].try_into().unwrap()), 0);
        let epoch = u64::from(u32::from_le_bytes(base[8..12].try_into().unwrap()))
            | (u64::from(u32::from_le_bytes(base[12..16].try_into().unwrap())) << 32);
        let base_revision = progress.snapshot().revision;

        std::fs::write(&first, "[[Second]]").unwrap();
        set_modified_after(&first, 5);
        service.notify_content_path(first);
        let revision_one = wait_for_revision(&progress, base_revision);
        let appended = service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .unwrap();
        assert_eq!(appended.edge_slot_count, 1);
        assert_eq!(appended.edge_count, 1);
        assert_eq!(appended.edge_updates.len(), 1);
        assert!(appended.metrics_stale);

        let second = root.join("Second.md");
        std::fs::write(&second, "[[First]]").unwrap();
        service.notify_content_path(second);
        let revision_two = wait_for_revision(&progress, revision_one);
        let cumulative = service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .unwrap();
        assert_eq!(cumulative.revision, revision_two);
        assert_eq!(cumulative.edge_slot_count, 1);
        assert_eq!(cumulative.edge_count, 1);
        assert_eq!(cumulative.edge_updates.len(), 1);
        assert_eq!(
            cumulative.edge_updates[0].slot,
            appended.edge_updates[0].slot
        );
        assert_eq!(cumulative.edge_updates[0].direction_mask, 65);
        assert!(cumulative.metrics_stale);
    }

    #[test]
    fn recreating_a_deleted_pair_appends_a_new_slot_instead_of_reviving_its_tombstone() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let first = root.join("First.md");
        let base = service.render_graph(&root_text, options).unwrap();
        let epoch = u64::from(u32::from_le_bytes(base[8..12].try_into().unwrap()))
            | (u64::from(u32::from_le_bytes(base[12..16].try_into().unwrap())) << 32);
        let base_revision = progress.snapshot().revision;

        std::fs::write(&first, "removed link").unwrap();
        set_modified_after(&first, 5);
        service.notify_content_path(first.clone());
        let deleted_revision = wait_for_revision(&progress, base_revision);
        let deleted = service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .unwrap();
        assert_eq!(deleted.edge_slot_count, 1);
        assert_eq!(deleted.edge_count, 0);
        assert_eq!(deleted.edge_updates[0].slot, 0);
        assert_eq!(deleted.edge_updates[0].type_mask, 0);

        std::fs::write(&first, "[[Second]] restored link").unwrap();
        set_modified_after(&first, 10);
        service.notify_content_path(first);
        let recreated_revision = wait_for_revision(&progress, deleted_revision);
        let recreated = service
            .graph_topology_delta(&root_text, epoch, deleted_revision, options)
            .unwrap()
            .unwrap();

        assert_eq!(recreated.revision, recreated_revision);
        assert_eq!(recreated.edge_slot_count, 2);
        assert_eq!(recreated.edge_count, 1);
        assert_eq!(recreated.edge_updates.len(), 1);
        assert_eq!(recreated.edge_updates[0].slot, 1);
        assert_eq!(recreated.edge_updates[0].type_mask, 1);
    }

    #[test]
    fn topology_delta_falls_back_when_a_new_slot_is_removed_before_catch_up() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let first = root.join("First.md");
        let base = service.render_graph(&root_text, options).unwrap();
        let epoch = u64::from(u32::from_le_bytes(base[8..12].try_into().unwrap()))
            | (u64::from(u32::from_le_bytes(base[12..16].try_into().unwrap())) << 32);
        let base_revision = progress.snapshot().revision;

        std::fs::write(&first, "removed link").unwrap();
        set_modified_after(&first, 5);
        service.notify_content_path(first.clone());
        wait_for_revision(&progress, base_revision);

        std::fs::write(&first, "[[Second]] restored link").unwrap();
        set_modified_after(&first, 10);
        service.notify_content_path(first.clone());
        wait_for_revision(&progress, base_revision + 1);

        std::fs::write(&first, "removed again").unwrap();
        set_modified_after(&first, 15);
        service.notify_content_path(first.clone());
        wait_for_revision(&progress, base_revision + 2);

        std::fs::write(&first, "[[Second]] restored again").unwrap();
        set_modified_after(&first, 20);
        service.notify_content_path(first);
        wait_for_revision(&progress, base_revision + 3);

        assert!(service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
    }

    #[test]
    fn topology_delta_falls_back_for_node_add_delete_rescan_epoch_and_layout() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        assert!(service
            .graph_topology_delta(&root_text, epoch + 1, base_revision, options)
            .unwrap()
            .is_none());
        assert!(service
            .graph_topology_delta(
                &root_text,
                epoch,
                base_revision,
                Options {
                    mode: Mode::Ring,
                    ..options
                },
            )
            .unwrap()
            .is_none());

        let added = root.join("Third.md");
        std::fs::write(&added, "third").unwrap();
        service.notify_paths(vec![added]);
        let revision = wait_for_revision(&progress, base_revision);
        let before_add = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.model.clone(),
                cached.model_revision,
                cached.timeline_cursor,
            )
        };
        assert!(service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            assert_eq!(cached.model, before_add.0);
            assert_eq!(cached.model_revision, before_add.1);
            assert_eq!(cached.timeline_cursor, before_add.2);
        }

        let _base = service.render_graph(&root_text, options).unwrap();
        let before_delete = progress.snapshot().revision;
        let delete_epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        std::fs::remove_file(root.join("Third.md")).unwrap();
        service.notify_paths(vec![root.join("Third.md")]);
        wait_for_revision(&progress, before_delete);
        assert!(service
            .graph_topology_delta(&root_text, delete_epoch, before_delete, options)
            .unwrap()
            .is_none());

        let _base = service.render_graph(&root_text, options).unwrap();
        let before_rescan = progress.snapshot().revision;
        let rescan_epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        let previous_rescan = service
            .render_graph
            .read()
            .unwrap()
            .as_ref()
            .unwrap()
            .timeline_rescan_epoch;
        service.ingest_watch(Vec::new(), true);
        wait_for_revision(&progress, before_rescan);
        assert!(service
            .graph_topology_delta(&root_text, rescan_epoch, before_rescan, options)
            .unwrap()
            .is_none());
        assert_eq!(
            service
                .render_graph
                .read()
                .unwrap()
                .as_ref()
                .unwrap()
                .timeline_rescan_epoch,
            previous_rescan
        );
        assert!(revision > base_revision);
    }

    #[test]
    fn topology_delta_missed_revision_and_eviction_fall_back_atomically() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        {
            let mut guard = service.render_graph.write().unwrap();
            guard.as_mut().unwrap().model_revision = base_revision - 1;
        }
        assert!(service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        {
            let mut guard = service.render_graph.write().unwrap();
            guard.as_mut().unwrap().model_revision = base_revision;
        }
        {
            let mut guard = service.render_graph.write().unwrap();
            let cached = guard.as_mut().unwrap();
            cached.topology_delta_floor_revision = base_revision;
            cached.topology_delta_journal = (1..=MAX_TOPOLOGY_DELTA_REVISIONS as u64)
                .map(|offset| GraphTopologyDeltaRevision {
                    revision: base_revision + offset,
                    edge_updates: vec![GraphTopologyEdgeUpdate {
                        slot: 0,
                        source: 0,
                        target: 1,
                        direction_mask: 1,
                        type_mask: 1,
                    }],
                    node_updates: vec![GraphTopologyNodeUpdate {
                        index: 0,
                        degree: 1,
                        modified_day: None,
                    }],
                    edge_count: 1,
                })
                .collect();
        }
        let first = root.join("First.md");
        std::fs::write(&first, "[[Second]]").unwrap();
        service.notify_content_path(first);
        wait_for_revision(&progress, base_revision);
        let before = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.model.clone(),
                cached.model_revision,
                cached.topology_delta_journal.clone(),
            )
        };
        assert!(service
            .graph_topology_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        let guard = service.render_graph.read().unwrap();
        let cached = guard.as_ref().unwrap();
        assert_eq!(cached.model, before.0);
        assert_eq!(cached.model_revision, before.1);
        assert_eq!(cached.topology_delta_journal, before.2);
    }

    #[test]
    fn a_rescan_invalidates_date_delta_without_advancing_the_cached_model() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let (epoch, cursor, model, model_revision, rescan_epoch) = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.epoch,
                cached.timeline_cursor,
                cached.model.clone(),
                cached.model_revision,
                cached.timeline_rescan_epoch,
            )
        };

        service.ingest_watch(Vec::new(), true);
        wait_for_revision(&progress, base_revision);

        assert!(service
            .graph_modified_date_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        let guard = service.render_graph.read().unwrap();
        let cached = guard.as_ref().unwrap();
        assert_eq!(cached.timeline_cursor, cursor);
        assert_eq!(cached.model, model);
        assert_eq!(cached.model_revision, model_revision);
        assert_eq!(cached.timeline_rescan_epoch, rescan_epoch);
    }

    #[test]
    fn a_modified_date_rollback_falls_back_without_advancing_the_cached_model() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let (epoch, cursor, model, model_revision) = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.epoch,
                cached.timeline_cursor,
                cached.model.clone(),
                cached.model_revision,
            )
        };
        let first = root.join("First.md");
        std::fs::write(&first, "[[Second]] date rollback").unwrap();
        set_modified_before(&first, 86_400);
        service.notify_content_path(first);
        wait_for_revision(&progress, base_revision);

        assert!(service
            .graph_modified_date_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        let guard = service.render_graph.read().unwrap();
        let cached = guard.as_ref().unwrap();
        assert_eq!(cached.timeline_cursor, cursor);
        assert_eq!(cached.model, model);
        assert_eq!(cached.model_revision, model_revision);
    }

    #[test]
    fn journal_eviction_falls_back_atomically_when_it_would_drop_the_requested_revision() {
        let (_directory, root, service, progress) = open_live_graph();
        let root_text = root.to_string_lossy().into_owned();
        let options = Options::default();
        let _base = service.render_graph(&root_text, options).unwrap();
        let base_revision = progress.snapshot().revision;
        let epoch = service.render_graph.read().unwrap().as_ref().unwrap().epoch;
        {
            let mut guard = service.render_graph.write().unwrap();
            let cached = guard.as_mut().unwrap();
            cached.date_delta_journal = (1..=MAX_DATE_DELTA_REVISIONS as u64)
                .map(|offset| GraphModifiedDateDeltaRevision {
                    revision: base_revision + offset,
                    updates: vec![GraphModifiedDateUpdate {
                        index: 0,
                        modified_day: offset as f32,
                    }],
                })
                .collect();
        }
        let first = root.join("First.md");
        std::fs::write(&first, "[[Second]] journal overflow").unwrap();
        set_modified_after(&first, 8);
        service.notify_content_path(first);
        wait_for_revision(&progress, base_revision);
        let before = {
            let guard = service.render_graph.read().unwrap();
            let cached = guard.as_ref().unwrap();
            (
                cached.model.clone(),
                cached.model_revision,
                cached.timeline_cursor,
                cached.date_delta_floor_revision,
                cached.date_delta_journal.clone(),
            )
        };

        assert!(service
            .graph_modified_date_delta(&root_text, epoch, base_revision, options)
            .unwrap()
            .is_none());
        let guard = service.render_graph.read().unwrap();
        let cached = guard.as_ref().unwrap();
        assert_eq!(cached.model, before.0);
        assert_eq!(cached.model_revision, before.1);
        assert_eq!(cached.timeline_cursor, before.2);
        assert_eq!(cached.date_delta_floor_revision, before.3);
        assert_eq!(cached.date_delta_journal, before.4);
    }

    #[test]
    fn modified_date_delta_serializes_the_gateway_contract_in_camel_case() {
        let value = serde_json::to_value(super::GraphModifiedDateDelta {
            base_epoch_low: 7,
            base_epoch_high: 9,
            revision: 11,
            modified_newest: 12.5,
            updates: vec![GraphModifiedDateUpdate {
                index: 3,
                modified_day: 4.5,
            }],
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "baseEpochLow": 7,
                "baseEpochHigh": 9,
                "revision": 11,
                "modifiedNewest": 12.5,
                "updates": [{"index": 3, "modifiedDay": 4.5}]
            })
        );
    }

    #[test]
    fn topology_delta_serializes_the_gateway_contract_in_camel_case() {
        let value = serde_json::to_value(super::GraphTopologyDelta {
            base_epoch_low: 7,
            base_epoch_high: 9,
            revision: 11,
            edge_slot_count: 4,
            edge_count: 3,
            metrics_stale: true,
            node_updates: vec![GraphTopologyNodeUpdate {
                index: 2,
                degree: 1,
                modified_day: Some(4.5),
            }],
            edge_updates: vec![GraphTopologyEdgeUpdate {
                slot: 3,
                source: 1,
                target: 2,
                direction_mask: 65,
                type_mask: 1,
            }],
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "baseEpochLow": 7,
                "baseEpochHigh": 9,
                "revision": 11,
                "edgeSlotCount": 4,
                "edgeCount": 3,
                "metricsStale": true,
                "nodeUpdates": [{"index": 2, "degree": 1, "modifiedDay": 4.5}],
                "edgeUpdates": [{
                    "slot": 3,
                    "source": 1,
                    "target": 2,
                    "directionMask": 65,
                    "typeMask": 1
                }]
            })
        );
    }

    #[test]
    fn topology_delta_journal_is_bounded_and_records_the_eviction_floor() {
        let mut journal = (1..=MAX_TOPOLOGY_DELTA_REVISIONS as u64 + 1)
            .map(|revision| GraphTopologyDeltaRevision {
                revision,
                edge_updates: vec![GraphTopologyEdgeUpdate {
                    slot: 0,
                    source: 0,
                    target: 1,
                    direction_mask: 1,
                    type_mask: 1,
                }],
                node_updates: Vec::new(),
                edge_count: 1,
            })
            .collect::<std::collections::VecDeque<_>>();
        let mut floor = 0;

        trim_topology_delta_journal(&mut journal, &mut floor);

        assert_eq!(journal.len(), MAX_TOPOLOGY_DELTA_REVISIONS);
        assert_eq!(floor, 1);
        assert_eq!(journal.front().unwrap().revision, floor + 1);
    }

    #[test]
    fn date_delta_journal_is_bounded_and_records_the_eviction_floor() {
        let mut journal = (1..=MAX_DATE_DELTA_REVISIONS as u64 + 1)
            .map(|revision| GraphModifiedDateDeltaRevision {
                revision,
                updates: vec![GraphModifiedDateUpdate {
                    index: 0,
                    modified_day: revision as f32,
                }],
            })
            .collect::<std::collections::VecDeque<_>>();
        let mut floor = 0;

        trim_date_delta_journal(&mut journal, &mut floor);

        assert_eq!(journal.len(), MAX_DATE_DELTA_REVISIONS);
        assert_eq!(floor, 1);
        assert_eq!(journal.front().unwrap().revision, floor + 1);
    }
}
