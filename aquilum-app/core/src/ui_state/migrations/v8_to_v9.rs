use super::super::error::UiStateError;
use rusqlite::Connection;

pub fn migrate_v8_to_v9(connection: &Connection) -> Result<(), UiStateError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
         CREATE TABLE base_view_states (
             workspace_id TEXT NOT NULL,
             base_file TEXT NOT NULL,
             view_index INTEGER NOT NULL CHECK(view_index >= 0),
             updated_at_ms INTEGER NOT NULL,
             PRIMARY KEY(workspace_id, base_file),
             FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
         );
         PRAGMA user_version = 9;
         COMMIT;",
    )?;
    Ok(())
}
