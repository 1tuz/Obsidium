use crate::search::analyzer::frontmatter;
use crate::search::error::SearchError;
use crate::search::fields::note_fields;
use crate::search::markdown;
use crate::search::note_date;
use crate::search::service::SearchService;
use rusqlite::{params, Connection, Transaction};
use serde::Serialize;
use std::path::Path;

const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', ')', ']', '}', '»', '"', '\''];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Event {
    pub date: (i64, i64, i64),
    pub time: Option<(i64, i64)>,
    pub title: String,
    pub line: usize,
    pub byte_offset: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub path: String,
    pub date: String,
    pub time: Option<String>,
    pub title: String,
    pub line: usize,
    pub byte_offset: usize,
}

struct Marker {
    start: usize,
    end: usize,
    date: (i64, i64, i64),
    time: Option<(i64, i64)>,
}

pub fn extract_events(text: &str) -> Vec<Event> {
    let mut found = frontmatter_events(text);
    found.extend(inline_events(text));
    found
}

fn frontmatter_events(text: &str) -> Vec<Event> {
    let mut found = Vec::new();
    for field in note_fields(text) {
        if !field.key.eq_ignore_ascii_case("date") && !field.key.eq_ignore_ascii_case("event") {
            continue;
        }
        let values = if field.items.is_empty() {
            vec![field.text]
        } else {
            field.items
        };
        for value in values {
            let Some(date) = note_date::civil_date(&value) else {
                continue;
            };
            found.push(Event {
                date,
                time: note_date::clock(&value),
                title: String::new(),
                line: 0,
                byte_offset: 0,
            });
        }
    }
    found
}

fn inline_events(text: &str) -> Vec<Event> {
    let body = frontmatter::body(text);
    let body_offset = text.len() - body.len();
    let line_base = text[..body_offset].matches('\n').count();
    let starts = line_starts(body);
    let mut found = Vec::new();
    for (index, line) in markdown::lines_outside_fences(body) {
        let indent = line.len() - line.trim_start().len();
        let content = &line[indent..];
        let content = markdown::list_item_body(content).unwrap_or(content);
        let prefix = line.len() - content.len();
        let Some(marker) = marker(content) else {
            continue;
        };
        let Some(start) = starts.get(index) else {
            continue;
        };
        found.push(Event {
            date: marker.date,
            time: marker.time,
            title: line_title(content, marker.start, marker.end),
            line: line_base + index,
            byte_offset: body_offset + start + prefix + marker.start,
        });
    }
    found
}

fn line_starts(body: &str) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in body.split_inclusive('\n') {
        starts.push(offset);
        offset += line.len();
    }
    starts
}

fn marker(line: &str) -> Option<Marker> {
    let mut search = 0;
    while let Some(found) = line[search..].find('@') {
        let start = search + found;
        let after = &line[start + 1..];
        let token_end = after.find(char::is_whitespace).unwrap_or(after.len());
        let token = after[..token_end].trim_end_matches(TRAILING);
        if let Some(date) = note_date::civil_date(token) {
            let mut time = note_date::clock(token);
            let mut end = start + 1 + token_end;
            let rest = &after[token_end..];
            if time.is_none() && rest.starts_with(' ') && !rest.starts_with("  ") {
                let clock_text = &rest[1..];
                let clock_end = clock_text
                    .find(char::is_whitespace)
                    .unwrap_or(clock_text.len());
                let clock_token = clock_text[..clock_end].trim_end_matches(TRAILING);
                if let Some(parsed) = note_date::clock(&format!("{token} {clock_token}")) {
                    time = Some(parsed);
                    end = start + 1 + token_end + 1 + clock_end;
                }
            }
            return Some(Marker {
                start,
                end,
                date,
                time,
            });
        }
        search = start + 1;
    }
    None
}

fn line_title(line: &str, start: usize, end: usize) -> String {
    let before = line[..start].trim_end();
    let after = line[end..].trim_start();
    match (before.is_empty(), after.is_empty()) {
        (true, _) => after.to_owned(),
        (_, true) => before.to_owned(),
        _ => format!("{before} {after}"),
    }
}

pub fn open_schema(connection: &Connection) -> Result<(), SearchError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS note_events (
           path TEXT NOT NULL,
           ordinal INTEGER NOT NULL,
           date_ns INTEGER NOT NULL,
           time_minutes INTEGER,
           title TEXT NOT NULL,
           line INTEGER NOT NULL,
           byte_offset INTEGER NOT NULL,
           PRIMARY KEY(path, ordinal)
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS note_events_date ON note_events(date_ns);",
    )?;
    Ok(())
}

pub fn index_document(
    transaction: &Transaction<'_>,
    path: &Path,
    body: &str,
) -> Result<(), SearchError> {
    remove_document(transaction, path)?;
    let found = extract_events(body);
    if found.is_empty() {
        return Ok(());
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let path_text = path.to_string_lossy();
    let mut statement = transaction.prepare(
        "INSERT INTO note_events(path, ordinal, date_ns, time_minutes, title, line, byte_offset)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (ordinal, event) in found.iter().enumerate() {
        let (year, month, day) = event.date;
        let date_ns = note_date::from_civil(year, month, day, 0);
        let time_minutes = event.time.map(|(hour, minute)| hour * 60 + minute);
        let title = if event.title.is_empty() {
            stem
        } else {
            event.title.as_str()
        };
        statement.execute(params![
            path_text,
            ordinal as i64,
            date_ns,
            time_minutes,
            title,
            event.line as i64,
            event.byte_offset as i64,
        ])?;
    }
    Ok(())
}

pub fn remove_document(transaction: &Transaction<'_>, path: &Path) -> Result<(), SearchError> {
    transaction.execute(
        "DELETE FROM note_events WHERE path=?1",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

pub fn list_month(
    connection: &Connection,
    year: i64,
    month: i64,
) -> Result<Vec<CalendarEvent>, SearchError> {
    if !(1..=12).contains(&month) {
        return Ok(Vec::new());
    }
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let start = note_date::from_civil(year, month, 1, 0);
    let end = note_date::from_civil(next_year, next_month, 1, 0);
    let mut statement = connection.prepare(
        "SELECT path, date_ns, time_minutes, title, line, byte_offset
         FROM note_events
         WHERE date_ns >= ?1 AND date_ns < ?2
         ORDER BY date_ns, COALESCE(time_minutes, -1), path, line",
    )?;
    let rows = statement.query_map(params![start, end], |row| {
        let date_ns: i64 = row.get(1)?;
        let time_minutes: Option<i64> = row.get(2)?;
        Ok(CalendarEvent {
            path: row.get(0)?,
            date: note_date::format(date_ns),
            time: time_minutes.map(|minutes| format!("{:02}:{:02}", minutes / 60, minutes % 60)),
            title: row.get(3)?,
            line: row.get::<_, i64>(4)? as usize,
            byte_offset: row.get::<_, i64>(5)? as usize,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

impl SearchService {
    pub fn calendar_events(
        &self,
        workspace: &str,
        year: i64,
        month: i64,
    ) -> Result<Vec<CalendarEvent>, SearchError> {
        self.with_metadata(workspace, |_open, connection| {
            list_month(connection, year, month)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_events, index_document, list_month, open_schema, remove_document, CalendarEvent,
        Event,
    };
    use rusqlite::Connection;
    use std::path::Path;

    fn inline(text: &str) -> Vec<Event> {
        extract_events(text)
    }

    fn event(date: (i64, i64, i64), time: Option<(i64, i64)>, title: &str) -> Event {
        located(date, time, title, 0, 0)
    }

    fn located(
        date: (i64, i64, i64),
        time: Option<(i64, i64)>,
        title: &str,
        line: usize,
        byte_offset: usize,
    ) -> Event {
        Event {
            date,
            time,
            title: title.to_owned(),
            line,
            byte_offset,
        }
    }

    #[test]
    fn a_frontmatter_date_is_an_event() {
        let found = inline("---\ndate: 2026-10-25\n---\nBody\n");
        assert_eq!(found, vec![event((2026, 10, 25), None, "")]);
    }

    #[test]
    fn a_frontmatter_event_list_keeps_times_and_order() {
        let found = inline("---\nevent:\n  - 2026-10-25 09:30\n  - 2026-10-26T18:00\n---\nBody\n");
        assert_eq!(
            found,
            vec![
                event((2026, 10, 25), Some((9, 30)), ""),
                event((2026, 10, 26), Some((18, 0)), ""),
            ]
        );
    }

    #[test]
    fn an_inline_marker_with_a_list_marker_and_a_spaced_time() {
        let found = inline("- @2026-10-25 14:30 Позвонить маме\n");
        assert_eq!(
            found,
            vec![located(
                (2026, 10, 25),
                Some((14, 30)),
                "Позвонить маме",
                0,
                2
            )]
        );
    }

    #[test]
    fn an_inline_marker_with_an_attached_time() {
        let found = inline("Встреча @2026-10-25T09:05 с командой\n");
        assert_eq!(
            found,
            vec![located(
                (2026, 10, 25),
                Some((9, 5)),
                "Встреча с командой",
                0,
                15
            )]
        );
    }

    #[test]
    fn an_inline_marker_without_a_time() {
        let found = inline("@2026-10-25 Купить хлеб\n");
        assert_eq!(found, vec![event((2026, 10, 25), None, "Купить хлеб")]);
    }

    #[test]
    fn an_invalid_date_is_ignored() {
        assert!(inline("@2026-02-30 Сломанный день\n").is_empty());
        assert!(inline("@вчера Сломанный день\n").is_empty());
        assert!(inline("---\ndate: 2026-13-01\n---\nBody\n").is_empty());
    }

    #[test]
    fn a_marker_inside_a_fenced_block_is_ignored() {
        let text = "```\n@2026-10-25 Внутри кода\n```\n@2026-10-26 Снаружи\n";
        let found = inline(text);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Снаружи");
        assert_eq!(found[0].line, 3);
    }

    #[test]
    fn a_byte_offset_points_at_the_at_sign() {
        let text = "---\ndate: 2026-10-24\n---\nПервый\n\n@2026-10-25 Второй\n";
        let found = inline(text);
        let offset = found.last().expect("inline event").byte_offset;
        assert_eq!(&text[offset..offset + 1], "@");
        assert_eq!(found.last().expect("inline event").line, 5);
    }

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        open_schema(&connection).expect("schema");
        connection
    }

    fn index(connection: &mut Connection, path: &str, text: &str) {
        let transaction = connection.transaction().expect("transaction");
        index_document(&transaction, Path::new(path), text).expect("indexed");
        transaction.commit().expect("committed");
    }

    #[test]
    fn a_table_round_trip_fills_and_clears_the_month() {
        let mut connection = database();
        index(
            &mut connection,
            "/vault/plan.md",
            "---\ndate: 2026-10-07\n---\n- @2026-10-08 10:00 Созвон\n",
        );
        index(&mut connection, "/vault/other.md", "@2026-11-01 Ноябрь\n");

        let october = list_month(&connection, 2026, 10).expect("october");
        assert_eq!(
            october,
            vec![
                CalendarEvent {
                    path: "/vault/plan.md".to_owned(),
                    date: "2026-10-07".to_owned(),
                    time: None,
                    title: "plan".to_owned(),
                    line: 0,
                    byte_offset: 0,
                },
                CalendarEvent {
                    path: "/vault/plan.md".to_owned(),
                    date: "2026-10-08".to_owned(),
                    time: Some("10:00".to_owned()),
                    title: "Созвон".to_owned(),
                    line: 3,
                    byte_offset: 27,
                },
            ]
        );
        assert!(list_month(&connection, 2026, 13)
            .expect("bad month")
            .is_empty());

        let transaction = connection.transaction().expect("transaction");
        remove_document(&transaction, Path::new("/vault/plan.md")).expect("removed");
        transaction.commit().expect("committed");
        assert!(list_month(&connection, 2026, 10)
            .expect("october")
            .is_empty());
    }
}
