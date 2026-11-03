use super::super::error::UiStateError;
use rusqlite::Connection;

pub fn migrate_v10_to_v11(connection: &Connection) -> Result<(), UiStateError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
         ALTER TABLE tabs ADD COLUMN url TEXT;
         PRAGMA user_version = 11;
         COMMIT;",
    )?;
    Ok(())
}
