use super::edit::task_id;
use super::parse::{note_tasks, Task};
use crate::search::error::SearchError;
use rusqlite::types::Value;
use rusqlite::{params, Connection, Transaction};
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Debug, Default)]
pub struct TaskFilter {
    pub paths: Option<Vec<String>>,
    pub done: Option<bool>,
    pub text_contains: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskRow {
    pub path: String,
    pub task_id: String,
    pub line: usize,
    pub done: bool,
    pub text: String,
}

pub fn open_schema(connection: &Connection) -> Result<(), SearchError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS note_tasks (
           path TEXT NOT NULL,
           ordinal INTEGER NOT NULL,
           line INTEGER NOT NULL,
           done INTEGER NOT NULL,
           text TEXT NOT NULL,
           PRIMARY KEY(path, ordinal)
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS note_tasks_open ON note_tasks(done);",
    )?;
    Ok(())
}

pub fn index_document(
    transaction: &Transaction<'_>,
    path: &Path,
    body: &str,
) -> Result<(), SearchError> {
    remove_document(transaction, path)?;
    let found = note_tasks(body);
    if found.is_empty() {
        return Ok(());
    }
    let path_text = path.to_string_lossy();
    let mut statement = transaction.prepare(
        "INSERT INTO note_tasks(path, ordinal, line, done, text) VALUES(?1, ?2, ?3, ?4, ?5)",
    )?;
    for (ordinal, task) in found.iter().enumerate() {
        statement.execute(params![
            path_text,
            ordinal as i64,
            task.line as i64,
            i64::from(task.done),
            task.text,
        ])?;
    }
    Ok(())
}

pub fn remove_document(transaction: &Transaction<'_>, path: &Path) -> Result<(), SearchError> {
    transaction.execute(
        "DELETE FROM note_tasks WHERE path=?1",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

const CHUNK: usize = 400;

pub fn read(
    connection: &Connection,
    paths: &[String],
) -> Result<HashMap<String, Vec<Task>>, SearchError> {
    let mut found: HashMap<String, Vec<Task>> = HashMap::new();
    for chunk in paths.chunks(CHUNK) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let mut statement = connection.prepare(&format!(
            "SELECT path, line, done, text FROM note_tasks
             WHERE path IN ({placeholders}) ORDER BY path, ordinal"
        ))?;
        let rows = statement.query_map(rusqlite::params_from_iter(chunk), |row| {
            Ok((
                row.get::<_, String>(0)?,
                Task {
                    line: row.get::<_, i64>(1)? as usize,
                    done: row.get::<_, i64>(2)? != 0,
                    text: row.get::<_, String>(3)?,
                },
            ))
        })?;
        for entry in rows {
            let (path, task) = entry?;
            found.entry(path).or_default().push(task);
        }
    }
    Ok(found)
}

pub fn list(connection: &Connection, filter: &TaskFilter) -> Result<Vec<TaskRow>, SearchError> {
    let mut sql = String::from(
        "SELECT path, ordinal, line, done, text, occurrence FROM (
           SELECT path, ordinal, line, done, text,
                  COUNT(*) OVER (PARTITION BY path, text ORDER BY ordinal) - 1 AS occurrence
           FROM note_tasks
         )",
    );
    let mut clauses = Vec::<String>::new();
    let mut values = Vec::<Value>::new();
    if let Some(paths) = filter.paths.as_ref() {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        clauses.push(format!("path IN ({})", vec!["?"; paths.len()].join(", ")));
        values.extend(paths.iter().cloned().map(Value::Text));
    }
    if let Some(done) = filter.done {
        clauses.push("done = ?".to_owned());
        values.push(Value::Integer(i64::from(done)));
    }
    if let Some(needle) = filter
        .text_contains
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push("instr(text, ?) > 0".to_owned());
        values.push(Value::Text(needle.to_owned()));
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY path, ordinal");
    match (filter.limit, filter.offset) {
        (Some(limit), offset) => {
            sql.push_str(" LIMIT ?");
            values.push(Value::Integer(i64::try_from(limit).unwrap_or(i64::MAX)));
            if let Some(offset) = offset {
                sql.push_str(" OFFSET ?");
                values.push(Value::Integer(i64::try_from(offset).unwrap_or(i64::MAX)));
            }
        }
        (None, Some(offset)) => {
            sql.push_str(" LIMIT -1 OFFSET ?");
            values.push(Value::Integer(i64::try_from(offset).unwrap_or(i64::MAX)));
        }
        (None, None) => {}
    }

    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        let text = row.get::<_, String>(4)?;
        let occurrence = row.get::<_, i64>(5)?;
        Ok(TaskRow {
            path: row.get(0)?,
            task_id: task_id(&text, occurrence as usize),
            line: row.get::<_, i64>(2)? as usize,
            done: row.get::<_, i64>(3)? != 0,
            text,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{index_document, list, open_schema, read, remove_document, TaskFilter};
    use crate::search::tasks::edit::task_id;
    use rusqlite::Connection;
    use std::path::Path;

    fn store(body: &str) -> Connection {
        let mut connection = Connection::open_in_memory().expect("память");
        open_schema(&connection).expect("схема");
        let transaction = connection.transaction().expect("транзакция");
        index_document(&transaction, Path::new("C:/vault/Дела.md"), body).expect("индексация");
        transaction.commit().expect("фиксация");
        connection
    }

    #[test]
    fn tasks_survive_a_round_trip_through_the_index() {
        let connection = store("- [ ] написать\n- [x] отправить");
        let found = read(&connection, &["C:/vault/Дела.md".to_owned()]).expect("чтение");
        let tasks = &found["C:/vault/Дела.md"];
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].text, "написать");
        assert!(!tasks[0].done);
        assert!(tasks[1].done);
    }

    #[test]
    fn reindexing_replaces_the_previous_tasks() {
        let mut connection = store("- [ ] старая");
        let transaction = connection.transaction().expect("транзакция");
        index_document(&transaction, Path::new("C:/vault/Дела.md"), "- [ ] новая").expect("снова");
        transaction.commit().expect("фиксация");

        let found = read(&connection, &["C:/vault/Дела.md".to_owned()]).expect("чтение");
        assert_eq!(found["C:/vault/Дела.md"].len(), 1);
        assert_eq!(found["C:/vault/Дела.md"][0].text, "новая");
    }

    #[test]
    fn removing_a_document_takes_its_tasks_with_it() {
        let mut connection = store("- [ ] написать");
        let transaction = connection.transaction().expect("транзакция");
        remove_document(&transaction, Path::new("C:/vault/Дела.md")).expect("удаление");
        transaction.commit().expect("фиксация");

        let found = read(&connection, &["C:/vault/Дела.md".to_owned()]).expect("чтение");
        assert!(found.is_empty());
    }

    #[test]
    fn listing_numbers_duplicates_and_filters() {
        let connection = store("- [ ] одно\n- [x] одно\n- [ ] другое");

        let all = list(&connection, &TaskFilter::default()).expect("список");
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].task_id, task_id("одно", 0));
        assert_eq!(all[1].task_id, task_id("одно", 1));
        assert_ne!(all[0].task_id, all[1].task_id);
        assert_eq!(all[2].text, "другое");

        let open = list(
            &connection,
            &TaskFilter {
                done: Some(false),
                ..TaskFilter::default()
            },
        )
        .expect("открытые");
        assert_eq!(open.len(), 2);
        assert_eq!(open[0].task_id, task_id("одно", 0));

        let second = list(
            &connection,
            &TaskFilter {
                offset: Some(1),
                limit: Some(1),
                ..TaskFilter::default()
            },
        )
        .expect("страница");
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].line, 2);

        let matching = list(
            &connection,
            &TaskFilter {
                text_contains: Some("друг".to_owned()),
                ..TaskFilter::default()
            },
        )
        .expect("поиск");
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].text, "другое");

        let missing = list(
            &connection,
            &TaskFilter {
                paths: Some(vec!["C:/vault/Нет.md".to_owned()]),
                ..TaskFilter::default()
            },
        )
        .expect("пусто");
        assert!(missing.is_empty());
    }
}
