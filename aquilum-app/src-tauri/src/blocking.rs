pub(crate) async fn run_blocking<T, E, F>(operation: F) -> Result<T, E>
where
    T: Send + 'static,
    E: From<tauri::Error> + Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation).await?
}
