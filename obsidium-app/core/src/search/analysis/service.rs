use super::bm25f;
use super::duplicates;
use super::graph::GraphSnapshot;
use super::mentions;
use super::models::{AnalysisMethod, AnalysisResult};
use crate::search::error::SearchError;
use crate::search::models::SearchIndexState;
use crate::search::paths::canonical_path;
use crate::search::service::{CachedGraph, SearchService};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::settings::models::AppConfig;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;

impl SearchService {
    pub fn analyze_document(
        &self,
        workspace: &str,
        document: &str,
        method: AnalysisMethod,
        limit: Option<usize>,
        config: &AppConfig,
    ) -> Result<Vec<AnalysisResult>, SearchError> {
        let (root, generation, revision, index, metadata, cacheable) =
            self.with_index(workspace, |open| {
                let status = open.progress.snapshot();
                if status.updating {
                    return Err(SearchError::Unavailable {
                        message: "Search index is still updating".to_owned(),
                    });
                }
                if status.state == SearchIndexState::Error {
                    return Err(SearchError::Unavailable {
                        message: status
                            .error
                            .unwrap_or_else(|| "Search index is unavailable".to_owned()),
                    });
                }
                Ok((
                    open.root.clone(),
                    open.generation,
                    status.revision,
                    Arc::clone(&open.index),
                    Arc::clone(&open.metadata),
                    open.is_visible(),
                ))
            })?;
        let document = canonical_path(&PathBuf::from(document));
        if !document.starts_with(&root) {
            return Err(SearchError::invalid_workspace(
                "Document is outside workspace",
            ));
        }
        let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        match method {
            AnalysisMethod::Bm25f if !config.analysis.enable_bm25f => {
                Err(SearchError::Unavailable {
                    message: "BM25F analysis is disabled".to_owned(),
                })
            }
            AnalysisMethod::AdamicAdar if !config.analysis.enable_adamic_adar => {
                Err(SearchError::Unavailable {
                    message: "Adamic-Adar analysis is disabled".to_owned(),
                })
            }
            AnalysisMethod::Duplicates if !config.analysis.enable_duplicates => {
                Err(SearchError::Unavailable {
                    message: "Duplicate analysis is disabled".to_owned(),
                })
            }
            AnalysisMethod::UnlinkedMentions if !config.analysis.enable_unlinked_mentions => {
                Err(SearchError::Unavailable {
                    message: "Unlinked mention analysis is disabled".to_owned(),
                })
            }
            AnalysisMethod::Bm25f => bm25f::analyze(
                &index,
                &document,
                limit,
                &config.analysis.bm25f_params,
                &config.search,
            ),
            AnalysisMethod::Duplicates => duplicates::analyze(
                &index,
                &document,
                limit,
                &config.search,
                &config.analysis.bm25f_params,
            ),
            AnalysisMethod::AdamicAdar => {
                let graph = self.link_graph(&root, generation, revision, &metadata, cacheable)?;
                Ok(graph.adamic_adar(&document, limit))
            }
            AnalysisMethod::UnlinkedMentions => {
                let graph = self.link_graph(&root, generation, revision, &metadata, cacheable)?;
                mentions::analyze(&index, &graph, &document, limit)
            }
        }
    }

    pub fn incoming_links(
        &self,
        workspace: &str,
        documents: &[PathBuf],
    ) -> Result<Vec<usize>, SearchError> {
        let (root, generation, revision, metadata, cacheable) =
            self.with_index(workspace, |open| {
                Ok((
                    open.root.clone(),
                    open.generation,
                    open.progress.snapshot().revision,
                    Arc::clone(&open.metadata),
                    open.is_visible(),
                ))
            })?;
        let graph = self.link_graph(&root, generation, revision, &metadata, cacheable)?;
        Ok(graph.incoming_counts(documents))
    }

    fn link_graph(
        &self,
        root: &Path,
        generation: u64,
        revision: u64,
        metadata: &Arc<Mutex<Connection>>,
        cacheable: bool,
    ) -> Result<Arc<GraphSnapshot>, SearchError> {
        let load = || -> Result<Arc<GraphSnapshot>, SearchError> {
            let connection = metadata.lock().map_err(SearchError::task)?;
            Ok(Arc::new(GraphSnapshot::load(&connection, root)?))
        };
        if !cacheable {
            return load();
        }
        let cached_graph = {
            let cache = self.analysis_graph.read().map_err(SearchError::task)?;
            cache.as_ref().and_then(|cached| {
                (cached.root == root
                    && cached.generation == generation
                    && cached.revision == revision)
                    .then(|| Arc::clone(&cached.graph))
            })
        };
        if let Some(graph) = cached_graph {
            return Ok(graph);
        }
        let loaded = load()?;
        let mut cache = self.analysis_graph.write().map_err(SearchError::task)?;
        if let Some(cached) = cache.as_ref().filter(|cached| {
            cached.root == root && cached.generation == generation && cached.revision == revision
        }) {
            return Ok(Arc::clone(&cached.graph));
        }
        *cache = Some(CachedGraph {
            root: root.to_path_buf(),
            generation,
            revision,
            graph: Arc::clone(&loaded),
        });
        Ok(loaded)
    }
}
