use super::workspace::{indexed_vault, requested_vault};
use super::{
    flag, limit, optional_text, require_write, text, tool, version_name_property,
    workspace_property,
};
use crate::app_core::Core;
use crate::files::document::hash_bytes;
use crate::links::{self, LinkKind, LinkPlan};
use crate::mcp::vault::Vault;
use crate::search::graph::neighborhood::{self, Direction};
use serde_json::{json, Value};

const SUGGEST_LIMIT: usize = 50;
const NEIGHBORHOOD_LIMIT: usize = 100;
const DEFAULT_DEPTH: usize = 2;

pub fn definitions() -> Vec<Value> {
    vec![
        tool(
            "suggest_links",
            "Кандидаты в связи для заметки: текстовое сходство (BM25F), общие соседи по графу (Adamic-Adar), возможные дубли и упоминания без ссылки. Поле method называет способ, которым найден кандидат, — это не семантический поиск. alreadyLinked показывает, что связь уже есть.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "path": { "type": "string", "description": "Синоним note: путь заметки" },
                "limit": { "type": "integer", "description": "Сколько кандидатов вернуть, по умолчанию 10, максимум 50" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
        tool(
            "link_notes",
            "Связать две заметки: wiki-ссылка [[...]] в тексте или структурное поле frontmatter (parent, related, depends_on, blocks). Повторный вызов не добавляет вторую связь и ничего не пишет. preview возвращает план без записи.",
            json!({
                "note": { "type": "string", "description": "Заметка-источник: путь или название" },
                "path": { "type": "string", "description": "Синоним note: путь заметки-источника" },
                "target": { "type": "string", "description": "Заметка-цель: путь или название" },
                "kind": { "type": "string", "enum": ["wiki", "parent", "related", "depends_on", "blocks"], "description": "Вид связи, по умолчанию wiki" },
                "preview": { "type": "boolean", "description": "Только показать план правки, ничего не записывая" },
                "expectedHash": { "type": "string", "description": "Хэш заметки из предыдущего чтения: если файл изменился, правка отклоняется" },
                "versionName": version_name_property(),
                "workspace": workspace_property(),
            }),
            &["note", "target"],
        ),
        tool(
            "unlink_notes",
            "Убрать одну связь между заметками: wiki-ссылку или запись структурного поля. Остальные упоминания и текст заметки не меняются.",
            json!({
                "note": { "type": "string", "description": "Заметка-источник: путь или название" },
                "path": { "type": "string", "description": "Синоним note: путь заметки-источника" },
                "target": { "type": "string", "description": "Заметка-цель: путь или название" },
                "kind": { "type": "string", "enum": ["wiki", "parent", "related", "depends_on", "blocks"], "description": "Вид связи, по умолчанию wiki" },
                "preview": { "type": "boolean", "description": "Только показать план правки, ничего не записывая" },
                "expectedHash": { "type": "string", "description": "Хэш заметки из предыдущего чтения: если файл изменился, правка отклоняется" },
                "versionName": version_name_property(),
                "workspace": workspace_property(),
            }),
            &["note", "target"],
        ),
        tool(
            "get_graph_neighborhood",
            "Соседи заметки по графу связей до указанной глубины: путь, расстояние и вид связи, которой сосед найден, плюс рёбра между показанными заметками. direction: both — в обе стороны, in — кто ссылается на заметку, out — на кого ссылается она.",
            json!({
                "note": { "type": "string", "description": "Путь или название заметки" },
                "path": { "type": "string", "description": "Синоним note: путь заметки" },
                "depth": { "type": "integer", "minimum": 1, "maximum": 4, "description": "Глубина обхода от 1 до 4, по умолчанию 2" },
                "direction": { "type": "string", "enum": ["both", "in", "out"], "description": "Направление обхода, по умолчанию both" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Сколько заметок вернуть, по умолчанию 25, максимум 100" },
                "workspace": workspace_property(),
            }),
            &["note"],
        ),
    ]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "suggest_links" => suggest_links(core, arguments),
        "link_notes" => link_notes(core, arguments),
        "unlink_notes" => unlink_notes(core, arguments),
        "get_graph_neighborhood" => graph_neighborhood(core, arguments),
        _ => return None,
    })
}

fn suggest_links(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = indexed_vault(core, arguments)?;
    let note = vault.note(core, &text(arguments, "note")?)?;
    let results = links::suggest(core, &vault, &note, limit(arguments, 10, SUGGEST_LIMIT))?;
    Ok(json!({
        "note": vault.relative(&note),
        "results": results,
    }))
}

fn link_notes(core: &Core, arguments: &Value) -> Result<Value, String> {
    require_write(core)?;
    let vault = requested_vault(core, arguments)?;
    let kind = link_kind(arguments)?;
    let mut plan = links::plan_link(
        core,
        &vault,
        &text(arguments, "note")?,
        &text(arguments, "target")?,
        kind,
    )?;
    if let Some(name) = optional_text(arguments, "versionName") {
        plan.version_name = name;
    }
    check_hash(arguments, &plan)?;
    if flag(arguments, "preview", false) {
        return Ok(planned(&vault, &plan));
    }
    let applied = links::apply_link(core, &vault, &plan)?;
    Ok(json!({
        "source": vault.relative(&plan.source),
        "target": vault.relative(&plan.target),
        "kind": kind.as_str(),
        "changed": applied.changed,
        "hash": applied.hash,
    }))
}

fn unlink_notes(core: &Core, arguments: &Value) -> Result<Value, String> {
    require_write(core)?;
    let vault = requested_vault(core, arguments)?;
    let kind = link_kind(arguments)?;
    let mut plan = links::plan_unlink(
        core,
        &vault,
        &text(arguments, "note")?,
        &text(arguments, "target")?,
        kind,
    )?;
    if let Some(name) = optional_text(arguments, "versionName") {
        plan.version_name = name;
    }
    check_hash(arguments, &plan)?;
    if flag(arguments, "preview", false) {
        return Ok(planned(&vault, &plan));
    }
    let applied = links::apply_link(core, &vault, &plan)?;
    Ok(json!({
        "source": vault.relative(&plan.source),
        "target": vault.relative(&plan.target),
        "kind": kind.as_str(),
        "changed": applied.changed,
        "hash": applied.hash,
    }))
}

fn graph_neighborhood(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = indexed_vault(core, arguments)?;
    let note = vault.note(core, &text(arguments, "note")?)?;
    let depth = depth(arguments);
    let direction = Direction::parse(&optional_text(arguments, "direction").unwrap_or_default())?;
    let workspace = vault.root.to_string_lossy().into_owned();
    let graph = core
        .search
        .graph_snapshot(&workspace)
        .map_err(|error| error.to_string())?;
    let found = neighborhood::build(
        &graph,
        &vault.root,
        &note,
        depth,
        direction,
        limit(arguments, 25, NEIGHBORHOOD_LIMIT),
    );
    Ok(json!({
        "note": vault.relative(&note),
        "depth": depth,
        "direction": direction.as_str(),
        "nodes": found.nodes.iter().map(|node| json!({
            "path": node.path,
            "distance": node.distance,
            "via": node.via,
        })).collect::<Vec<_>>(),
        "edges": found.edges.iter().map(|edge| json!({
            "source": edge.source,
            "target": edge.target,
            "kind": edge.kind,
        })).collect::<Vec<_>>(),
    }))
}

fn link_kind(arguments: &Value) -> Result<LinkKind, String> {
    LinkKind::parse(&optional_text(arguments, "kind").unwrap_or_default())
}

fn depth(arguments: &Value) -> usize {
    arguments
        .get("depth")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_DEPTH, |value| value as usize)
        .clamp(neighborhood::MIN_DEPTH, neighborhood::MAX_DEPTH)
}

fn check_hash(arguments: &Value, plan: &LinkPlan) -> Result<(), String> {
    let Some(expected) = optional_text(arguments, "expectedHash") else {
        return Ok(());
    };
    if expected != plan.hash {
        return Err(format!(
            "Заметка изменилась на диске: ожидался хэш {expected}, сейчас {}",
            plan.hash
        ));
    }
    Ok(())
}

fn planned(vault: &Vault, plan: &LinkPlan) -> Value {
    json!({
        "source": vault.relative(&plan.source),
        "target": vault.relative(&plan.target),
        "kind": plan.kind.as_str(),
        "changed": plan.changed,
        "expectedHash": plan.hash,
        "plannedHash": hash_bytes(plan.after.as_bytes()),
    })
}

#[cfg(test)]
mod tests {
    use super::call;
    use crate::app_core::{Core, EventSink};
    use crate::mcp::vault::Vault;
    use crate::search::models::SearchIndexState;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Duration;

    fn fixture(files: &[(&str, &str)]) -> (tempfile::TempDir, Arc<Core>, Vault) {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let root = directory.path().join("vault");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&root).unwrap();
        for (name, content) in files {
            let path = root.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let core = Core::open(&data, events);
        let mut config = core.settings.get_config();
        config.mcp.allow_write = true;
        core.settings.update_config(config).unwrap();
        let root = crate::search::paths::canonical_path(&root);
        core.ui_state
            .resolve_workspace(&root.to_string_lossy(), 1)
            .unwrap();
        core.search.prepare(&root.to_string_lossy()).unwrap();
        wait_ready(&core, &root);
        let vault = Vault {
            root,
            visible: false,
        };
        (directory, core, vault)
    }

    fn wait_ready(core: &Core, root: &Path) {
        let workspace = root.to_string_lossy().into_owned();
        for _ in 0..2000 {
            let status = core.search.status(Some(workspace.as_str()));
            if status.state == SearchIndexState::Ready && !status.updating {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("index did not finish the initial scan");
    }

    fn wait_revision(core: &Core, root: &Path, previous: u64) -> u64 {
        let workspace = root.to_string_lossy().into_owned();
        for _ in 0..2000 {
            let status = core.search.status(Some(workspace.as_str()));
            if status.revision > previous && !status.updating {
                return status.revision;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("index did not publish a revision after {previous}");
    }

    fn revision(core: &Core, root: &Path) -> u64 {
        let workspace = root.to_string_lossy().into_owned();
        core.search.status(Some(workspace.as_str())).revision
    }

    fn request(vault: &Vault, fields: Value) -> Value {
        let mut object = fields.as_object().cloned().unwrap_or_default();
        object.insert(
            "workspace".to_owned(),
            Value::String(vault.root.to_string_lossy().into_owned()),
        );
        Value::Object(object)
    }

    fn invoke(core: &Core, name: &str, arguments: &Value) -> Result<Value, String> {
        call(core, name, arguments).unwrap()
    }

    #[test]
    fn a_second_link_writes_nothing() {
        let (_guard, core, vault) = fixture(&[("A.md", "заметка A\n"), ("B.md", "заметка B\n")]);
        let arguments = request(&vault, json!({ "note": "A", "target": "B" }));
        let before = revision(&core, &vault.root);

        let first = invoke(&core, "link_notes", &arguments).unwrap();
        assert_eq!(first["changed"], true);
        let written = fs::read_to_string(vault.root.join("A.md")).unwrap();
        assert_eq!(written.matches("[[B]]").count(), 1);
        wait_revision(&core, &vault.root, before);
        let workspace = vault.root.to_string_lossy().into_owned();
        let backlinks = core
            .search
            .backlinks(&workspace, &vault.root.join("B.md").to_string_lossy())
            .unwrap();
        assert!(
            backlinks.iter().any(|link| link.path.ends_with("A.md")),
            "цель видит обратную ссылку: {:?}",
            backlinks
                .iter()
                .map(|link| link.path.as_str())
                .collect::<Vec<_>>()
        );

        let second = invoke(&core, "link_notes", &arguments).unwrap();
        assert_eq!(second["changed"], false);
        assert_eq!(
            fs::read_to_string(vault.root.join("A.md")).unwrap(),
            written
        );
    }

    #[test]
    fn unlink_keeps_the_second_mention() {
        let (_guard, core, vault) = fixture(&[
            ("A.md", "первая [[B]] и вторая [[B]]\n"),
            ("B.md", "заметка B\n"),
        ]);
        let arguments = request(&vault, json!({ "note": "A", "target": "B" }));

        let applied = invoke(&core, "unlink_notes", &arguments).unwrap();
        assert_eq!(applied["changed"], true);

        let written = fs::read_to_string(vault.root.join("A.md")).unwrap();
        assert_eq!(written.matches("[[B]]").count(), 1);
        assert!(written.contains("вторая"), "{written}");
    }

    #[test]
    fn a_structural_related_edge_reaches_the_graph() {
        let (_guard, core, vault) = fixture(&[("A.md", "заметка A\n"), ("B.md", "заметка B\n")]);
        let before = revision(&core, &vault.root);

        let applied = invoke(
            &core,
            "link_notes",
            &request(
                &vault,
                json!({ "note": "A", "target": "B", "kind": "related" }),
            ),
        )
        .unwrap();
        assert_eq!(applied["changed"], true);
        wait_revision(&core, &vault.root, before);

        let graph = core
            .search
            .graph_snapshot(&vault.root.to_string_lossy())
            .unwrap();
        let labels = graph.labels_between(&vault.root.join("A.md"), &vault.root.join("B.md"));
        assert!(labels.contains(&"related"), "{labels:?}");
    }

    #[test]
    fn the_neighborhood_respects_depth_and_direction() {
        let (_guard, core, vault) = fixture(&[
            ("A.md", "[[B]]\n"),
            ("B.md", "[[C]]\n"),
            ("C.md", "конец\n"),
        ]);

        let shallow = invoke(
            &core,
            "get_graph_neighborhood",
            &request(
                &vault,
                json!({ "note": "A", "depth": 1, "direction": "out" }),
            ),
        )
        .unwrap();
        let paths = |value: &Value| {
            value["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|node| node["path"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(paths(&shallow), vec!["A.md".to_owned(), "B.md".to_owned()]);

        let deep = invoke(
            &core,
            "get_graph_neighborhood",
            &request(
                &vault,
                json!({ "note": "A", "depth": 2, "direction": "out" }),
            ),
        )
        .unwrap();
        assert_eq!(
            paths(&deep),
            vec!["A.md".to_owned(), "B.md".to_owned(), "C.md".to_owned()]
        );

        let incoming = invoke(
            &core,
            "get_graph_neighborhood",
            &request(
                &vault,
                json!({ "note": "A", "depth": 2, "direction": "in" }),
            ),
        )
        .unwrap();
        assert_eq!(paths(&incoming), vec!["A.md".to_owned()]);

        let back = invoke(
            &core,
            "get_graph_neighborhood",
            &request(
                &vault,
                json!({ "note": "C", "depth": 2, "direction": "in" }),
            ),
        )
        .unwrap();
        assert_eq!(
            paths(&back),
            vec!["C.md".to_owned(), "B.md".to_owned(), "A.md".to_owned()]
        );
    }

    #[test]
    fn a_self_link_is_rejected() {
        let (_guard, core, vault) = fixture(&[("A.md", "заметка A\n")]);
        let error = invoke(
            &core,
            "link_notes",
            &request(&vault, json!({ "note": "A", "target": "A" })),
        )
        .unwrap_err();
        assert!(error.contains("самой"), "{error}");
    }
}
