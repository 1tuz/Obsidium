use crate::app_core::Core;
use crate::blocking::run_blocking;
use crate::files::error::FileCommandError;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn pdf_export_is_native() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

#[tauri::command]
pub async fn pick_export_target(
    app: AppHandle,
    core: State<'_, Arc<Core>>,
    title: String,
) -> Result<Option<String>, String> {
    let picked = run_blocking(move || {
        Ok(app
            .dialog()
            .file()
            .set_file_name(format!("{title}.pdf"))
            .add_filter("PDF", &["pdf"])
            .blocking_save_file())
    })
    .await
    .map_err(stringify)?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    let granted = core
        .access
        .grant_file(&path.to_string_lossy())
        .map_err(stringify)?;
    Ok(Some(granted.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    core: State<'_, Arc<Core>>,
    path: String,
) -> Result<(), FileCommandError> {
    let path = core.access.check(&path)?.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        super::pdf::print_current_page(window, path)
            .await
            .map_err(|message| FileCommandError::Io { message })
    }
    #[cfg(target_os = "macos")]
    {
        super::pdf_macos::print_current_page(window, path)
            .await
            .map_err(|message| FileCommandError::Io { message })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (window, path);
        Err(FileCommandError::Io {
            message: "Печать в PDF из приложения доступна только в Windows и macOS".to_owned(),
        })
    }
}

fn stringify(error: FileCommandError) -> String {
    error.to_string()
}
