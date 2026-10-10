use crate::search::error::SearchError;
use crate::search::graph::layout::Options;
use crate::search::graph::snapshot::RenderSnapshot;
use crate::search::{fields, wiki};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct NoteState {
    pub path: String,
    pub relative_key: String,
    pub title_key: String,
    pub created_ns: i64,
    pub modified_ns: i64,
    pub links: Vec<LinkState>,
    pub structural_links: Vec<StructuralLinkState>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct LinkState {
    pub target_key: String,
    pub target_kind: String,
    pub link_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct StructuralLinkState {
    pub field: String,
    pub target: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub event_id: i64,
    pub at_ns: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRange {
    pub baseline_event: i64,
    pub baseline_at_ns: i64,
    pub latest_event: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NoteChange {
    pub path: String,
    pub state: Option<NoteState>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimelineChangeBatch {
    pub event_id: i64,
    pub changes: Vec<NoteChange>,
}

pub fn open_schema(connection: &Connection) -> Result<(), SearchError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS graph_timeline_events (
           event_id INTEGER PRIMARY KEY AUTOINCREMENT,
           at_ns INTEGER NOT NULL,
           path TEXT NOT NULL,
           state TEXT
         );
         CREATE INDEX IF NOT EXISTS graph_timeline_events_path
           ON graph_timeline_events(path, event_id DESC);
         CREATE TABLE IF NOT EXISTS graph_timeline_meta (
           key TEXT PRIMARY KEY NOT NULL,
           value INTEGER NOT NULL
         ) WITHOUT ROWID;
         INSERT OR IGNORE INTO graph_timeline_meta(key, value) VALUES('rescan_epoch', 0);",
    )?;
    Ok(())
}

pub fn ensure_baseline(connection: &mut Connection) -> Result<(), SearchError> {
    let transaction = connection.transaction()?;
    if transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM graph_timeline_meta WHERE key='baseline_at_ns')",
        [],
        |row| row.get::<_, bool>(0),
    )? {
        transaction.rollback()?;
        return Ok(());
    }

    let at_ns = now_ns();
    transaction.execute(
        "INSERT INTO graph_timeline_meta(key, value) VALUES('baseline_at_ns', ?1)",
        [at_ns],
    )?;
    let paths = {
        let mut statement = transaction.prepare("SELECT path FROM wiki_documents ORDER BY path")?;
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        paths
    };
    for path in paths {
        record_note(&transaction, &path, at_ns)?;
    }
    transaction.execute(
        "INSERT INTO graph_timeline_meta(key, value) VALUES('baseline_event',
         COALESCE((SELECT MAX(event_id) FROM graph_timeline_events), 0))",
        [],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn range(connection: &Connection) -> Result<TimelineRange, SearchError> {
    Ok(TimelineRange {
        baseline_event: connection.query_row(
            "SELECT value FROM graph_timeline_meta WHERE key='baseline_event'",
            [],
            |row| row.get(0),
        )?,
        baseline_at_ns: connection.query_row(
            "SELECT value FROM graph_timeline_meta WHERE key='baseline_at_ns'",
            [],
            |row| row.get(0),
        )?,
        latest_event: connection.query_row(
            "SELECT COALESCE(MAX(event_id), 0) FROM graph_timeline_events",
            [],
            |row| row.get(0),
        )?,
    })
}

pub fn rescan_epoch(connection: &Connection) -> Result<i64, SearchError> {
    connection
        .query_row(
            "SELECT value FROM graph_timeline_meta WHERE key='rescan_epoch'",
            [],
            |row| row.get(0),
        )
        .map_err(SearchError::from)
}

pub fn mark_rescan(transaction: &Transaction<'_>) -> Result<(), SearchError> {
    transaction.execute(
        "UPDATE graph_timeline_meta SET value = value + 1 WHERE key='rescan_epoch'",
        [],
    )?;
    Ok(())
}

pub fn record_changes(transaction: &Transaction<'_>, paths: &[String]) -> Result<(), SearchError> {
    let latest = transaction.query_row(
        "SELECT COALESCE(MAX(at_ns), 0) FROM graph_timeline_events",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let at_ns = now_ns().max(latest.saturating_add(1));
    let mut paths = paths.to_vec();
    paths.sort_unstable();
    paths.dedup();
    for path in paths {
        record_note(transaction, &path, at_ns)?;
    }
    Ok(())
}

pub fn events(
    connection: &Connection,
    after: i64,
    limit: usize,
) -> Result<Vec<TimelineEvent>, SearchError> {
    let after = after.max(range(connection)?.baseline_event);
    let mut statement = connection.prepare(
        "SELECT MAX(event_id), at_ns FROM graph_timeline_events
         WHERE event_id > ?1 GROUP BY at_ns ORDER BY MAX(event_id) LIMIT ?2",
    )?;
    let rows = statement.query_map(params![after, limit.min(10_000) as i64], |row| {
        Ok(TimelineEvent {
            event_id: row.get(0)?,
            at_ns: row.get(1)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn changes_after(
    connection: &Connection,
    cursor: i64,
) -> Result<Option<Vec<TimelineChangeBatch>>, SearchError> {
    let range = range(connection)?;
    if cursor < range.baseline_event || cursor > range.latest_event {
        return Ok(None);
    }
    if cursor == range.latest_event {
        return Ok(Some(Vec::new()));
    }
    if cursor > range.baseline_event {
        let split_group = connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM graph_timeline_events current
               JOIN graph_timeline_events later ON later.at_ns = current.at_ns
               WHERE current.event_id = ?1 AND later.event_id > ?1
             )",
            [cursor],
            |row| row.get::<_, bool>(0),
        )?;
        if split_group {
            return Ok(None);
        }
    }

    let mut statement = connection.prepare(
        "SELECT event_id, at_ns, path, state FROM graph_timeline_events
         WHERE event_id > ?1 ORDER BY event_id",
    )?;
    let rows = statement.query_map([cursor], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut groups = BTreeMap::<i64, (i64, BTreeMap<String, Option<NoteState>>)>::new();
    let mut expected_id = cursor + 1;
    for row in rows {
        let (event_id, at_ns, path, state) = row?;
        if event_id != expected_id {
            return Ok(None);
        }
        expected_id += 1;
        let state = state
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| SearchError::task(error.to_string()))?;
        let group = groups.entry(at_ns).or_default();
        group.0 = event_id;
        group.1.insert(path, state);
    }
    if expected_id - 1 != range.latest_event {
        return Ok(None);
    }
    Ok(Some(
        groups
            .into_values()
            .map(|(event_id, changes)| TimelineChangeBatch {
                event_id,
                changes: changes
                    .into_iter()
                    .map(|(path, state)| NoteChange { path, state })
                    .collect(),
            })
            .collect(),
    ))
}

pub fn state_at(connection: &Connection, event_id: i64) -> Result<Vec<NoteState>, SearchError> {
    let mut statement = connection.prepare(
        "SELECT state FROM (
           SELECT state, ROW_NUMBER() OVER(PARTITION BY path ORDER BY event_id DESC) AS rank
           FROM graph_timeline_events WHERE event_id <= ?1
         ) WHERE rank=1 AND state IS NOT NULL",
    )?;
    let rows = statement.query_map([event_id], |row| row.get::<_, String>(0))?;
    rows.map(|row| {
        serde_json::from_str(&row?).map_err(|error| SearchError::task(error.to_string()))
    })
    .collect()
}

pub fn snapshot_at(
    connection: &Connection,
    root: &Path,
    event_id: i64,
    cached_positions: &HashMap<String, (f32, f32)>,
    options: Options,
) -> Result<RenderSnapshot, SearchError> {
    let notes = state_at(connection, event_id)?;
    let snapshot_connection = Connection::open_in_memory()?;
    snapshot_connection.execute_batch(
        "CREATE TABLE documents (
           path TEXT PRIMARY KEY, modified_ns INTEGER NOT NULL, size INTEGER NOT NULL,
           content_hash BLOB NOT NULL, analyzer_version INTEGER NOT NULL,
           created_ns INTEGER NOT NULL, created_source INTEGER NOT NULL
         ) WITHOUT ROWID;",
    )?;
    wiki::open_schema(&snapshot_connection)?;
    fields::open_schema(&snapshot_connection)?;
    let transaction = snapshot_connection.unchecked_transaction()?;
    for note in notes {
        transaction.execute(
            "INSERT INTO documents(path, modified_ns, size, content_hash, analyzer_version, created_ns, created_source)
             VALUES(?1, ?2, 0, x'', 0, ?3, 0)",
            params![note.path, note.modified_ns, note.created_ns],
        )?;
        transaction.execute(
            "INSERT INTO wiki_documents(path, relative_key, title_key) VALUES(?1, ?2, ?3)",
            params![note.path, note.relative_key, note.title_key],
        )?;
        for (offset, link) in note.links.iter().enumerate() {
            transaction.execute(
                "INSERT INTO wiki_links(source_path, target_key, target_kind, byte_offset, offset_utf16, link_type)
                 VALUES(?1, ?2, ?3, ?4, ?4, ?5)",
                params![note.path, link.target_key, link.target_kind, offset as i64, link.link_type],
            )?;
        }
        for (ordinal, link) in note.structural_links.iter().enumerate() {
            transaction.execute(
                "INSERT INTO note_fields(path, ordinal, key, key_lower, kind, text, text_lower, items)
                 VALUES(?1, ?2, ?3, ?3, 1, ?4, ?4, NULL)",
                params![note.path, ordinal as i64, link.field, link.target],
            )?;
        }
    }
    transaction.commit()?;
    RenderSnapshot::build_with_layout(&snapshot_connection, root, cached_positions, options)
}

fn record_note(connection: &Connection, path: &str, at_ns: i64) -> Result<(), SearchError> {
    let state = read_note(connection, path)?;
    let previous = connection
        .query_row(
            "SELECT state FROM graph_timeline_events WHERE path=?1 ORDER BY event_id DESC LIMIT 1",
            [path],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    let previous_state = previous
        .map(|state| {
            state
                .map(|state| serde_json::from_str::<NoteState>(&state))
                .transpose()
        })
        .transpose()
        .map_err(|error| SearchError::task(error.to_string()))?;
    if previous_state == Some(state.clone()) {
        return Ok(());
    }
    let Some(state) = state else {
        connection.execute(
            "INSERT INTO graph_timeline_events(at_ns, path, state) VALUES(?1, ?2, NULL)",
            params![at_ns, path],
        )?;
        return Ok(());
    };
    let state =
        serde_json::to_string(&state).map_err(|error| SearchError::task(error.to_string()))?;
    connection.execute(
        "INSERT INTO graph_timeline_events(at_ns, path, state) VALUES(?1, ?2, ?3)",
        params![at_ns, path, state],
    )?;
    Ok(())
}

fn read_note(connection: &Connection, path: &str) -> Result<Option<NoteState>, SearchError> {
    let mut statement = connection.prepare(
        "SELECT wiki_documents.relative_key, wiki_documents.title_key,
                COALESCE(documents.created_ns, 0), COALESCE(documents.modified_ns, 0)
         FROM wiki_documents LEFT JOIN documents ON documents.path=wiki_documents.path
         WHERE wiki_documents.path=?1",
    )?;
    let mut rows = statement.query([path])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let mut state = NoteState {
        path: path.to_owned(),
        relative_key: row.get(0)?,
        title_key: row.get(1)?,
        created_ns: row.get(2)?,
        modified_ns: row.get(3)?,
        links: Vec::new(),
        structural_links: Vec::new(),
    };
    drop(rows);
    drop(statement);

    let mut statement = connection.prepare(
        "SELECT target_key, target_kind, link_type FROM wiki_links
         WHERE source_path=?1 ORDER BY byte_offset",
    )?;
    state.links = statement
        .query_map([path], |row| {
            Ok(LinkState {
                target_key: row.get(0)?,
                target_kind: row.get(1)?,
                link_type: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = connection.prepare(
        "SELECT key_lower, text, items FROM note_fields
         WHERE path=?1 AND key_lower IN ('parent', 'related', 'depends_on', 'blocks')
         ORDER BY ordinal",
    )?;
    let fields = statement.query_map([path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    for field in fields {
        let (field, text, items) = field?;
        let targets = items
            .and_then(|items| serde_json::from_str::<Vec<String>>(&items).ok())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| vec![text]);
        state
            .structural_links
            .extend(targets.into_iter().map(|target| StructuralLinkState {
                field: field.clone(),
                target,
            }));
    }
    Ok(Some(state))
}

fn now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{events, open_schema, range, record_changes, state_at};
    use crate::search::fields;
    use crate::search::wiki;
    use rusqlite::Connection;
    use std::path::Path;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE documents(path TEXT PRIMARY KEY, created_ns INTEGER, modified_ns INTEGER);",
        ).unwrap();
        wiki::open_schema(&connection).unwrap();
        fields::open_schema(&connection).unwrap();
        open_schema(&connection).unwrap();
        connection
    }

    #[test]
    fn baseline_and_deltas_reconstruct_added_updated_and_removed_notes() {
        let mut connection = database();
        let root = Path::new("C:/vault");
        let first = root.join("First.md");
        let second = root.join("Second.md");
        let transaction = connection.transaction().unwrap();
        wiki::index_document(&transaction, root, &first, "[[Second]]").unwrap();
        transaction
            .execute(
                "INSERT INTO documents VALUES(?1, 1, 1)",
                [first.to_string_lossy().as_ref()],
            )
            .unwrap();
        transaction.commit().unwrap();
        open_schema(&connection).unwrap();
        super::ensure_baseline(&mut connection).unwrap();
        let baseline = range(&connection).unwrap().baseline_event;

        let transaction = connection.transaction().unwrap();
        wiki::index_document(&transaction, root, &second, "note").unwrap();
        transaction
            .execute(
                "INSERT INTO documents VALUES(?1, 2, 2)",
                [second.to_string_lossy().as_ref()],
            )
            .unwrap();
        record_changes(&transaction, &[second.to_string_lossy().into_owned()]).unwrap();
        transaction.commit().unwrap();
        let added = events(&connection, baseline, 10).unwrap()[0].event_id;
        assert_eq!(state_at(&connection, baseline).unwrap().len(), 1);
        assert_eq!(state_at(&connection, added).unwrap().len(), 2);
        let transaction = connection.transaction().unwrap();
        record_changes(&transaction, &[second.to_string_lossy().into_owned()]).unwrap();
        transaction.commit().unwrap();
        assert_eq!(range(&connection).unwrap().latest_event, added);
        assert_eq!(range(&connection).unwrap().baseline_event, baseline);

        let transaction = connection.transaction().unwrap();
        wiki::remove_document(&transaction, &first).unwrap();
        transaction
            .execute(
                "DELETE FROM documents WHERE path=?1",
                [first.to_string_lossy().as_ref()],
            )
            .unwrap();
        record_changes(&transaction, &[first.to_string_lossy().into_owned()]).unwrap();
        transaction.commit().unwrap();
        let removed = events(&connection, added, 10).unwrap()[0].event_id;
        assert_eq!(state_at(&connection, removed).unwrap().len(), 1);
        assert_eq!(
            state_at(&connection, removed).unwrap()[0].path,
            second.to_string_lossy()
        );
    }

    #[test]
    fn changes_after_returns_atomic_note_changes_by_timestamp_and_detects_skipped_cursors() {
        let mut connection = database();
        let root = Path::new("C:/vault");
        let first = root.join("First.md");
        let second = root.join("Second.md");
        super::ensure_baseline(&mut connection).unwrap();
        let baseline = range(&connection).unwrap().baseline_event;

        let transaction = connection.transaction().unwrap();
        for path in [&first, &second] {
            wiki::index_document(&transaction, root, path, "note").unwrap();
            transaction
                .execute(
                    "INSERT INTO documents VALUES(?1, 1, 1)",
                    [path.to_string_lossy().as_ref()],
                )
                .unwrap();
        }
        record_changes(
            &transaction,
            &[
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        transaction.commit().unwrap();

        let changes = super::changes_after(&connection, baseline)
            .unwrap()
            .unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].changes.len(), 2);
        assert!(super::changes_after(&connection, baseline + 1)
            .unwrap()
            .is_none());
        assert!(super::changes_after(&connection, changes[0].event_id)
            .unwrap()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rescan_epoch_changes_only_after_the_rescan_transaction_commits() {
        let mut connection = database();
        assert_eq!(super::rescan_epoch(&connection).unwrap(), 0);
        let transaction = connection.transaction().unwrap();
        super::mark_rescan(&transaction).unwrap();
        transaction.rollback().unwrap();
        assert_eq!(super::rescan_epoch(&connection).unwrap(), 0);
        let transaction = connection.transaction().unwrap();
        super::mark_rescan(&transaction).unwrap();
        transaction.commit().unwrap();
        assert_eq!(super::rescan_epoch(&connection).unwrap(), 1);
    }

    #[test]
    fn note_state_captures_typed_wiki_and_markdown_edges() {
        let mut connection = database();
        fields::open_schema(&connection).unwrap();
        let root = Path::new("C:/vault");
        let source = root.join("Source.md");
        super::ensure_baseline(&mut connection).unwrap();
        let transaction = connection.transaction().unwrap();
        wiki::index_document(
            &transaction,
            root,
            &source,
            "[[Wiki]] [Markdown](Target.md)",
        )
        .unwrap();
        transaction
            .execute(
                "INSERT INTO documents VALUES(?1, 1, 1)",
                [source.to_string_lossy().as_ref()],
            )
            .unwrap();
        fields::index_document(
            &transaction,
            &source,
            "---\nparent: Up\ndepends_on: [One, Two]\n---\nbody",
        )
        .unwrap();
        record_changes(&transaction, &[source.to_string_lossy().into_owned()]).unwrap();
        transaction.commit().unwrap();
        let note = state_at(&connection, events(&connection, 0, 10).unwrap()[0].event_id)
            .unwrap()
            .remove(0);
        assert_eq!(
            note.links
                .iter()
                .map(|link| link.link_type.as_str())
                .collect::<Vec<_>>(),
            ["wiki", "markdown"]
        );
        assert_eq!(note.structural_links.len(), 3);
    }

    #[test]
    fn materializes_a_binary_graph_snapshot_at_a_persisted_event() {
        let mut connection = database();
        let root = Path::new("C:/vault");
        let source = root.join("Source.md");
        let target = root.join("Target.md");
        super::ensure_baseline(&mut connection).unwrap();
        let transaction = connection.transaction().unwrap();
        wiki::index_document(&transaction, root, &source, "[[Target]]").unwrap();
        wiki::index_document(&transaction, root, &target, "target").unwrap();
        for path in [&source, &target] {
            transaction
                .execute(
                    "INSERT INTO documents VALUES(?1, 1, 1)",
                    [path.to_string_lossy().as_ref()],
                )
                .unwrap();
        }
        record_changes(
            &transaction,
            &[
                source.to_string_lossy().into_owned(),
                target.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        transaction.commit().unwrap();
        let event = events(&connection, range(&connection).unwrap().baseline_event, 10).unwrap()[0]
            .event_id;
        assert_eq!(events(&connection, 0, 10).unwrap().len(), 1);

        let snapshot = super::snapshot_at(
            &connection,
            root,
            event,
            &std::collections::HashMap::new(),
            crate::search::graph::layout::Options::default(),
        )
        .unwrap();

        assert_eq!(snapshot.node_count(), 2);
        assert_eq!(snapshot.edge_count(), 1);
        assert_eq!(snapshot.edge_types, [1]);
    }
}
