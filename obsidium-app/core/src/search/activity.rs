use super::error::SearchError;
use super::service::SearchService;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTimestamp {
    pub path: String,
    pub created_ns: i64,
    pub modified_ns: i64,
}

const NOTE_TIMESTAMPS_SQL: &str =
    "SELECT path, created_ns, modified_ns FROM documents ORDER BY path";

pub fn read_note_timestamps(connection: &Connection) -> Result<Vec<NoteTimestamp>, SearchError> {
    let mut statement = connection.prepare(NOTE_TIMESTAMPS_SQL)?;
    let rows = statement.query_map([], |row| {
        Ok(NoteTimestamp {
            path: row.get(0)?,
            created_ns: row.get(1)?,
            modified_ns: row.get(2)?,
        })
    })?;
    let mut timestamps = Vec::new();
    for row in rows {
        timestamps.push(row?);
    }
    Ok(timestamps)
}

impl SearchService {
    pub fn note_timestamps(&self, workspace: &str) -> Result<Vec<NoteTimestamp>, SearchError> {
        self.with_metadata(workspace, |_open, connection| {
            read_note_timestamps(connection)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::read_note_timestamps;
    use rusqlite::Connection;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE documents (
                   path TEXT PRIMARY KEY,
                   modified_ns INTEGER NOT NULL,
                   size INTEGER NOT NULL,
                   content_hash BLOB NOT NULL,
                   analyzer_version INTEGER NOT NULL DEFAULT 0,
                   created_ns INTEGER NOT NULL DEFAULT 0,
                   created_source INTEGER NOT NULL DEFAULT 0
                 ) WITHOUT ROWID;",
            )
            .expect("documents table");
        connection
    }

    #[test]
    fn timestamps_come_back_for_every_indexed_note() {
        let connection = connection();
        connection
            .execute_batch(
                "INSERT INTO documents(path, modified_ns, size, content_hash, created_ns)
                 VALUES ('notes/b.md', 200, 1, x'00', 100),
                        ('notes/a.md', 400, 1, x'00', 0);",
            )
            .expect("rows");
        let timestamps = read_note_timestamps(&connection).expect("read");
        assert_eq!(timestamps.len(), 2);
        assert_eq!(timestamps[0].path, "notes/a.md");
        assert_eq!(timestamps[0].created_ns, 0);
        assert_eq!(timestamps[0].modified_ns, 400);
        assert_eq!(timestamps[1].path, "notes/b.md");
        assert_eq!(timestamps[1].created_ns, 100);
        assert_eq!(timestamps[1].modified_ns, 200);
    }
}
