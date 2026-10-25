use super::error::SearchError;
use super::note_date;
use super::service::SearchService;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTimestamp {
    pub path: String,
    pub created_ns: i64,
    pub modified_ns: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityMeasure {
    Created,
    Modified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityNote {
    pub path: String,
    pub timestamp_ns: i64,
}

pub const DEFAULT_RECENT_CHANGES_LIMIT: usize = 20;
pub const MAX_RECENT_CHANGES_LIMIT: usize = 50;

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

pub fn notes_on_day(
    timestamps: &[NoteTimestamp],
    measure: ActivityMeasure,
    start_ns: i64,
    end_ns: i64,
) -> Vec<ActivityNote> {
    let mut notes: Vec<ActivityNote> = timestamps
        .iter()
        .filter_map(|note| {
            let stamp = measure.stamp(note);
            (stamp >= start_ns && stamp < end_ns).then(|| ActivityNote {
                path: note.path.clone(),
                timestamp_ns: stamp,
            })
        })
        .collect();
    notes.sort_by(|left, right| {
        left.timestamp_ns
            .cmp(&right.timestamp_ns)
            .then_with(|| left.path.cmp(&right.path))
    });
    notes
}

pub fn recent_changes(timestamps: &[NoteTimestamp], limit: usize) -> Vec<ActivityNote> {
    let limit = limit.clamp(1, MAX_RECENT_CHANGES_LIMIT);
    let mut ordered: Vec<ActivityNote> = timestamps
        .iter()
        .filter(|note| note.modified_ns > 0)
        .map(|note| ActivityNote {
            path: note.path.clone(),
            timestamp_ns: note.modified_ns,
        })
        .collect();
    ordered.sort_by(|left, right| {
        right
            .timestamp_ns
            .cmp(&left.timestamp_ns)
            .then_with(|| left.path.cmp(&right.path))
    });
    let mut seen = HashSet::with_capacity(limit);
    ordered.retain(|note| seen.insert(note.path.clone()));
    ordered.truncate(limit);
    ordered
}

pub fn day_bounds(day: &str) -> Result<(i64, i64), SearchError> {
    let (year, month, date) = note_date::civil_date(day).ok_or_else(|| SearchError::Query {
        message: format!("unreadable day: {day}"),
    })?;
    let (next_year, next_month, next_date) = next_day(year, month, date);
    Ok((
        note_date::from_civil(year, month, date, 0),
        note_date::from_civil(next_year, next_month, next_date, 0),
    ))
}

fn next_day(year: i64, month: i64, date: i64) -> (i64, i64, i64) {
    if date < note_date::days_in_month(year, month) {
        (year, month, date + 1)
    } else if month < 12 {
        (year, month + 1, 1)
    } else {
        (year + 1, 1, 1)
    }
}

impl ActivityMeasure {
    fn stamp(self, note: &NoteTimestamp) -> i64 {
        match self {
            Self::Created => note.created_ns,
            Self::Modified => note.modified_ns,
        }
    }
}

impl SearchService {
    pub fn note_timestamps(&self, workspace: &str) -> Result<Vec<NoteTimestamp>, SearchError> {
        self.with_metadata(workspace, |_open, connection| {
            read_note_timestamps(connection)
        })
    }

    pub fn notes_on_day(
        &self,
        workspace: &str,
        day: &str,
        measure: ActivityMeasure,
        tz_offset_minutes: i64,
    ) -> Result<Vec<ActivityNote>, SearchError> {
        note_date::set_local_offset(tz_offset_minutes * 60);
        let (start_ns, end_ns) = day_bounds(day)?;
        let timestamps = self.note_timestamps(workspace)?;
        Ok(notes_on_day(&timestamps, measure, start_ns, end_ns))
    }

    pub fn recent_changes(
        &self,
        workspace: &str,
        limit: Option<usize>,
    ) -> Result<Vec<ActivityNote>, SearchError> {
        let limit = limit.unwrap_or(DEFAULT_RECENT_CHANGES_LIMIT);
        let timestamps = self.note_timestamps(workspace)?;
        Ok(recent_changes(&timestamps, limit))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        day_bounds, notes_on_day, read_note_timestamps, recent_changes, ActivityMeasure,
        ActivityNote, NoteTimestamp, MAX_RECENT_CHANGES_LIMIT,
    };
    use crate::search::note_date;
    use rusqlite::Connection;

    const DAY: i64 = 86_400 * 1_000_000_000;

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

    fn note(path: &str, created_ns: i64, modified_ns: i64) -> NoteTimestamp {
        NoteTimestamp {
            path: path.to_owned(),
            created_ns,
            modified_ns,
        }
    }

    fn paths(notes: &[ActivityNote]) -> Vec<&str> {
        notes.iter().map(|note| note.path.as_str()).collect()
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

    #[test]
    fn a_day_lists_the_notes_it_created_and_the_notes_it_modified() {
        let day = "2026-09-20";
        let (start, _) = day_bounds(day).expect("day bounds");
        let timestamps = [
            note("a.md", start + 60, start + 40 * DAY),
            note("b.md", start + DAY - 60, start + 90),
            note("c.md", start + 41 * DAY, start + 30),
            note("d.md", 0, 0),
        ];

        let created = notes_on_day(&timestamps, ActivityMeasure::Created, start, start + DAY);
        assert_eq!(paths(&created), ["a.md", "b.md"]);
        assert_eq!(created[0].timestamp_ns, start + 60);
        assert_eq!(created[1].timestamp_ns, start + DAY - 60);

        let modified = notes_on_day(&timestamps, ActivityMeasure::Modified, start, start + DAY);
        assert_eq!(paths(&modified), ["c.md", "b.md"]);
        assert_eq!(modified[0].timestamp_ns, start + 30);
        assert_eq!(modified[1].timestamp_ns, start + 90);
    }

    #[test]
    fn a_day_without_notes_comes_back_empty() {
        let (start, end) = day_bounds("2026-09-20").expect("day bounds");
        let timestamps = [note("a.md", start - 10, start - 10), note("b.md", end, end)];
        assert!(notes_on_day(&timestamps, ActivityMeasure::Created, start, end).is_empty());
        assert!(notes_on_day(&timestamps, ActivityMeasure::Modified, start, end).is_empty());
    }

    #[test]
    fn an_unreadable_day_is_rejected() {
        assert!(day_bounds("2026-02-30").is_err());
        assert!(day_bounds("not a day").is_err());
    }

    #[test]
    fn the_day_bounds_span_exactly_that_civil_day() {
        note_date::set_local_offset(3 * 3600);
        let (start, end) = day_bounds("2026-12-31").expect("day bounds");
        assert_eq!(end - start, DAY);
        assert_eq!(note_date::format(start), "2026-12-31");
        assert_eq!(note_date::format(end), "2027-01-01");
    }

    #[test]
    fn the_measure_keeps_the_names_the_frontend_sends() {
        assert_eq!(
            serde_json::to_string(&ActivityMeasure::Created).expect("serialized"),
            "\"created\""
        );
        assert_eq!(
            serde_json::to_string(&ActivityMeasure::Modified).expect("serialized"),
            "\"modified\""
        );
        assert_eq!(
            serde_json::from_str::<ActivityMeasure>("\"modified\"").expect("deserialized"),
            ActivityMeasure::Modified
        );
    }

    #[test]
    fn recent_changes_are_newest_first_without_repeated_paths() {
        let timestamps = [
            note("old.md", 10, 100),
            note("new.md", 20, 400),
            note("middle.md", 30, 200),
            note("never-modified.md", 50, 0),
        ];
        let feed = recent_changes(&timestamps, 10);
        assert_eq!(paths(&feed), ["new.md", "middle.md", "old.md"]);
        assert_eq!(feed[0].timestamp_ns, 400);
        let mut unique = feed
            .iter()
            .map(|note| note.path.as_str())
            .collect::<Vec<_>>();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), feed.len());
    }

    #[test]
    fn recent_changes_keep_at_most_the_limit_and_never_more_than_fifty() {
        let timestamps: Vec<NoteTimestamp> = (0..80)
            .map(|index| note(&format!("note-{index:02}.md"), 0, index + 1))
            .collect();
        assert_eq!(recent_changes(&timestamps, 3).len(), 3);
        assert_eq!(
            recent_changes(&timestamps, 0).len(),
            1,
            "the limit stays usable"
        );
        assert_eq!(
            recent_changes(&timestamps, MAX_RECENT_CHANGES_LIMIT + 40).len(),
            MAX_RECENT_CHANGES_LIMIT
        );
        let feed = recent_changes(&timestamps, 3);
        assert_eq!(paths(&feed), ["note-79.md", "note-78.md", "note-77.md"]);
    }
}
