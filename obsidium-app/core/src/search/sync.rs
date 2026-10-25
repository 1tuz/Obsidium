use super::error::SearchError;
use super::events;
use super::fields;
use super::index::SearchIndex;
use super::index_document::{apply_path, apply_prepared, prepare_file, probe, PreparedFile, Probe};
use super::metadata::{self, FileState, PathKey};
use super::paths::{is_hidden, is_markdown, is_visible_entry};
use super::progress::IndexProgress;
use super::tasks;
use super::wiki;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tantivy::{IndexWriter, Term};
use walkdir::WalkDir;

pub const INDEX_MEMORY_BUDGET: usize = 256_000_000;
const COMMIT_BATCH_SIZE: usize = 10_000;
const PREPARE_BATCH_SIZE: usize = 64;

pub struct IndexSynchronizer {
    root: PathBuf,
    index: Arc<SearchIndex>,
    writer: Option<IndexWriter>,
    connection: Connection,
    progress: Arc<IndexProgress>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScanPlan {
    Full,
    Verify,
    Ready,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScanSummary {
    pub max_mtime_ns: i64,
    pub changed: bool,
}

struct PendingPrepare {
    key: String,
    probe: Probe,
    path: PathBuf,
}

impl IndexSynchronizer {
    pub fn new(
        root: PathBuf,
        index: Arc<SearchIndex>,
        metadata_path: &Path,
        progress: Arc<IndexProgress>,
    ) -> Result<Self, SearchError> {
        Ok(Self {
            root,
            index,
            writer: None,
            connection: metadata::open(metadata_path)?,
            progress,
        })
    }

    pub fn plan(&self) -> Result<ScanPlan, SearchError> {
        let state = metadata::read_state(&self.connection)?;
        if !state.clean_shutdown
            || state.analyzer_version != crate::search::ANALYZER_VERSION
            || metadata::count(&self.connection)? != self.index.document_count()
        {
            return Ok(ScanPlan::Full);
        }
        Ok(if state.scan_completed_ns > 0 {
            ScanPlan::Ready
        } else {
            ScanPlan::Verify
        })
    }

    pub fn mark_unclean(&self) -> Result<(), SearchError> {
        metadata::mark_unclean(&self.connection)
    }

    pub fn begin_scan(&self) -> Result<(), SearchError> {
        metadata::begin_scan(&self.connection)
    }

    pub fn finish_scan(&self, max_mtime_ns: i64) -> Result<(), SearchError> {
        metadata::finish_scan(&self.connection, max_mtime_ns)
    }

    pub fn full_scan(&mut self, cancelled: &AtomicBool) -> Result<ScanSummary, SearchError> {
        self.progress.begin_scan();
        let mut known = metadata::load(&self.connection)?;
        let force_reindex = known.len() as u64 != self.index.document_count();
        let mut transaction = self.connection.transaction()?;
        super::graph::timeline::mark_rescan(&transaction)?;
        let mut pending = 0;
        let mut timeline_paths = Vec::new();
        let mut processed = 0;
        let mut graph_changed = false;
        let mut changed = false;
        let mut max_mtime_ns = 0;
        let mut prepare_batch = Vec::<PendingPrepare>::with_capacity(PREPARE_BATCH_SIZE);

        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(is_visible_entry)
            .filter_map(Result::ok)
        {
            if cancelled.load(Ordering::Relaxed) {
                return Ok(ScanSummary {
                    max_mtime_ns,
                    changed,
                });
            }
            if !entry.file_type().is_file() || !is_markdown(entry.path()) {
                continue;
            }
            self.progress.scanned_one();
            processed += 1;
            if let Some(probed) = probe(entry.path(), &mut known, force_reindex) {
                max_mtime_ns = max_mtime_ns.max(probed.fingerprint.0);
                if let Some(file_probe) = probed.probe {
                    prepare_batch.push(PendingPrepare {
                        key: probed.key,
                        probe: file_probe,
                        path: entry.path().to_path_buf(),
                    });
                    if prepare_batch.len() >= PREPARE_BATCH_SIZE {
                        flush_prepare_batch(
                            &self.root,
                            &self.index,
                            &mut self.writer,
                            &transaction,
                            &mut prepare_batch,
                            &mut pending,
                            &mut timeline_paths,
                            &mut graph_changed,
                        )?;
                    }
                }
            }
            if processed >= COMMIT_BATCH_SIZE {
                flush_prepare_batch(
                    &self.root,
                    &self.index,
                    &mut self.writer,
                    &transaction,
                    &mut prepare_batch,
                    &mut pending,
                    &mut timeline_paths,
                    &mut graph_changed,
                )?;
                if pending > 0 {
                    changed = true;
                    super::graph::timeline::record_changes(&transaction, &timeline_paths)?;
                    commit(&mut self.writer, &self.index, &self.progress)?;
                }
                transaction.commit()?;
                transaction = self.connection.transaction()?;
                pending = 0;
                timeline_paths.clear();
                processed = 0;
            }
        }
        flush_prepare_batch(
            &self.root,
            &self.index,
            &mut self.writer,
            &transaction,
            &mut prepare_batch,
            &mut pending,
            &mut timeline_paths,
            &mut graph_changed,
        )?;
        changed |= remove_stale(
            &self.index,
            &mut self.writer,
            &transaction,
            &known,
            &self.progress,
            &mut timeline_paths,
            &mut graph_changed,
        )?;
        if !timeline_paths.is_empty() {
            super::graph::timeline::record_changes(&transaction, &timeline_paths)?;
        }
        if pending > 0 {
            changed = true;
            commit(&mut self.writer, &self.index, &self.progress)?;
        }
        transaction.commit()?;
        metadata::maintain(&self.connection)?;
        if graph_changed {
            self.index.bump_graph_revision();
        }
        self.progress.completed(self.index.document_count());
        Ok(ScanSummary {
            max_mtime_ns,
            changed,
        })
    }

    pub fn verify(&mut self, cancelled: &AtomicBool) -> Result<ScanSummary, SearchError> {
        let mut known = metadata::stored_fingerprints(&self.connection)?;
        let mut changed_paths = HashSet::new();
        let mut max_mtime_ns = 0;
        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(is_visible_entry)
            .filter_map(Result::ok)
        {
            if cancelled.load(Ordering::Relaxed) {
                return Ok(ScanSummary {
                    max_mtime_ns,
                    changed: false,
                });
            }
            if !entry.file_type().is_file() || !is_markdown(entry.path()) {
                continue;
            }
            let Ok(file_metadata) = entry.metadata() else {
                continue;
            };
            let fingerprint = metadata::fingerprint(&file_metadata);
            max_mtime_ns = max_mtime_ns.max(fingerprint.0);
            let key = entry.path().to_string_lossy().into_owned();
            match known.remove(&metadata::key(&key)) {
                Some((_, stored)) if stored == fingerprint => {}
                _ => {
                    changed_paths.insert(entry.path().to_path_buf());
                }
            }
        }
        for (_, (path, _)) in known {
            changed_paths.insert(PathBuf::from(path));
        }
        if changed_paths.is_empty() || cancelled.load(Ordering::Relaxed) {
            return Ok(ScanSummary {
                max_mtime_ns,
                changed: false,
            });
        }
        let changed = self.apply_paths(changed_paths)?;
        Ok(ScanSummary {
            max_mtime_ns,
            changed,
        })
    }

    pub fn holds_writer(&self) -> bool {
        self.writer.is_some()
    }

    pub fn release_writer(&mut self) -> Result<(), SearchError> {
        if let Some(writer) = self.writer.take() {
            writer.wait_merging_threads()?;
        }
        Ok(())
    }

    pub fn apply_paths(&mut self, paths: HashSet<PathBuf>) -> Result<bool, SearchError> {
        let transaction = self.connection.transaction()?;
        let mut changed = false;
        let mut graph_changed = false;
        let mut timeline_paths = Vec::new();
        for path in paths {
            if !path.starts_with(&self.root) || !is_markdown(&path) || is_hidden(&self.root, &path)
            {
                continue;
            }
            let writer = ensure_writer(&mut self.writer, &self.index)?;
            let before = graph_state(&transaction, &path.to_string_lossy())?;
            let path_changed = apply_path(&self.root, &self.index, writer, &transaction, &path)?;
            changed |= path_changed;
            if path_changed {
                graph_changed |= before != graph_state(&transaction, &path.to_string_lossy())?;
                timeline_paths.push(path.to_string_lossy().into_owned());
            }
        }
        if changed {
            super::graph::timeline::record_changes(&transaction, &timeline_paths)?;
            commit(&mut self.writer, &self.index, &self.progress)?;
        }
        transaction.commit()?;
        if changed {
            metadata::maintain(&self.connection)?;
        }
        if graph_changed {
            self.index.bump_graph_revision();
        }
        Ok(changed)
    }
}

fn ensure_writer<'w>(
    slot: &'w mut Option<IndexWriter>,
    index: &SearchIndex,
) -> Result<&'w mut IndexWriter, SearchError> {
    if slot.is_none() {
        *slot = Some(index.index.writer(INDEX_MEMORY_BUDGET)?);
    }
    slot.as_mut()
        .ok_or_else(|| SearchError::task("index writer is missing"))
}

fn flush_prepare_batch(
    root: &Path,
    index: &SearchIndex,
    writer: &mut Option<IndexWriter>,
    transaction: &Transaction<'_>,
    batch: &mut Vec<PendingPrepare>,
    pending: &mut usize,
    timeline_paths: &mut Vec<String>,
    graph_changed: &mut bool,
) -> Result<(), SearchError> {
    if batch.is_empty() {
        return Ok(());
    }
    let writer = ensure_writer(writer, index)?;
    for (key, probe, file) in prepare_parallel(std::mem::take(batch)) {
        let Some(file) = file else {
            continue;
        };
        let before = graph_state(transaction, &key)?;
        if apply_prepared(root, index, writer, transaction, &key, probe, file)? {
            *graph_changed |= before != graph_state(transaction, &key)?;
            *pending += 1;
            timeline_paths.push(key);
        }
    }
    Ok(())
}

fn prepare_parallel(batch: Vec<PendingPrepare>) -> Vec<(String, Probe, Option<PreparedFile>)> {
    let workers = thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(1, 8)
        .min(batch.len().max(1));
    if batch.len() < 2 || workers == 1 {
        return batch.into_iter().map(prepare_one).collect();
    }

    let chunk_len = batch.len().div_ceil(workers);
    let mut remaining = batch;
    let mut chunks = Vec::with_capacity(workers);
    while !remaining.is_empty() {
        let take = chunk_len.min(remaining.len());
        chunks.push(remaining.drain(..take).collect::<Vec<_>>());
    }

    thread::scope(|scope| {
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|chunk| {
                scope.spawn(move || chunk.into_iter().map(prepare_one).collect::<Vec<_>>())
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    })
}

fn prepare_one(item: PendingPrepare) -> (String, Probe, Option<PreparedFile>) {
    let PendingPrepare { key, probe, path } = item;
    let prepared = prepare_file(path, probe.fingerprint);
    (key, probe, prepared)
}

fn remove_stale(
    index: &SearchIndex,
    writer: &mut Option<IndexWriter>,
    transaction: &Transaction<'_>,
    known: &HashMap<PathKey, FileState>,
    progress: &IndexProgress,
    timeline_paths: &mut Vec<String>,
    graph_changed: &mut bool,
) -> Result<bool, SearchError> {
    let mut cursor = String::new();
    let mut changed = false;
    loop {
        let paths = metadata::paths_after(transaction, &cursor, COMMIT_BATCH_SIZE)?;
        let Some(last) = paths.last() else { break };
        cursor = last.clone();
        let mut removed = 0;
        for path in paths {
            if !known.contains_key(&metadata::key(&path)) {
                continue;
            }
            let before = graph_state(transaction, &path)?;
            ensure_writer(writer, index)?
                .delete_term(Term::from_field_text(index.fields.id, &path));
            wiki::remove_document(transaction, Path::new(&path))?;
            fields::remove_document(transaction, Path::new(&path))?;
            tasks::remove_document(transaction, Path::new(&path))?;
            events::remove_document(transaction, Path::new(&path))?;
            transaction.execute("DELETE FROM documents WHERE path=?1", params![path])?;
            *graph_changed |= before != graph_state(transaction, &path)?;
            timeline_paths.push(path);
            removed += 1;
        }
        if removed > 0 {
            changed = true;
            commit(writer, index, progress)?;
        }
    }
    Ok(changed)
}

fn commit(
    writer: &mut Option<IndexWriter>,
    index: &SearchIndex,
    progress: &IndexProgress,
) -> Result<(), SearchError> {
    let Some(writer) = writer.as_mut() else {
        return Ok(());
    };
    writer.commit()?;
    progress.committed(index.reload()?);
    Ok(())
}

fn graph_state(connection: &Connection, path: &str) -> Result<[u8; 32], SearchError> {
    let mut hash = blake3::Hasher::new();
    if let Some(document) = connection
        .query_row(
            "SELECT path, relative_key, title_key FROM wiki_documents WHERE path=?1",
            [path],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
    {
        for value in [document.0, document.1, document.2] {
            hash_graph_value(&mut hash, &value);
        }
    }
    for query in [
        "SELECT DISTINCT target_key, target_kind, link_type FROM wiki_links WHERE source_path=?1 ORDER BY target_key, target_kind, link_type",
        "SELECT key_lower, text, COALESCE(items, '') FROM note_fields WHERE path=?1 AND key_lower IN ('parent', 'related', 'depends_on', 'blocks') ORDER BY ordinal",
    ] {
        let mut statement = connection.prepare(query)?;
        let rows = statement.query_map([path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (first, second, third) = row?;
            hash_graph_value(&mut hash, &first);
            hash_graph_value(&mut hash, &second);
            hash_graph_value(&mut hash, &third);
        }
    }
    Ok(*hash.finalize().as_bytes())
}

fn hash_graph_value(hash: &mut blake3::Hasher, value: &str) {
    hash.update(&(value.len() as u64).to_le_bytes());
    hash.update(value.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::{graph_state, IndexSynchronizer, ScanPlan};
    use crate::search::index::SearchIndex;
    use crate::search::progress::IndexProgress;
    use std::collections::HashSet;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn graph_state_ignores_body_edits_but_tracks_links_and_note_identity() {
        let directory = tempfile::tempdir().unwrap();
        let connection =
            crate::search::metadata::open(&directory.path().join("metadata.sqlite3")).unwrap();
        let root = std::path::Path::new("C:/vault");
        let path = root.join("Source.md");
        let mut connection = connection;
        let transaction = connection.transaction().unwrap();
        crate::search::wiki::index_document(&transaction, root, &path, "body [[Target]]").unwrap();
        crate::search::fields::index_document(&transaction, &path, "body [[Target]]").unwrap();
        transaction.commit().unwrap();
        let original = graph_state(&connection, &path.to_string_lossy()).unwrap();

        let transaction = connection.transaction().unwrap();
        crate::search::wiki::index_document(&transaction, root, &path, "edited [[Target]]")
            .unwrap();
        crate::search::fields::index_document(&transaction, &path, "edited [[Target]]").unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            graph_state(&connection, &path.to_string_lossy()).unwrap(),
            original
        );

        let transaction = connection.transaction().unwrap();
        crate::search::wiki::index_document(&transaction, root, &path, "edited [[Other]]").unwrap();
        transaction.commit().unwrap();
        let relinked = graph_state(&connection, &path.to_string_lossy()).unwrap();
        assert_ne!(relinked, original);

        let renamed = root.join("Renamed.md");
        let transaction = connection.transaction().unwrap();
        crate::search::wiki::remove_document(&transaction, &path).unwrap();
        crate::search::wiki::index_document(&transaction, root, &renamed, "edited [[Other]]")
            .unwrap();
        transaction.commit().unwrap();
        assert_ne!(
            graph_state(&connection, &renamed.to_string_lossy()).unwrap(),
            relinked
        );
    }

    #[test]
    fn the_writer_lives_only_while_there_is_something_to_write() {
        let directory = tempfile::tempdir().unwrap();
        let vault = crate::search::paths::canonical_path(directory.path()).join("vault");
        fs::create_dir_all(&vault).unwrap();
        let note = vault.join("Заметка.md");
        fs::write(&note, "первое слово").unwrap();
        let metadata_path = directory.path().join("documents.sqlite3");
        let index = Arc::new(SearchIndex::open(&directory.path().join("index")).unwrap());
        let mut synchronizer = IndexSynchronizer::new(
            vault.clone(),
            Arc::clone(&index),
            &metadata_path,
            Arc::new(IndexProgress::new(0, 1)),
        )
        .unwrap();
        let cancelled = AtomicBool::new(false);
        assert!(!synchronizer.holds_writer(), "открытие не создаёт писателя");

        synchronizer.full_scan(&cancelled).unwrap();
        let timeline_connection = rusqlite::Connection::open(&metadata_path).unwrap();
        assert_eq!(
            super::super::graph::timeline::rescan_epoch(&timeline_connection).unwrap(),
            1
        );
        let initial_latest = super::super::graph::timeline::range(&timeline_connection)
            .unwrap()
            .latest_event;
        assert!(initial_latest > 0, "индексация заметки записала дельту");
        assert!(
            synchronizer.holds_writer(),
            "новая заметка записана писателем"
        );
        synchronizer.release_writer().unwrap();
        assert!(!synchronizer.holds_writer());
        drop(
            index
                .index
                .writer::<tantivy::TantivyDocument>(15_000_000)
                .expect("блокировка индекса отпущена"),
        );

        synchronizer.full_scan(&cancelled).unwrap();
        assert_eq!(
            super::super::graph::timeline::rescan_epoch(&timeline_connection).unwrap(),
            2
        );
        assert!(
            !synchronizer.holds_writer(),
            "неизменённая база писателя не создаёт"
        );
        assert_eq!(
            super::super::graph::timeline::range(&timeline_connection)
                .unwrap()
                .latest_event,
            initial_latest,
            "повторная индексация не создаёт новую дельту"
        );

        let graph_revision = index.graph_revision();
        fs::write(&note, "второе слово").unwrap();
        synchronizer
            .apply_paths(HashSet::from([note.clone()]))
            .unwrap();
        assert_eq!(index.graph_revision(), graph_revision);

        fs::write(&note, "второе слово [[Target]]").unwrap();
        synchronizer.apply_paths(HashSet::from([note])).unwrap();
        assert!(index.graph_revision() > graph_revision);
        assert!(synchronizer.holds_writer());
        assert!(
            !index.search_defaults("второе", 5).unwrap().1.is_empty(),
            "правка видна поиску сразу"
        );
        assert!(
            super::super::graph::timeline::range(&timeline_connection)
                .unwrap()
                .latest_event
                > initial_latest,
            "изменение ссылок записано в историю графа"
        );
    }

    fn open_synchronizer(
        directory: &std::path::Path,
        index: &Arc<SearchIndex>,
    ) -> (std::path::PathBuf, IndexSynchronizer) {
        let vault = crate::search::paths::canonical_path(directory).join("vault");
        fs::create_dir_all(&vault).unwrap();
        let synchronizer = IndexSynchronizer::new(
            vault.clone(),
            Arc::clone(index),
            &directory.join("documents.sqlite3"),
            Arc::new(IndexProgress::new(0, 1)),
        )
        .unwrap();
        (vault, synchronizer)
    }

    #[test]
    fn clean_state_plans_ready_and_verifies_without_changes() {
        let directory = tempfile::tempdir().unwrap();
        let index = Arc::new(SearchIndex::open(&directory.path().join("index")).unwrap());
        let (vault, mut synchronizer) = open_synchronizer(directory.path(), &index);
        fs::write(vault.join("Заметка.md"), "первое слово").unwrap();
        fs::write(vault.join("Вторая.md"), "второе слово").unwrap();
        let cancelled = AtomicBool::new(false);

        assert_eq!(
            synchronizer.plan().unwrap(),
            ScanPlan::Full,
            "первый запуск не имеет подтверждённого состояния"
        );
        let summary = synchronizer.full_scan(&cancelled).unwrap();
        assert!(summary.changed);
        synchronizer.finish_scan(summary.max_mtime_ns).unwrap();

        assert_eq!(synchronizer.plan().unwrap(), ScanPlan::Ready);
        let summary = synchronizer.verify(&cancelled).unwrap();
        assert!(!summary.changed, "неизменённый vault не даёт работы");
        assert_eq!(synchronizer.plan().unwrap(), ScanPlan::Ready);
    }

    #[test]
    fn verify_after_ready_applies_the_changed_file() {
        let directory = tempfile::tempdir().unwrap();
        let index = Arc::new(SearchIndex::open(&directory.path().join("index")).unwrap());
        let (vault, mut synchronizer) = open_synchronizer(directory.path(), &index);
        let note = vault.join("Заметка.md");
        fs::write(&note, "первое слово").unwrap();
        let cancelled = AtomicBool::new(false);
        let summary = synchronizer.full_scan(&cancelled).unwrap();
        synchronizer.finish_scan(summary.max_mtime_ns).unwrap();
        assert_eq!(synchronizer.plan().unwrap(), ScanPlan::Ready);

        fs::write(&note, "изменённое содержимое").unwrap();
        let summary = synchronizer.verify(&cancelled).unwrap();

        assert!(summary.changed, "сверка нашла изменённый файл");
        assert!(
            !index.search_defaults("изменённое", 5).unwrap().1.is_empty(),
            "найденное изменение применено к индексу"
        );
    }

    #[test]
    fn a_scanned_note_fills_the_event_table_and_a_deletion_clears_it() {
        let directory = tempfile::tempdir().unwrap();
        let index = Arc::new(SearchIndex::open(&directory.path().join("index")).unwrap());
        let (vault, mut synchronizer) = open_synchronizer(directory.path(), &index);
        let note = vault.join("Планёрка.md");
        fs::write(
            &note,
            "---\ndate: 2026-10-07 09:30\n---\n- созвон @2026-10-07 14:15\n",
        )
        .unwrap();
        let cancelled = AtomicBool::new(false);
        let summary = synchronizer.full_scan(&cancelled).unwrap();
        synchronizer.finish_scan(summary.max_mtime_ns).unwrap();

        let connection =
            crate::search::metadata::open(&directory.path().join("documents.sqlite3")).unwrap();
        let found = crate::search::events::list_month(&connection, 2026, 10).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].title, "Планёрка");
        assert_eq!(found[0].time.as_deref(), Some("09:30"));
        assert_eq!(found[1].title, "созвон");
        assert_eq!(found[1].time.as_deref(), Some("14:15"));

        fs::remove_file(&note).unwrap();
        synchronizer
            .apply_paths(HashSet::from([note.clone()]))
            .unwrap();
        let found = crate::search::events::list_month(&connection, 2026, 10).unwrap();
        assert!(found.is_empty(), "удалённая заметка не оставляет событий");
    }

    #[test]
    fn broken_state_plans_a_full_scan() {
        let directory = tempfile::tempdir().unwrap();
        let index = Arc::new(SearchIndex::open(&directory.path().join("index")).unwrap());
        let (vault, mut synchronizer) = open_synchronizer(directory.path(), &index);
        fs::write(vault.join("Заметка.md"), "первое слово").unwrap();
        let cancelled = AtomicBool::new(false);
        let summary = synchronizer.full_scan(&cancelled).unwrap();
        synchronizer.finish_scan(summary.max_mtime_ns).unwrap();
        assert_eq!(synchronizer.plan().unwrap(), ScanPlan::Ready);

        let connection =
            crate::search::metadata::open(&directory.path().join("documents.sqlite3")).unwrap();
        crate::search::metadata::mark_unclean(&connection).unwrap();
        assert_eq!(
            synchronizer.plan().unwrap(),
            ScanPlan::Full,
            "аварийное завершение требует полного скана"
        );

        connection
            .execute(
                "UPDATE index_state SET clean_shutdown=1, scan_completed_ns=0",
                [],
            )
            .unwrap();
        assert_eq!(
            synchronizer.plan().unwrap(),
            ScanPlan::Verify,
            "без записи о завершённом скане сначала идёт сверка"
        );

        connection
            .execute(
                "UPDATE index_state SET clean_shutdown=1, analyzer_version=0",
                [],
            )
            .unwrap();
        assert_eq!(
            synchronizer.plan().unwrap(),
            ScanPlan::Full,
            "другая версия анализатора требует полного скана"
        );

        connection
            .execute(
                "UPDATE index_state SET analyzer_version=?1, scan_completed_ns=1",
                [crate::search::ANALYZER_VERSION],
            )
            .unwrap();
        assert_eq!(synchronizer.plan().unwrap(), ScanPlan::Ready);
        connection
            .execute(
                "INSERT INTO documents(path, modified_ns, size, content_hash) VALUES('C:/чужой.md', 1, 1, x'00')",
                [],
            )
            .unwrap();
        assert_eq!(
            synchronizer.plan().unwrap(),
            ScanPlan::Full,
            "расхождение числа документов требует полного скана"
        );
    }
}
