use super::super::vault::Vault;
use super::workspace::requested_vault;
use super::{optional_text, require_write, tool, version_name_property, workspace_property};
use crate::app_core::Core;
use crate::files::document::{hash_bytes, read_file_snapshot_impl, write_file_atomic_impl};
use crate::files::gate;
use crate::history::{Source, AQUILUM_FOLDER};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_EDITS: usize = 50;
const TRANSACTIONS_FOLDER: &str = "transactions";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditRequest {
    note: String,
    content: String,
    expected_hash: Option<String>,
}

struct PlannedEdit {
    path: PathBuf,
    relative: String,
    before: String,
    before_hash: String,
    after: String,
    after_hash: String,
    changed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEdit {
    path: String,
    before: String,
    after: String,
    after_hash: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTransaction {
    id: String,
    created_ms: u64,
    edits: Vec<StoredEdit>,
}

pub fn definitions() -> Vec<Value> {
    let edit = json!({
        "type": "object",
        "properties": {
            "note": { "type": "string", "description": "Путь или точное название существующей заметки" },
            "content": { "type": "string", "description": "Полный новый текст заметки" },
            "expectedHash": { "type": "string", "description": "Опциональный hash из read_note/предыдущего preview" }
        },
        "required": ["note", "content"],
        "additionalProperties": false
    });
    vec![
        tool(
            "preview_transaction",
            "Проверить транзакционную правку нескольких существующих заметок без записи. Возвращает текущие/будущие hash и размеры.",
            json!({
                "edits": { "type": "array", "minItems": 1, "maxItems": MAX_EDITS, "items": edit.clone() },
                "workspace": workspace_property(),
            }),
            &["edits"],
        ),
        tool(
            "apply_transaction",
            "Транзакционно изменить до 50 существующих заметок. При конфликте или ошибке уже применённые записи автоматически откатываются. После успеха transactionId можно передать rollback_transaction.",
            json!({
                "edits": { "type": "array", "minItems": 1, "maxItems": MAX_EDITS, "items": edit },
                "workspace": workspace_property(),
                "versionName": version_name_property(),
            }),
            &["edits"],
        ),
        tool(
            "rollback_transaction",
            "Откатить ранее успешно применённую apply_transaction. Откат не выполняется, если любую затронутую заметку уже изменили после транзакции.",
            json!({
                "transactionId": { "type": "string", "description": "transactionId из apply_transaction" },
                "workspace": workspace_property(),
            }),
            &["transactionId"],
        ),
    ]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "preview_transaction" => preview(core, arguments),
        "apply_transaction" => apply(core, arguments),
        "rollback_transaction" => rollback(core, arguments),
        _ => return None,
    })
}

fn requests(arguments: &Value) -> Result<Vec<EditRequest>, String> {
    let value = arguments
        .get("edits")
        .ok_or_else(|| "Не передан список edits".to_owned())?;
    let edits = serde_json::from_value::<Vec<EditRequest>>(value.clone())
        .map_err(|error| format!("Неверный edits: {error}"))?;
    if edits.is_empty() {
        return Err("Список edits пуст".to_owned());
    }
    if edits.len() > MAX_EDITS {
        return Err(format!(
            "За одну транзакцию допускается не больше {MAX_EDITS} заметок"
        ));
    }
    Ok(edits)
}

fn plan(vault: &Vault, arguments: &Value) -> Result<Vec<PlannedEdit>, String> {
    let mut seen = HashSet::new();
    requests(arguments)?
        .into_iter()
        .map(|edit| {
            let path = vault.note(&edit.note)?;
            let relative = vault.relative(&path);
            if !seen.insert(relative.to_lowercase()) {
                return Err(format!("Заметка указана в транзакции дважды: {relative}"));
            }
            let snapshot = read_file_snapshot_impl(&path).map_err(|error| error.to_string())?;
            let before = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            if let Some(expected) = edit.expected_hash.as_deref() {
                if expected != snapshot.hash {
                    return Err(format!("{relative}: hash изменился после preview/read"));
                }
            }
            let after_hash = hash_bytes(edit.content.as_bytes());
            let changed = snapshot.text_hash != after_hash;
            Ok(PlannedEdit {
                path,
                relative,
                before,
                before_hash: snapshot.hash,
                after: edit.content,
                after_hash,
                changed,
            })
        })
        .collect()
}

fn preview(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = requested_vault(core, arguments)?;
    let planned = plan(&vault, arguments)?;
    Ok(json!({
        "workspace": vault.root.to_string_lossy(),
        "changes": planned.iter().map(|edit| json!({
            "path": edit.relative,
            "changed": edit.changed,
            "beforeHash": edit.before_hash,
            "afterHash": edit.after_hash,
            "beforeChars": edit.before.chars().count(),
            "afterChars": edit.after.chars().count(),
        })).collect::<Vec<_>>(),
    }))
}

fn apply(core: &Core, arguments: &Value) -> Result<Value, String> {
    require_write(core)?;
    let vault = requested_vault(core, arguments)?;
    let planned = plan(&vault, arguments)?;
    let id = Uuid::new_v4().simple().to_string();
    let version_name = optional_text(arguments, "versionName")
        .unwrap_or_else(|| format!("Agent transaction {}", &id[..8]));
    let mut applied: Vec<&PlannedEdit> = Vec::new();

    for edit in planned.iter().filter(|edit| edit.changed) {
        match gate::write(
            core,
            &edit.path,
            &edit.after,
            Some(&edit.before_hash),
            Source::Agent,
            Some(&version_name),
        ) {
            Ok(_) => applied.push(edit),
            Err(error) => {
                let rollback = rollback_applied(core, &applied, &format!("Rollback {}", &id[..8]));
                return match rollback {
                    Ok(()) => Err(format!(
                        "{}: {error}; применённые части транзакции отменены",
                        edit.relative
                    )),
                    Err(rollback_error) => Err(format!(
                        "{}: {error}; автоматический откат неполный: {rollback_error}",
                        edit.relative,
                    )),
                };
            }
        }
    }

    let stored = StoredTransaction {
        id: id.clone(),
        created_ms: now_ms(),
        edits: applied
            .iter()
            .map(|edit| StoredEdit {
                path: edit.relative.clone(),
                before: edit.before.clone(),
                after: edit.after.clone(),
                after_hash: edit.after_hash.clone(),
            })
            .collect(),
    };
    if let Err(error) = persist(&vault, &stored) {
        return match rollback_applied(core, &applied, &format!("Rollback {}", &id[..8])) {
            Ok(()) => Err(format!("Не удалось сохранить запись транзакции: {error}; правки отменены")),
            Err(rollback_error) => Err(format!(
                "Не удалось сохранить запись транзакции: {error}; автоматический откат неполный: {rollback_error}",
            )),
        };
    }

    Ok(json!({
        "transactionId": id,
        "changed": stored.edits.len(),
        "paths": stored.edits.iter().map(|edit| edit.path.clone()).collect::<Vec<_>>(),
    }))
}

fn rollback(core: &Core, arguments: &Value) -> Result<Value, String> {
    require_write(core)?;
    let vault = requested_vault(core, arguments)?;
    let id = arguments
        .get("transactionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Не передан transactionId".to_owned())?;
    Uuid::parse_str(id).map_err(|_| "Некорректный transactionId".to_owned())?;
    let path = transaction_path(&vault, id);
    let raw = fs::read_to_string(&path).map_err(|_| format!("Транзакция не найдена: {id}"))?;
    let stored = serde_json::from_str::<StoredTransaction>(&raw)
        .map_err(|error| format!("Транзакция повреждена: {error}"))?;

    let mut resolved = Vec::new();
    for (index, edit) in stored.edits.iter().enumerate() {
        let note = vault.note(&edit.path)?;
        let current = read_file_snapshot_impl(&note).map_err(|error| error.to_string())?;
        if current.hash != edit.after_hash {
            return Err(format!(
                "{} изменена после транзакции; откат отменён целиком",
                edit.path
            ));
        }
        resolved.push((index, note));
    }

    let version_name = format!("Rollback {}", &id[..8.min(id.len())]);
    let recovery_name = format!("Rollback recovery {}", &id[..8.min(id.len())]);
    let mut rolled_back = Vec::new();
    for (index, note) in resolved.iter().rev() {
        let edit = &stored.edits[*index];
        match gate::write(
            core,
            note,
            &edit.before,
            Some(&edit.after_hash),
            Source::Agent,
            Some(&version_name),
        ) {
            Ok(_) => rolled_back.push((*index, note.clone())),
            Err(error) => {
                let recovery =
                    restore_transaction_state(core, &stored, &rolled_back, &recovery_name);
                return match recovery {
                    Ok(()) => Err(format!(
                        "{}: откат не завершён ({error}); состояние транзакции восстановлено",
                        edit.path,
                    )),
                    Err(recovery_error) => Err(format!(
                        "{}: откат частично применён ({error}); восстановление тоже не завершено: {recovery_error}",
                        edit.path,
                    )),
                };
            }
        }
    }
    let _ = fs::remove_file(path);
    Ok(json!({
        "transactionId": id,
        "rolledBack": resolved.len(),
        "paths": stored.edits.iter().map(|edit| edit.path.clone()).collect::<Vec<_>>(),
    }))
}

fn rollback_applied(
    core: &Core,
    applied: &[&PlannedEdit],
    version_name: &str,
) -> Result<(), String> {
    let mut failures = Vec::new();
    for edit in applied.iter().rev() {
        if let Err(error) = gate::write(
            core,
            &edit.path,
            &edit.before,
            Some(&edit.after_hash),
            Source::Agent,
            Some(version_name),
        ) {
            failures.push(format!("{}: {error}", edit.relative));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn restore_transaction_state(
    core: &Core,
    stored: &StoredTransaction,
    rolled_back: &[(usize, PathBuf)],
    version_name: &str,
) -> Result<(), String> {
    let mut failures = Vec::new();
    for (index, note) in rolled_back.iter().rev() {
        let edit = &stored.edits[*index];
        let before_hash = hash_bytes(edit.before.as_bytes());
        if let Err(error) = gate::write(
            core,
            note,
            &edit.after,
            Some(&before_hash),
            Source::Agent,
            Some(version_name),
        ) {
            failures.push(format!("{}: {error}", edit.path));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn persist(vault: &Vault, transaction: &StoredTransaction) -> Result<(), String> {
    let path = transaction_path(vault, &transaction.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(transaction).map_err(|error| error.to_string())?;
    write_file_atomic_impl(&path, &json, None).map_err(|error| error.to_string())?;
    Ok(())
}

fn transaction_path(vault: &Vault, id: &str) -> PathBuf {
    vault
        .root
        .join(AQUILUM_FOLDER)
        .join(TRANSACTIONS_FOLDER)
        .join(format!("{id}.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_core::{Core, EventSink};
    use std::sync::Arc;

    fn fixture() -> (tempfile::TempDir, Arc<Core>, Vault) {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let root = directory.path().join("vault");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("A.md"), "before A").unwrap();
        fs::write(root.join("B.md"), "before B").unwrap();
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let core = Core::open(&data, events);
        core.ui_state
            .resolve_workspace(&root.to_string_lossy(), 1)
            .unwrap();
        let vault = Vault {
            root: crate::search::paths::canonical_path(&root),
            visible: false,
        };
        (directory, core, vault)
    }

    #[test]
    fn preview_does_not_write_and_apply_can_be_rolled_back() {
        let (_guard, core, vault) = fixture();
        let args = json!({
            "workspace": vault.root.to_string_lossy(),
            "edits": [
                { "note": "A.md", "content": "after A" },
                { "note": "B.md", "content": "after B" }
            ]
        });

        let before = fs::read_to_string(vault.root.join("A.md")).unwrap();
        let previewed = preview(&core, &args).unwrap();
        assert_eq!(previewed["changes"].as_array().unwrap().len(), 2);
        assert_eq!(fs::read_to_string(vault.root.join("A.md")).unwrap(), before);

        let applied = apply(&core, &args).unwrap();
        assert_eq!(
            fs::read_to_string(vault.root.join("A.md")).unwrap(),
            "after A"
        );
        let rolled = rollback(
            &core,
            &json!({
                "workspace": vault.root.to_string_lossy(),
                "transactionId": applied["transactionId"],
            }),
        )
        .unwrap();
        assert_eq!(rolled["rolledBack"], 2);
        assert_eq!(
            fs::read_to_string(vault.root.join("A.md")).unwrap(),
            "before A"
        );
        assert_eq!(
            fs::read_to_string(vault.root.join("B.md")).unwrap(),
            "before B"
        );
    }

    #[test]
    fn rollback_refuses_when_any_note_changed_after_transaction() {
        let (_guard, core, vault) = fixture();
        let args = json!({
            "workspace": vault.root.to_string_lossy(),
            "edits": [
                { "note": "A.md", "content": "after A" },
                { "note": "B.md", "content": "after B" }
            ]
        });
        let applied = apply(&core, &args).unwrap();
        fs::write(vault.root.join("B.md"), "external change").unwrap();

        let result = rollback(
            &core,
            &json!({
                "workspace": vault.root.to_string_lossy(),
                "transactionId": applied["transactionId"],
            }),
        );

        assert!(result.unwrap_err().contains("откат отменён целиком"));
        assert_eq!(
            fs::read_to_string(vault.root.join("A.md")).unwrap(),
            "after A"
        );
        assert_eq!(
            fs::read_to_string(vault.root.join("B.md")).unwrap(),
            "external change"
        );
    }
}
