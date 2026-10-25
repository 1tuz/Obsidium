use crate::search::error::SearchError;
use crate::search::wiki;
use crate::search::wiki::parser;
use crate::search::wiki::target::pick_candidate;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_STALE_DAYS: u64 = 90;
pub const MAX_STALE_DAYS: u64 = 3650;
pub const MAX_UNUSED_TAGS: usize = 100;
const NS_PER_DAY: i64 = 86_400_000_000_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    pub source_path: String,
    pub source_title: String,
    pub target: String,
    pub line: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportNote {
    pub path: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleNote {
    pub path: String,
    pub title: String,
    pub modified_ns: i64,
    pub days: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedTag {
    pub tag: String,
    pub note_count: u64,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedTagSection {
    pub tags: Vec<UnusedTag>,
    pub total: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeReport {
    pub broken_links: Vec<BrokenLink>,
    pub isolated_notes: Vec<ReportNote>,
    pub stale_notes: Vec<StaleNote>,
    pub unused_tags: UnusedTagSection,
    pub stale_after_days: u64,
    pub indexed_documents: u64,
    pub indexing: bool,
}

pub fn stale_after_days(value: Option<u64>) -> u64 {
    value
        .filter(|days| *days > 0)
        .unwrap_or(DEFAULT_STALE_DAYS)
        .min(MAX_STALE_DAYS)
}

pub fn now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| i64::try_from(value.as_nanos()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

pub fn build(
    connection: &Connection,
    root: &Path,
    stale_after_days: u64,
    now_ns: i64,
    indexing: bool,
) -> Result<KnowledgeReport, SearchError> {
    let documents = wiki::read_documents(connection)?;
    let mut by_title = HashMap::<&str, Vec<&str>>::new();
    let mut by_relative = HashMap::<&str, Vec<&str>>::new();
    let mut known = HashSet::<&str>::new();
    for document in &documents {
        by_title
            .entry(document.title_key.as_str())
            .or_default()
            .push(document.path.as_str());
        by_relative
            .entry(document.relative_key.as_str())
            .or_default()
            .push(document.path.as_str());
        known.insert(document.path.as_str());
    }

    let mut connected = HashSet::<String>::new();
    let mut broken_links = Vec::new();
    let mut texts = HashMap::<String, Option<String>>::new();
    let mut statement = connection.prepare(
        "SELECT source_path, target_key, target_kind, byte_offset FROM wiki_links
         ORDER BY source_path, byte_offset",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    for row in rows {
        let (source, key, kind, byte_offset) = row?;
        let candidates = if kind == "path" {
            by_relative.get(key.as_str())
        } else {
            by_title.get(key.as_str())
        };
        let resolved = candidates
            .and_then(|paths| pick_candidate(root, Path::new(&source), paths))
            .map(str::to_owned);
        match resolved {
            Some(target) => {
                if target != source {
                    connected.insert(source);
                    connected.insert(target);
                }
            }
            None => {
                let text = texts
                    .entry(source.clone())
                    .or_insert_with(|| read_text(&source));
                let offset = usize::try_from(byte_offset).unwrap_or(usize::MAX);
                let target = text
                    .as_deref()
                    .and_then(|body| raw_target(body, offset))
                    .unwrap_or(key);
                let line = text
                    .as_deref()
                    .map(|body| line_at(body, offset))
                    .unwrap_or(1);
                broken_links.push(BrokenLink {
                    source_title: title(&source),
                    source_path: source,
                    target,
                    line,
                });
            }
        }
    }

    broken_links.sort_by(|left, right| {
        left.source_title
            .to_lowercase()
            .cmp(&right.source_title.to_lowercase())
            .then_with(|| left.source_path.cmp(&right.source_path))
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.target.cmp(&right.target))
    });

    let mut isolated_notes = documents
        .iter()
        .filter(|document| !connected.contains(document.path.as_str()))
        .map(|document| ReportNote {
            path: document.path.clone(),
            title: title(&document.path),
        })
        .collect::<Vec<_>>();
    isolated_notes.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });

    let mut modified = HashMap::<String, i64>::new();
    let mut modified_statement = connection.prepare("SELECT path, modified_ns FROM documents")?;
    let modified_rows = modified_statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in modified_rows {
        let (path, modified_ns) = row?;
        modified.insert(path, modified_ns);
    }

    let threshold = i64::try_from(stale_after_days)
        .unwrap_or(i64::MAX)
        .saturating_mul(NS_PER_DAY);
    let mut stale_notes = documents
        .iter()
        .filter_map(|document| {
            let modified_ns = modified.get(&document.path).copied().unwrap_or(0);
            if modified_ns <= 0 {
                return None;
            }
            let age = now_ns.saturating_sub(modified_ns);
            if age <= threshold {
                return None;
            }
            Some(StaleNote {
                path: document.path.clone(),
                title: title(&document.path),
                modified_ns,
                days: u64::try_from(age / NS_PER_DAY).unwrap_or(u64::MAX),
            })
        })
        .collect::<Vec<_>>();
    stale_notes.sort_by(|left, right| {
        right
            .days
            .cmp(&left.days)
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });

    Ok(KnowledgeReport {
        broken_links,
        isolated_notes,
        stale_notes,
        unused_tags: unused_tag_section(connection)?,
        stale_after_days,
        indexed_documents: documents.len() as u64,
        indexing,
    })
}

fn unused_tag_section(connection: &Connection) -> Result<UnusedTagSection, SearchError> {
    let mut statement = connection.prepare(
        "SELECT path, text, items FROM note_fields
         WHERE key_lower IN ('tags', 'tag')
         ORDER BY path, ordinal",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut by_tag = HashMap::<String, HashSet<String>>::new();
    for row in rows {
        let (path, text, items) = row?;
        let values = match items {
            Some(raw) => serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default(),
            None => vec![text],
        };
        for value in values {
            let tag = value.trim().trim_start_matches('#').trim().to_lowercase();
            if tag.is_empty() {
                continue;
            }
            by_tag.entry(tag).or_default().insert(path.clone());
        }
    }
    let mut tags = by_tag
        .into_iter()
        .filter(|(_, paths)| paths.len() <= 1)
        .map(|(tag, paths)| {
            let mut paths = paths.into_iter().collect::<Vec<_>>();
            paths.sort();
            UnusedTag {
                tag,
                note_count: paths.len() as u64,
                paths,
            }
        })
        .collect::<Vec<_>>();
    tags.sort_by(|left, right| {
        left.note_count
            .cmp(&right.note_count)
            .then_with(|| left.tag.cmp(&right.tag))
    });
    let total = tags.len() as u64;
    tags.truncate(MAX_UNUSED_TAGS);
    Ok(UnusedTagSection {
        truncated: total > tags.len() as u64,
        tags,
        total,
    })
}

fn read_text(path: &str) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn raw_target(body: &str, offset: usize) -> Option<String> {
    parser::extract(body)
        .into_iter()
        .chain(parser::extract_markdown(body))
        .find(|link| link.target_range.start == offset)
        .map(|link| link.target)
}

fn line_at(text: &str, byte: usize) -> usize {
    text.as_bytes()[..byte.min(text.len())]
        .iter()
        .filter(|value| **value == b'\n')
        .count()
        + 1
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
    use super::{
        build, stale_after_days, DEFAULT_STALE_DAYS, MAX_STALE_DAYS, MAX_UNUSED_TAGS, NS_PER_DAY,
    };
    use crate::search::wiki;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        wiki::open_schema(&connection).unwrap();
        crate::search::fields::open_schema(&connection).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE documents (
                   path TEXT PRIMARY KEY,
                   modified_ns INTEGER NOT NULL
                 );",
            )
            .unwrap();
        connection
    }

    fn seed(connection: &mut Connection, root: &Path, notes: &[(&str, &str)]) {
        let transaction = connection.transaction().unwrap();
        for (name, body) in notes {
            let path = root.join(format!("{name}.md"));
            fs::write(&path, body).unwrap();
            wiki::index_document(&transaction, root, &path, body).unwrap();
            crate::search::fields::index_document(&transaction, &path, body).unwrap();
        }
        transaction.commit().unwrap();
    }

    fn modified(connection: &Connection, root: &Path, name: &str, modified_ns: i64) {
        connection
            .execute(
                "INSERT INTO documents(path, modified_ns) VALUES(?1, ?2)",
                params![
                    root.join(format!("{name}.md")).to_string_lossy(),
                    modified_ns
                ],
            )
            .unwrap();
    }

    #[test]
    fn reports_unresolved_links_and_notes_without_resolved_links() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(
            &mut connection,
            root,
            &[
                ("a", "См. [[b]]"),
                ("b", "Цель"),
                ("c", "См. [[ghost]]"),
                ("d", "Одинокая"),
            ],
        );
        for name in ["a", "b", "c", "d"] {
            modified(&connection, root, name, 1_000);
        }

        let report = build(&connection, root, 90, 10 * NS_PER_DAY, false).unwrap();

        assert_eq!(report.broken_links.len(), 1, "{:?}", report.broken_links);
        assert_eq!(report.broken_links[0].source_title, "c");
        assert_eq!(report.broken_links[0].target, "ghost");
        assert_eq!(report.broken_links[0].line, 1);
        let isolated = report
            .isolated_notes
            .iter()
            .map(|note| note.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(isolated, vec!["c", "d"]);
        assert_eq!(report.indexed_documents, 4);
        assert_eq!(report.stale_after_days, 90);
    }

    #[test]
    fn a_note_linking_to_itself_stays_isolated() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(&mut connection, root, &[("self", "[[self]]")]);

        let report = build(&connection, root, 90, 0, false).unwrap();

        assert!(report.broken_links.is_empty());
        assert_eq!(report.isolated_notes.len(), 1);
    }

    #[test]
    fn stale_notes_use_the_requested_threshold_and_skip_unknown_dates() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(
            &mut connection,
            root,
            &[("old", ""), ("fresh", ""), ("unknown", "")],
        );
        modified(&connection, root, "old", 10 * NS_PER_DAY);
        modified(&connection, root, "fresh", 150 * NS_PER_DAY);

        let report = build(&connection, root, 90, 200 * NS_PER_DAY, false).unwrap();

        assert_eq!(report.stale_notes.len(), 1, "{:?}", report.stale_notes);
        assert_eq!(report.stale_notes[0].title, "old");
        assert_eq!(report.stale_notes[0].days, 190);
    }

    #[test]
    fn the_stale_window_defaults_and_is_bounded() {
        assert_eq!(stale_after_days(None), DEFAULT_STALE_DAYS);
        assert_eq!(stale_after_days(Some(0)), DEFAULT_STALE_DAYS);
        assert_eq!(stale_after_days(Some(30)), 30);
        assert_eq!(stale_after_days(Some(MAX_STALE_DAYS + 1)), MAX_STALE_DAYS);
    }

    #[test]
    fn the_reported_target_is_the_text_written_in_the_note() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(
            &mut connection,
            root,
            &[
                ("a", "Первая строка\nСм. [[Missing Note]] и [[other|алиас]]"),
                ("other", ""),
            ],
        );

        let report = build(&connection, root, 90, 0, true).unwrap();

        assert_eq!(report.broken_links.len(), 1);
        assert_eq!(report.broken_links[0].target, "Missing Note");
        assert_eq!(report.broken_links[0].line, 2);
        assert!(report.indexing);
    }

    #[test]
    fn unused_tags_come_from_frontmatter_lists_and_inline_forms() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(
            &mut connection,
            root,
            &[
                ("list", "---\ntags: [Alpha, beta, alpha]\n---\n"),
                ("inline", "tags:: [beta, gamma]\ntag:: #delta\n"),
            ],
        );

        let report = build(&connection, root, 90, 0, false).unwrap();

        let found = report
            .unused_tags
            .tags
            .iter()
            .map(|tag| (tag.tag.as_str(), tag.note_count))
            .collect::<Vec<_>>();
        assert_eq!(found, vec![("alpha", 1), ("delta", 1), ("gamma", 1)]);
        assert_eq!(report.unused_tags.total, 3);
        assert!(!report.unused_tags.truncated);
        assert_eq!(
            report.unused_tags.tags[0].paths,
            vec![root.join("list.md").to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn a_tag_used_by_two_notes_is_not_unused() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        seed(
            &mut connection,
            root,
            &[
                ("one", "---\ntags: [shared, solo]\n---\n"),
                ("two", "---\ntags: shared\n---\n"),
            ],
        );

        let report = build(&connection, root, 90, 0, false).unwrap();

        let found = report
            .unused_tags
            .tags
            .iter()
            .map(|tag| tag.tag.as_str())
            .collect::<Vec<_>>();
        assert_eq!(found, vec!["solo"]);
    }

    #[test]
    fn unused_tags_are_capped_and_report_truncation() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut connection = connection();
        let tags = (0..MAX_UNUSED_TAGS + 5)
            .map(|index| format!("tag{index:03}"))
            .collect::<Vec<_>>();
        let body = format!("---\ntags: [{}]\n---\n", tags.join(", "));
        seed(&mut connection, root, &[("many", body.as_str())]);

        let report = build(&connection, root, 90, 0, false).unwrap();

        assert_eq!(report.unused_tags.tags.len(), MAX_UNUSED_TAGS);
        assert_eq!(report.unused_tags.total, tags.len() as u64);
        assert!(report.unused_tags.truncated);
        assert_eq!(report.unused_tags.tags[0].tag, "tag000");
    }

    #[test]
    fn an_index_without_tags_has_an_empty_unused_tag_section() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();

        let report = build(&connection, directory.path(), 90, 0, false).unwrap();

        assert!(report.unused_tags.tags.is_empty());
        assert_eq!(report.unused_tags.total, 0);
        assert!(!report.unused_tags.truncated);
    }
}
