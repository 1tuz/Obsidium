use super::super::error::UiStateError;
use rusqlite::Connection;

pub fn migrate_v9_to_v10(connection: &Connection) -> Result<(), UiStateError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
         ALTER TABLE tabs ADD COLUMN pane_id TEXT NOT NULL DEFAULT 'main';
         ALTER TABLE sessions ADD COLUMN layout_json TEXT;
         UPDATE sessions SET layout_json = json_object(
             'kind', 'pane', 'paneId', 'main', 'activeTabId',
             COALESCE(
                 (SELECT tab_id FROM tabs WHERE workspace_id = sessions.workspace_id
                  AND window_id = sessions.window_id AND tab_id = sessions.active_tab_id),
                 (SELECT tab_id FROM tabs WHERE workspace_id = sessions.workspace_id
                  AND window_id = sessions.window_id ORDER BY position, tab_id LIMIT 1)
             )
         );
         PRAGMA user_version = 10;
         COMMIT;",
    )?;
    Ok(())
}
