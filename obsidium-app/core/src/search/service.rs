use super::analysis::graph::GraphSnapshot;
use super::error::SearchError;
use super::guest::Guest;
use super::index::SearchIndex;
use super::metadata;
use super::models::{IndexRevision, SearchIndexStatus, SearchResponse};
use super::paths::{canonical_path, canonical_workspace, same_path};
use super::progress::IndexProgress;
use super::worker::WorkerHandle;
use super::{ChangeNotifier, IndexNotifier};
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = crate::search::query::MAX_WINDOW;
const INDEX_CACHE_LIMIT_BYTES: u64 = 1024 * 1024 * 1024;
const INDEX_CACHE_MAX_AGE: Duration = Duration::from_secs(60 * 24 * 60 * 60);
const WATCH_BUFFER_CAPACITY: usize = 8_192;

#[derive(Default)]
pub struct PendingWatch {
    paths: HashSet<PathBuf>,
    rescan: bool,
}

impl PendingWatch {
    pub fn push(&mut self, paths: &[PathBuf], rescan: bool) {
        self.rescan |= rescan;
        for path in paths {
            if self.paths.len() >= WATCH_BUFFER_CAPACITY && !self.paths.contains(path) {
                self.rescan = true;
                continue;
            }
            self.paths.insert(path.clone());
        }
    }

    pub fn is_empty(&self) -> bool {
        self.paths.is_empty() && !self.rescan
    }

    pub fn take(&mut self) -> (Vec<PathBuf>, bool) {
        let paths = self.paths.drain().collect();
        let rescan = std::mem::take(&mut self.rescan);
        (paths, rescan)
    }
}

#[derive(Clone)]
pub struct SearchService {
    pub base_directory: PathBuf,
    pub active: Arc<RwLock<Option<OpenIndex>>>,
    pub guest: Arc<RwLock<Option<Guest>>>,
    pub prepare_lock: Arc<Mutex<()>>,
    notifier: ChangeNotifier,
    index_notifier: IndexNotifier,
    pending_watch: Arc<Mutex<PendingWatch>>,
    pub analysis_graph: Arc<RwLock<Option<CachedGraph>>>,
    pub render_graph: Arc<RwLock<Option<CachedRenderGraph>>>,
    pub historical_render_graph: Arc<RwLock<Option<CachedRenderGraph>>>,
    pub render_lock: Arc<Mutex<()>>,
    pub next_render_epoch: Arc<AtomicU64>,
    next_generation: Arc<AtomicU64>,
}

pub struct CachedGraph {
    pub root: PathBuf,
    pub generation: u64,
    pub revision: u64,
    pub graph: Arc<GraphSnapshot>,
}

pub struct CachedRenderGraph {
    pub root: PathBuf,
    pub generation: u64,
    pub revision: u64,
    pub(crate) model_revision: u64,
    pub layout_key: String,
    pub epoch: u64,
    pub paths: Arc<Vec<String>>,
    pub bytes: Arc<Vec<u8>>,
    pub timeline_cursor: i64,
    pub timeline_rescan_epoch: i64,
    pub model: Option<super::graph::model::GraphModel>,
    pub(crate) path_indices: std::collections::HashMap<String, u32>,
    pub(crate) modified_newest: f32,
    pub(crate) date_delta_floor_revision: u64,
    pub(crate) date_delta_journal:
        std::collections::VecDeque<super::graph::service::GraphModifiedDateDeltaRevision>,
    pub(crate) edge_slots: Vec<(u32, u32)>,
    pub(crate) edge_masks: Vec<(u32, u32)>,
    pub(crate) edge_slot_indices: std::collections::HashMap<(u32, u32), u32>,
    pub(crate) edge_count: u32,
    pub(crate) degrees: Vec<u32>,
    pub(crate) topology_delta_floor_revision: u64,
    pub(crate) topology_delta_journal:
        std::collections::VecDeque<super::graph::service::GraphTopologyDeltaRevision>,
    pub current: bool,
    pub analysis_stale: bool,
}

pub struct OpenIndex {
    pub root: PathBuf,
    pub index: Arc<SearchIndex>,
    worker: WorkerHandle,
    pub progress: Arc<IndexProgress>,
    pub metadata_path: PathBuf,
    pub metadata: Arc<Mutex<Connection>>,
    pub generation: u64,
    visible: Arc<AtomicBool>,
}

impl OpenIndex {
    pub fn is_visible(&self) -> bool {
        self.visible.load(Ordering::Relaxed)
    }

    pub fn stop(self) {
        self.worker.stop();
    }

    fn queue(&self, paths: &[PathBuf], rescan: bool) {
        let inside = paths
            .iter()
            .filter(|path| path.starts_with(&self.root))
            .cloned()
            .collect::<Vec<_>>();
        if rescan {
            self.worker.queue_rescan(inside);
        } else if !inside.is_empty() {
            self.worker.queue_paths(inside);
        }
    }
}

impl SearchService {
    pub fn new(
        base_directory: PathBuf,
        notifier: ChangeNotifier,
        index_notifier: IndexNotifier,
    ) -> Self {
        Self {
            base_directory,
            active: Arc::new(RwLock::new(None)),
            guest: Arc::new(RwLock::new(None)),
            prepare_lock: Arc::new(Mutex::new(())),
            notifier,
            index_notifier,
            pending_watch: Arc::new(Mutex::new(PendingWatch::default())),
            analysis_graph: Arc::new(RwLock::new(None)),
            render_graph: Arc::new(RwLock::new(None)),
            historical_render_graph: Arc::new(RwLock::new(None)),
            render_lock: Arc::new(Mutex::new(())),
            next_render_epoch: Arc::new(AtomicU64::new(0)),
            next_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn prepare(&self, workspace: &str) -> Result<SearchIndexStatus, SearchError> {
        let _guard = self.prepare_lock.lock().map_err(SearchError::task)?;
        let root = workspace_root(workspace)?;
        if let Some(status) = self.status_for_root(&root) {
            return Ok(status);
        }
        let opened = match self.take_guest(&root)? {
            Some(guest) => {
                guest.visible.store(true, Ordering::Relaxed);
                guest
            }
            None => self.open_index(root, true)?,
        };
        let progress = Arc::clone(&opened.progress);
        let generation = opened.generation;
        let previous = self
            .active
            .write()
            .map_err(SearchError::task)?
            .replace(opened);
        self.flush_pending_watch();
        if let Some(previous) = previous {
            self.mark_storage_used(&previous.root);
            previous.stop();
        }
        clear_if(&self.analysis_graph, |_| true);
        clear_if(&self.render_graph, |_| true);
        clear_if(&self.historical_render_graph, |_| true);
        let snapshot = progress.snapshot();
        (self.index_notifier)(IndexRevision {
            workspace_path: workspace.to_owned(),
            generation,
            revision: snapshot.revision,
        });
        Ok(snapshot)
    }

    pub fn open_index(&self, root: PathBuf, visible: bool) -> Result<OpenIndex, SearchError> {
        fs::create_dir_all(&self.base_directory)?;
        let key = blake3::hash(root.to_string_lossy().as_bytes()).to_hex();
        let storage = self.base_directory.join(key.as_str());
        touch_storage(&storage);
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let index_dir = storage.join(format!("index-v{}", crate::search::ANALYZER_VERSION));
        let index = Arc::new(SearchIndex::open(&index_dir)?);
        remove_stale_indexes(&storage, &index_dir);
        let progress = Arc::new(IndexProgress::new(index.document_count(), generation));
        let metadata_path = storage.join("documents.sqlite3");
        let metadata = Arc::new(Mutex::new(metadata::open(&metadata_path)?));
        let visible = Arc::new(AtomicBool::new(visible));
        let worker = WorkerHandle::spawn(
            root.clone(),
            Arc::clone(&index),
            metadata_path.clone(),
            Arc::clone(&progress),
            generation,
            self.refresh_notifier(root.clone(), generation, Arc::clone(&visible)),
        )?;
        if let Err(error) = self.prune_index_cache(Some(key.as_str()), false) {
            eprintln!("[obsidium:index] очистка поискового кэша не выполнена: {error}");
        }
        Ok(OpenIndex {
            root,
            index,
            worker,
            progress,
            metadata_path,
            metadata,
            generation,
            visible,
        })
    }

    fn refresh_notifier(
        &self,
        root: PathBuf,
        generation: u64,
        visible: Arc<AtomicBool>,
    ) -> IndexNotifier {
        let render_graph = Arc::clone(&self.render_graph);
        let index_notifier = Arc::clone(&self.index_notifier);
        Arc::new(move |event: IndexRevision| {
            mark_render_graph_stale(&render_graph, &root, generation);
            if visible.load(Ordering::Relaxed) {
                (index_notifier)(event);
            }
        })
    }

    pub fn search(
        &self,
        workspace: &str,
        query: &str,
        limit: Option<usize>,
        settings: &crate::settings::models::SearchIndexSettings,
    ) -> Result<SearchResponse, SearchError> {
        let found = self.with_index(workspace, |open| {
            Ok((Arc::clone(&open.index), Arc::clone(&open.progress)))
        });
        let (index, progress) = match found {
            Ok(found) => found,
            Err(SearchError::Unavailable { .. }) => return Ok(SearchResponse::idle()),
            Err(error) => return Err(error),
        };
        let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let (query_terms, results) = index.search(query, limit, settings)?;
        Ok(SearchResponse {
            query_terms,
            results,
            status: progress.snapshot(),
        })
    }

    pub fn with_index<T>(
        &self,
        workspace: &str,
        read: impl FnOnce(&OpenIndex) -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let root = canonical_workspace(workspace).map_err(|_| self.missing_index())?;
        self.locate(|open| same_path(&open.root, &root), read)?
            .ok_or_else(|| self.missing_index())
    }

    pub fn with_metadata<T>(
        &self,
        workspace: &str,
        read: impl FnOnce(&OpenIndex, &Connection) -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        if self.with_index(workspace, |_| Ok(())).is_err() {
            self.prepare(workspace)?;
        }
        self.with_index(workspace, |open| {
            let connection = open.metadata.lock().map_err(SearchError::task)?;
            read(open, &connection)
        })
    }

    pub fn with_metadata_containing<T>(
        &self,
        path: &Path,
        read: impl FnOnce(&OpenIndex, &Connection) -> Result<T, SearchError>,
    ) -> Result<Option<T>, SearchError> {
        self.with_index_containing(path, |open| {
            let connection = open.metadata.lock().map_err(SearchError::task)?;
            read(open, &connection)
        })
    }

    pub fn with_index_containing<T>(
        &self,
        path: &Path,
        read: impl FnOnce(&OpenIndex) -> Result<T, SearchError>,
    ) -> Result<Option<T>, SearchError> {
        self.locate(|open| path.starts_with(&open.root), read)
    }

    fn locate<T>(
        &self,
        fits: impl Fn(&OpenIndex) -> bool,
        read: impl FnOnce(&OpenIndex) -> Result<T, SearchError>,
    ) -> Result<Option<T>, SearchError> {
        {
            let active = self.active.read().map_err(SearchError::task)?;
            if let Some(open) = active.as_ref().filter(|open| fits(open)) {
                return read(open).map(Some);
            }
        }
        let guest = self.guest.read().map_err(SearchError::task)?;
        match guest.as_ref().filter(|guest| fits(&guest.index)) {
            Some(guest) => {
                guest.touch();
                read(&guest.index).map(Some)
            }
            None => Ok(None),
        }
    }

    fn missing_index(&self) -> SearchError {
        if self.active_root().is_some() {
            SearchError::invalid_workspace("Index belongs to a different workspace")
        } else {
            SearchError::Unavailable {
                message: "Index is not ready".to_owned(),
            }
        }
    }

    pub fn active_root(&self) -> Option<PathBuf> {
        self.active
            .read()
            .ok()
            .and_then(|active| active.as_ref().map(|value| value.root.clone()))
    }

    pub fn status(&self, workspace: Option<&str>) -> SearchIndexStatus {
        match workspace {
            Some(workspace) => self
                .with_index(workspace, |open| Ok(open.progress.snapshot()))
                .ok(),
            None => self
                .active
                .read()
                .ok()
                .and_then(|active| active.as_ref().map(|open| open.progress.snapshot())),
        }
        .unwrap_or_else(SearchIndexStatus::idle)
    }

    pub fn search_cache_size(&self) -> u64 {
        directory_size(&self.base_directory)
    }

    pub fn clear_unused_search_cache(&self) -> Result<u64, SearchError> {
        self.prune_index_cache(None, true)
    }

    pub fn rebuild_active_index(&self, workspace: &str) -> Result<SearchIndexStatus, SearchError> {
        let _guard = self.prepare_lock.lock().map_err(SearchError::task)?;
        let root = workspace_root(workspace)?;
        let active_root = self.active_root().ok_or_else(|| SearchError::Unavailable {
            message: "Search index is not ready".to_owned(),
        })?;
        if !same_path(&active_root, &root) {
            return Err(SearchError::invalid_workspace(
                "Only the active workspace index can be rebuilt",
            ));
        }
        let previous = self
            .active
            .write()
            .map_err(SearchError::task)?
            .take()
            .ok_or_else(|| SearchError::Unavailable {
                message: "Search index is not ready".to_owned(),
            })?;
        touch_storage(&self.storage_for_root(&root));
        previous.stop();
        remove_index_directories(&self.storage_for_root(&root))?;
        let opened = self.open_index(root.clone(), true)?;
        let status = opened.progress.snapshot();
        let generation = opened.generation;
        *self.active.write().map_err(SearchError::task)? = Some(opened);
        self.flush_pending_watch();
        clear_if(&self.analysis_graph, |_| true);
        clear_if(&self.render_graph, |_| true);
        clear_if(&self.historical_render_graph, |_| true);
        (self.index_notifier)(IndexRevision {
            workspace_path: workspace.to_owned(),
            generation,
            revision: status.revision,
        });
        Ok(status)
    }

    fn storage_for_root(&self, root: &Path) -> PathBuf {
        self.base_directory.join(
            blake3::hash(root.to_string_lossy().as_bytes())
                .to_hex()
                .as_str(),
        )
    }

    pub(crate) fn mark_storage_used(&self, root: &Path) {
        touch_storage(&self.storage_for_root(root));
    }

    fn prune_index_cache(
        &self,
        current: Option<&str>,
        clear_unused: bool,
    ) -> Result<u64, SearchError> {
        fs::create_dir_all(&self.base_directory)?;
        let mut protected = Vec::new();
        if let Some(active) = self.active_root() {
            protected.push(storage_key(&active));
        }
        if let Ok(guest) = self.guest.read() {
            if let Some(guest) = guest.as_ref() {
                protected.push(storage_key(&guest.index.root));
            }
        }
        if let Some(current) = current {
            protected.push(current.to_owned());
        }
        let storages = fs::read_dir(&self.base_directory)?
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| CacheStorage {
                key: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path(),
            })
            .filter(|entry| {
                entry.key.len() == 64 && entry.key.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            .collect::<Vec<_>>();
        let mut total = storages
            .iter()
            .map(|entry| directory_size(&entry.path))
            .sum::<u64>();
        let mut candidates = storages
            .into_iter()
            .filter(|entry| !protected.contains(&entry.key))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|entry| last_used(&entry.path));
        let mut removed = 0;
        for entry in candidates {
            let expired = last_used(&entry.path)
                .elapsed()
                .is_ok_and(|age| age >= INDEX_CACHE_MAX_AGE);
            if !clear_unused && !expired && total <= INDEX_CACHE_LIMIT_BYTES {
                continue;
            }
            let size = directory_size(&entry.path);
            remove_index_directories(&entry.path)?;
            let metadata = entry.path.join("documents.sqlite3");
            if metadata.is_file() {
                fs::remove_file(metadata)?;
            }
            if let Err(error) = fs::remove_file(entry.path.join(".last-used")) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error.into());
                }
            }
            total = total.saturating_sub(size);
            removed += size;
        }
        Ok(removed)
    }

    pub fn notify_paths(&self, paths: Vec<PathBuf>) {
        self.queue_paths(paths, true);
    }

    pub fn notify_content_path(&self, path: PathBuf) {
        self.queue_paths(vec![path], false);
    }

    pub fn ingest_watch(&self, paths: Vec<PathBuf>, rescan: bool) {
        let paths = paths
            .iter()
            .map(|path| canonical_path(path))
            .collect::<Vec<_>>();
        if let Ok(active) = self.active.read() {
            if let Some(active) = active.as_ref() {
                active.queue(&paths, rescan);
                return;
            }
        }
        if let Ok(mut pending) = self.pending_watch.lock() {
            pending.push(&paths, rescan);
        }
        self.flush_pending_watch();
    }

    fn flush_pending_watch(&self) {
        let Ok(active) = self.active.read() else {
            return;
        };
        let Some(active) = active.as_ref() else {
            return;
        };
        let Ok(mut pending) = self.pending_watch.lock() else {
            return;
        };
        if pending.is_empty() {
            return;
        }
        let (paths, rescan) = pending.take();
        drop(pending);
        active.queue(&paths, rescan);
    }

    fn queue_paths(&self, paths: Vec<PathBuf>, notify_sidebar: bool) {
        let canonical = paths
            .iter()
            .map(|path| canonical_path(path))
            .collect::<Vec<_>>();
        if let Ok(active) = self.active.read() {
            if let Some(active) = active.as_ref() {
                if notify_sidebar {
                    let shown = paths
                        .iter()
                        .zip(&canonical)
                        .filter(|(_, path)| path.starts_with(&active.root))
                        .map(|(path, _)| path.clone())
                        .collect::<Vec<_>>();
                    if !shown.is_empty() {
                        (self.notifier)(shown);
                    }
                }
                active.queue(&canonical, false);
            }
        }
        if let Ok(guest) = self.guest.read() {
            if let Some(guest) = guest.as_ref() {
                guest.index.queue(&canonical, false);
            }
        }
    }

    pub fn status_for_root(&self, root: &Path) -> Option<SearchIndexStatus> {
        self.active.read().ok().and_then(|active| {
            active
                .as_ref()
                .filter(|value| same_path(&value.root, root))
                .map(|value| value.progress.snapshot())
        })
    }
}

fn clear_if<T>(cache: &RwLock<Option<T>>, stale: impl Fn(&T) -> bool) {
    if let Ok(mut cached) = cache.write() {
        if cached.as_ref().is_some_and(stale) {
            *cached = None;
        }
    }
}

fn mark_render_graph_stale(
    cache: &RwLock<Option<CachedRenderGraph>>,
    root: &Path,
    generation: u64,
) {
    if let Ok(mut cached) = cache.write() {
        if let Some(cached) = cached
            .as_mut()
            .filter(|cached| cached.root == root && cached.generation == generation)
        {
            cached.current = false;
            cached.analysis_stale = true;
        }
    }
}

struct CacheStorage {
    key: String,
    path: PathBuf,
}

fn storage_key(root: &Path) -> String {
    blake3::hash(root.to_string_lossy().as_bytes())
        .to_hex()
        .to_string()
}

fn touch_storage(storage: &Path) {
    let _ = fs::create_dir_all(storage);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let _ = fs::write(storage.join(".last-used"), timestamp.to_string());
}

fn last_used(storage: &Path) -> SystemTime {
    fs::read_to_string(storage.join(".last-used"))
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| UNIX_EPOCH + Duration::from_secs(seconds))
        .or_else(|| {
            fs::metadata(storage)
                .and_then(|metadata| metadata.modified())
                .ok()
        })
        .unwrap_or(UNIX_EPOCH)
}

fn directory_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

fn remove_index_directories(storage: &Path) -> Result<(), SearchError> {
    let Ok(entries) = fs::read_dir(storage) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name().to_string_lossy().starts_with("index-v") {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

fn remove_stale_indexes(storage: &Path, current: &Path) {
    let Ok(entries) = fs::read_dir(storage) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = path != current
            && path.is_dir()
            && entry.file_name().to_string_lossy().starts_with("index-v");
        if !stale {
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => eprintln!(
                "[obsidium:index] удалён индекс старой версии {}",
                path.display()
            ),
            Err(error) => eprintln!(
                "[obsidium:index] индекс старой версии не удалён {}: {error}",
                path.display()
            ),
        }
    }
}

pub fn workspace_root(workspace: &str) -> Result<PathBuf, SearchError> {
    let root = canonical_workspace(workspace)?;
    if !root.is_dir() {
        return Err(SearchError::InvalidWorkspace {
            message: format!("Not a directory: {}", root.display()),
        });
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::{remove_stale_indexes, SearchService, WATCH_BUFFER_CAPACITY};
    use crate::search::models::IndexRevision;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn only_the_current_index_version_stays_on_disk() {
        let directory = tempfile::tempdir().unwrap();
        let storage = directory.path();
        for name in ["index-v6", "index-v8", "index-v9"] {
            fs::create_dir_all(storage.join(name).join("segment")).unwrap();
        }
        fs::write(storage.join("documents.sqlite3"), "").unwrap();

        remove_stale_indexes(storage, &storage.join("index-v9"));

        let mut left = fs::read_dir(storage)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        left.sort();
        assert_eq!(left, ["documents.sqlite3", "index-v9"]);
    }
}

#[cfg(test)]
mod cache_tests {
    use super::{SearchService, WATCH_BUFFER_CAPACITY};
    use crate::search::models::IndexRevision;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn automatic_cleanup_removes_only_expired_search_cache_entries() {
        let directory = tempfile::tempdir().unwrap();
        let base = directory.path().join("search-v2");
        let old = base.join("a".repeat(64));
        let recent = base.join("b".repeat(64));
        fs::create_dir_all(old.join("index-v13")).unwrap();
        fs::create_dir_all(recent.join("index-v13")).unwrap();
        fs::write(old.join("documents.sqlite3"), "derived").unwrap();
        fs::write(recent.join("documents.sqlite3"), "derived").unwrap();
        fs::write(
            old.join(".last-used"),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .saturating_sub(Duration::from_secs(61 * 24 * 60 * 60).as_secs())
                .to_string(),
        )
        .unwrap();
        fs::write(
            recent.join(".last-used"),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .to_string(),
        )
        .unwrap();
        let service = SearchService::new(
            base,
            Arc::new(|_: Vec<PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        );

        service
            .prune_index_cache(Some(&"c".repeat(64)), false)
            .unwrap();

        assert!(!old.join("index-v13").exists());
        assert!(!old.join("documents.sqlite3").exists());
        assert!(recent.join("index-v13").exists());
        assert!(recent.join("documents.sqlite3").exists());
    }

    #[test]
    fn manual_cleanup_preserves_active_index_and_only_removes_inactive_cache_files() {
        let directory = tempfile::tempdir().unwrap();
        let base = directory.path().join("search-v2");
        let vault = directory.path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "note").unwrap();
        let service = SearchService::new(
            base.clone(),
            Arc::new(|_: Vec<PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        );
        let opened = service.open_index(vault.clone(), true).unwrap();
        let active_index = base
            .join(
                blake3::hash(vault.to_string_lossy().as_bytes())
                    .to_hex()
                    .as_str(),
            )
            .join(format!("index-v{}", crate::search::ANALYZER_VERSION));
        *service.active.write().unwrap() = Some(opened);
        let inactive = base.join("d".repeat(64));
        fs::create_dir_all(inactive.join("index-v13")).unwrap();
        fs::write(inactive.join("index-v13/data"), "derived index").unwrap();
        fs::write(inactive.join("documents.sqlite3"), "derived metadata").unwrap();
        let unrelated = directory.path().join("settings.json");
        fs::write(&unrelated, "user settings").unwrap();

        let removed = service.clear_unused_search_cache().unwrap();

        assert!(removed > 0);
        assert!(active_index.exists());
        assert!(!inactive.join("index-v13").exists());
        assert!(!inactive.join("documents.sqlite3").exists());
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "user settings");
        service.active.write().unwrap().take().unwrap().stop();
    }

    fn watch_service(directory: &std::path::Path) -> SearchService {
        SearchService::new(
            directory.join("indexes"),
            Arc::new(|_: Vec<PathBuf>| {}),
            Arc::new(|_: IndexRevision| {}),
        )
    }

    #[test]
    fn watch_events_before_the_index_are_buffered_and_flushed() {
        let directory = tempfile::tempdir().unwrap();
        let vault = directory.path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        let note = vault.join("Заметка.md");
        fs::write(&note, "первое слово").unwrap();
        let service = watch_service(directory.path());

        service.ingest_watch(vec![note.clone()], false);
        assert!(
            !service.pending_watch.lock().unwrap().is_empty(),
            "событие до готовности индекса не теряется"
        );

        service.prepare(vault.to_string_lossy().as_ref()).unwrap();
        assert!(
            service.pending_watch.lock().unwrap().is_empty(),
            "появление активного индекса сбрасывает буфер"
        );

        service.active.write().unwrap().take().unwrap().stop();
    }

    #[test]
    fn full_watch_buffer_keeps_the_rescan_flag() {
        let directory = tempfile::tempdir().unwrap();
        let service = watch_service(directory.path());
        let paths = (0..WATCH_BUFFER_CAPACITY + 16)
            .map(|index| PathBuf::from(format!("/vault/{index}.md")))
            .collect::<Vec<_>>();

        service.ingest_watch(paths, false);
        let (buffered, rescan) = service.pending_watch.lock().unwrap().take();

        assert_eq!(buffered.len(), WATCH_BUFFER_CAPACITY);
        assert!(rescan, "переполнение буфера превращается в полный rescan");

        service.ingest_watch(Vec::new(), true);
        let (buffered, rescan) = service.pending_watch.lock().unwrap().take();
        assert!(buffered.is_empty());
        assert!(rescan, "признак rescan переживает пустой список путей");
    }
}
