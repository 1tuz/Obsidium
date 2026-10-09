use super::database::UiStateDatabase;
use super::error::UiStateError;
#[cfg(test)]
use super::migrations::migrate;
use super::models::SaveBaseViewStateInput;
use rusqlite::{params, OptionalExtension};

impl UiStateDatabase {
    pub fn load_base_view(
        &self,
        workspace_id: uuid::Uuid,
        base_file: &str,
    ) -> Result<Option<i64>, UiStateError> {
        Ok(self.connection.query_row(
            "SELECT view_index FROM base_view_states WHERE workspace_id = ?1 AND base_file = ?2",
            params![workspace_id.to_string(), base_file],
            |row| row.get(0),
        ).optional()?)
    }

    pub fn save_base_view(&self, input: &SaveBaseViewStateInput) -> Result<(), UiStateError> {
        if input.view_index < 0 {
            return Err(UiStateError::InvalidInput {
                message: "base view index must be >= 0".to_owned(),
            });
        }
        self.connection.execute(
            "INSERT INTO base_view_states(workspace_id, base_file, view_index, updated_at_ms)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(workspace_id, base_file) DO UPDATE SET
                 view_index = excluded.view_index,
                 updated_at_ms = excluded.updated_at_ms",
            params![
                input.workspace_id.to_string(),
                input.base_file,
                input.view_index,
                input.now_ms
            ],
        )?;
        Ok(())
    }
}

#[test]
fn base_view_state_round_trips_independently_per_base_file() {
    let mut database = UiStateDatabase::memory().expect("database");
    let workspace_id = database
        .resolve_workspace("C:/notes", 1)
        .expect("workspace");
    database
        .save_base_view(&SaveBaseViewStateInput {
            workspace_id,
            base_file: "Work/Boards.base".to_owned(),
            view_index: 2,
            now_ms: 10,
        })
        .expect("save");

    assert_eq!(
        database
            .load_base_view(workspace_id, "Work/Boards.base")
            .expect("load"),
        Some(2)
    );
    assert_eq!(
        database
            .load_base_view(workspace_id, "Personal.base")
            .expect("load"),
        None
    );
}

#[test]
fn version_eight_database_receives_the_base_view_table() {
    let connection = rusqlite::Connection::open_in_memory().expect("database");
    migrate(&connection).expect("latest schema");
    connection
        .execute_batch("DROP TABLE base_view_states;
            ALTER TABLE tabs DROP COLUMN pane_id;
            ALTER TABLE sessions DROP COLUMN layout_json;
            PRAGMA user_version = 8;")
        .expect("legacy version");

    migrate(&connection).expect("upgrade");

    let table_count = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'base_view_states'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .expect("table count");
    assert_eq!(table_count, 1);
}

#[test]
fn negative_base_view_index_is_rejected() {
    let mut database = UiStateDatabase::memory().expect("database");
    let workspace_id = database
        .resolve_workspace("C:/notes", 1)
        .expect("workspace");
    let error = database
        .save_base_view(&SaveBaseViewStateInput {
            workspace_id,
            base_file: "Board.base".to_owned(),
            view_index: -1,
            now_ms: 10,
        })
        .expect_err("negative view index");
    assert!(matches!(error, UiStateError::InvalidInput { .. }));
}
