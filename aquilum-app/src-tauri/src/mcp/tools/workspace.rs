use super::super::active::ActiveNote;
use super::super::bridge;
use super::super::vault::Vault;
use super::workspace_locator::{
    address, known_paths, known_workspace, open_guest, wait_until,
};
pub(super) use super::workspace_locator::workspace_vault;
use super::{optional_text, text, tool, workspace_property};
use crate::search::paths::{canonical_path, same_path};
use crate::search::SearchService;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const SWITCH_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) fn definitions() -> Vec<Value> {
    vec![
        tool(
            "get_workspace",
            "Текущая база знаний: путь, название, открытая сейчас заметка (activeNote) и готовность индекса.",
            json!({}),
            &[],
        ),
        tool(
            "list_workspaces",
            "Все базы знаний, которые открывались в приложении. address — кратчайший однозначный хвост пути: его и передавайте другим инструментам аргументом workspace.",
            json!({}),
            &[],
        ),
        tool(
            "switch_workspace",
            "Переключить видимую базу знаний в окне интерфейса пользователя. ВНИМАНИЕ: это визуальное переключение окна приложения! Вызывать ТОЛЬКО если пользователь прямо попросил переключить базу на экране. Для чтения, поиска, создания и редактирования заметок в другой базе знаний НЕ вызывайте switch_workspace — передавайте аргумент workspace в нужный инструмент (read_note, update_note, search_notes и др.), они работают в фоне без переключения экрана пользователя.",
            json!({
                "path": { "type": "string", "description": "Путь к папке базы знаний или её address из list_workspaces" },
                "workspace": { "type": "string", "description": "Синоним path: путь к папке базы знаний или её address из list_workspaces" },
                "note": { "type": "string", "description": "Заметка, которую открыть после переключения" },
            }),
            &[],
        ),
        tool(
            "open_note",
            "Открыть заметку в интерфейсе приложения и сделать её активной вкладкой. ВНИМАНИЕ: это визуальное переключение экрана пользователя! Вызывать ТОЛЬКО по прямой просьбе пользователя открыть заметку на экране. Заметка из другой базы (workspace) переключит приложение на эту базу.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
    ]
}

pub(super) fn call(
    app: &AppHandle,
    name: &str,
    arguments: &Value,
) -> Option<Result<Value, String>> {
    Some(match name {
        "get_workspace" => get_workspace(app),
        "list_workspaces" => list_workspaces(app),
        "switch_workspace" => switch_workspace(app, arguments),
        "open_note" => open_note(app, arguments),
        _ => return None,
    })
}

pub(super) fn requested_vault(app: &AppHandle, arguments: &Value) -> Result<Vault, String> {
    match optional_text(arguments, "workspace") {
        Some(input) => workspace_vault(app, &input),
        None => Vault::active(app),
    }
}

pub(super) fn indexed_vault(app: &AppHandle, arguments: &Value) -> Result<Vault, String> {
    let vault = requested_vault(app, arguments)?;
    if !vault.visible {
        open_guest(app, &vault.root)?;
    }
    Ok(vault)
}

fn get_workspace(app: &AppHandle) -> Result<Value, String> {
    let vault = Vault::active(app)?;
    let status = app.state::<SearchService>().status(None);
    let active = app.state::<ActiveNote>().get();
    Ok(json!({
        "path": vault.root.to_string_lossy(),
        "name": vault.root.file_name().map(|name| name.to_string_lossy().into_owned()),
        "activeNote": active.as_deref().map(|note| vault.relative(note)),
        "indexedDocuments": status.indexed_documents,
        "indexing": status.updating,
    }))
}

fn list_workspaces(app: &AppHandle) -> Result<Value, String> {
    let active = app.state::<SearchService>().active_root();
    let known = known_paths(app)?;
    let items = known
        .iter()
        .map(|root| {
            json!({
                "path": root.to_string_lossy(),
                "address": address(&known, root),
                "active": active.as_ref().is_some_and(|active| same_path(active, root)),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "workspaces": items }))
}

fn switch_workspace(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let input = optional_text(arguments, "path")
        .or_else(|| optional_text(arguments, "workspace"))
        .or_else(|| optional_text(arguments, "address"))
        .ok_or_else(|| "Не указана база знаний (параметр «path» или «workspace»)".to_string())?;
    let path = known_workspace(app, &input)?;
    switch_to(app, &path, optional_text(arguments, "note").as_deref())
}

fn open_note(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let vault = requested_vault(app, arguments)?;
    let note = text(arguments, "note")?;
    if !vault.visible {
        return switch_to(app, &vault.root, Some(&note));
    }
    let target = vault.note(&note)?;
    bridge::open_note(app, &target, true);
    Ok(json!({ "opened": vault.relative(&target) }))
}

fn switch_to(app: &AppHandle, path: &Path, note: Option<&str>) -> Result<Value, String> {
    bridge::switch_workspace(app, path);
    let root = canonical_path(path);
    let service = app.state::<SearchService>();
    let switched = wait_until(SWITCH_TIMEOUT, || {
        service
            .active_root()
            .is_some_and(|active| same_path(&active, &root))
    });
    if !switched {
        return Err("Приложение не успело переключиться на эту базу знаний".to_owned());
    }

    let vault = Vault::active(app)?;
    let opened = match note {
        Some(note) => {
            let target = vault.note(note)?;
            bridge::open_note(app, &target, false);
            Some(vault.relative(&target))
        }
        None => None,
    };
    Ok(json!({
        "workspace": vault.root.to_string_lossy(),
        "opened": opened,
    }))
}
