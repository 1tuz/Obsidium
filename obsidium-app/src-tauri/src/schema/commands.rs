use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::document::read_text;
use crate::schema::{ObjectSchema, SchemaError, Violation};
use crate::search::fields::note_fields;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_schema(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
) -> Result<ObjectSchema, SchemaError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let registry = core.schema.registry(Path::new(&workspace_path))?;
        registry.schema()
    })
    .await
}

#[tauri::command]
pub async fn save_schema(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    schema: ObjectSchema,
) -> Result<ObjectSchema, SchemaError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let registry = core.schema.registry(Path::new(&workspace_path))?;
        registry.save(&schema)?;
        registry.schema()
    })
    .await
}

#[tauri::command]
pub async fn validate_note(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    path: String,
) -> Result<Vec<Violation>, SchemaError> {
    let core = Arc::clone(&core);
    run_blocking(move || {
        let registry = core.schema.registry(Path::new(&workspace_path))?;
        let content = read_text(&note_path(registry.root(), &path))?;
        let fields = note_fields(&content);
        let schema = registry.schema()?;
        Ok(registry.validate_note(&schema, &fields))
    })
    .await
}

fn note_path(workspace: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace.join(path)
    }
}
