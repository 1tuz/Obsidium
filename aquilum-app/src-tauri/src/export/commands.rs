use tauri::WebviewWindow;

#[tauri::command]
pub fn pdf_export_is_native() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub async fn export_pdf(window: WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        super::pdf::print_current_page(window, path).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Err("Печать в PDF из приложения доступна только в Windows".to_owned())
    }
}
