use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const AUTO_OPEN_COOLDOWN: Duration = Duration::from_secs(5);
static LAST_AUTO_OPEN: Mutex<Option<Instant>> = Mutex::new(None);

pub fn open_note_after_write(app: &AppHandle, path: &Path) {
    let mut last = LAST_AUTO_OPEN.lock().unwrap_or_else(|error| error.into_inner());
    let now = Instant::now();
    if last.is_some_and(|previous| now.duration_since(previous) < AUTO_OPEN_COOLDOWN) {
        return;
    }
    *last = Some(now);
    open_note(app, path, true);
}

const NAVIGATE_EVENT: &str = "mcp-navigate";

pub fn open_note(app: &AppHandle, path: &Path, in_new_tab: bool) {
    emit(
        app,
        json!({
            "kind": "note",
            "path": path.to_string_lossy(),
            "disposition": if in_new_tab { "new-tab" } else { "current" },
        }),
    );
}

pub fn switch_workspace(app: &AppHandle, path: &Path) {
    emit(app, json!({ "kind": "workspace", "path": path.to_string_lossy() }));
}

fn emit(app: &AppHandle, payload: Value) {
    let _ = app.emit(NAVIGATE_EVENT, payload);
}
