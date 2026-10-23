use super::workspace::indexed_vault;
use super::{limit, optional_names, optional_text, shorten, tool_with, workspace_property};
use crate::app_core::Core;
use crate::files::document::read_text;
use crate::mcp::vault::Vault;
use crate::search::paths::identity;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

const MIN_DEPTH: usize = 1;
const MAX_DEPTH: usize = 3;
const DEFAULT_DEPTH: usize = 2;
const QUERY_SEEDS: usize = 3;
const HUB_DEGREE: usize = 40;
const MAX_PATHS: usize = 5;
const EXCERPT_LIMIT: usize = 200;
const DEFAULT_LIMIT: usize = 12;
const MAX_LIMIT: usize = 30;

pub fn definitions() -> Vec<Value> {
    vec![tool_with(
        "discover_connections",
        "Связи вокруг темы: обход графа [[...]] от указанных заметок или от трёх лучших результатов поиска по запросу. Возвращает узлы с расстоянием и степенью, существующие рёбра, короткие цепочки между разными затравками и подсказки — пары заметок через общий сосед без прямой ссылки, с фрагментами как доказательством. Ничего не пишет: связи применяются отдельно через link_notes.",
        json!({
            "notes": { "type": "array", "items": { "type": "string" }, "description": "Заметки-затравки: пути или названия, обход начнётся от них" },
            "query": { "type": "string", "description": "Тема для поиска: если notes не указаны, затравками станут три лучших результата" },
            "depth": { "type": "integer", "minimum": 1, "maximum": 3, "default": 2, "description": "Глубина обхода от 1 до 3, по умолчанию 2" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 30, "default": 12, "description": "Сколько заметок и подсказок вернуть, по умолчанию 12, максимум 30" },
            "workspace": workspace_property(),
        }),
        &[],
        json!({
            "anyOf": [
                { "required": ["notes"] },
                { "required": ["query"] },
            ],
        }),
    )]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "discover_connections" => discover_connections(core, arguments),
        _ => return None,
    })
}

fn discover_connections(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = indexed_vault(core, arguments)?;
    let depth = depth(arguments);
    let cap = limit(arguments, DEFAULT_LIMIT, MAX_LIMIT);
    let notes = optional_names(arguments, "notes")?.unwrap_or_default();
    let query = optional_text(arguments, "query");
    if notes.is_empty() && query.is_none() {
        return Err("Укажите notes или query: с чего начать поиск связей".to_owned());
    }
    let workspace = vault.root.to_string_lossy().into_owned();
    let settings = core.settings.get_config().search;
    let mut indexing = core.search.status(Some(workspace.as_str())).updating;
    let mut seeds = Vec::<PathBuf>::new();
    for name in &notes {
        let note = vault.note(core, name)?;
        push_unique(&mut seeds, note);
    }
    if let Some(query) = query.as_ref() {
        let response = core
            .search
            .search(&workspace, query, Some(QUERY_SEEDS), &settings)
            .map_err(|error| error.to_string())?;
        indexing = response.status.updating;
        for result in response.results.iter().take(QUERY_SEEDS) {
            push_unique(&mut seeds, PathBuf::from(result.path.as_str()));
        }
    }
    if seeds.is_empty() {
        return Ok(empty(indexing));
    }

    let graph = core
        .search
        .graph_snapshot(&workspace)
        .map_err(|error| error.to_string())?;
    let mut adjacency = HashMap::<String, BTreeSet<String>>::new();
    let mut directed = Vec::<(String, String, String)>::new();
    for (source, target, labels) in graph.edges() {
        adjacency
            .entry(source.to_owned())
            .or_default()
            .insert(target.to_owned());
        adjacency
            .entry(target.to_owned())
            .or_default()
            .insert(source.to_owned());
        let kind = labels.iter().copied().collect::<Vec<_>>().join(",");
        directed.push((source.to_owned(), target.to_owned(), kind));
    }

    let seed_keys = seeds.iter().map(|path| identity(path)).collect::<Vec<_>>();
    let mut absolute = HashMap::<String, PathBuf>::new();
    let mut distances = HashMap::<String, usize>::new();
    let mut order = Vec::<String>::new();
    let mut queue = VecDeque::<String>::new();
    for (key, path) in seed_keys.iter().zip(seeds.iter()) {
        if distances.contains_key(key) {
            continue;
        }
        distances.insert(key.clone(), 0);
        absolute.insert(key.clone(), path.clone());
        order.push(key.clone());
        queue.push_back(key.clone());
    }

    let node_cap = cap.max(seed_keys.len());
    let mut truncated = false;
    while let Some(current) = queue.pop_front() {
        let distance = distances.get(&current).copied().unwrap_or_default();
        if distance >= depth || degree(&adjacency, &current) > HUB_DEGREE {
            continue;
        }
        let neighbours = adjacency.get(&current).cloned().unwrap_or_default();
        for neighbour in neighbours {
            if distances.contains_key(&neighbour) || degree(&adjacency, &neighbour) > HUB_DEGREE {
                continue;
            }
            let Some(path) = graph.path_of(&neighbour) else {
                continue;
            };
            if order.len() >= node_cap {
                truncated = true;
                continue;
            }
            distances.insert(neighbour.clone(), distance + 1);
            absolute.insert(neighbour.clone(), PathBuf::from(path));
            order.push(neighbour.clone());
            queue.push_back(neighbour);
        }
    }

    let nodes = order
        .iter()
        .map(|key| {
            json!({
                "path": relative(&vault, key, &absolute),
                "distance": distances.get(key).copied().unwrap_or_default(),
                "degree": degree(&adjacency, key),
            })
        })
        .collect::<Vec<_>>();

    let mut edges = directed
        .iter()
        .filter(|item| distances.contains_key(&item.0) && distances.contains_key(&item.1))
        .map(|(source, target, kind)| {
            json!({
                "from": relative(&vault, source, &absolute),
                "to": relative(&vault, target, &absolute),
                "kind": kind,
                "existing": true,
            })
        })
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| {
        left["from"]
            .as_str()
            .cmp(&right["from"].as_str())
            .then_with(|| left["to"].as_str().cmp(&right["to"].as_str()))
            .then_with(|| left["kind"].as_str().cmp(&right["kind"].as_str()))
    });

    let mut chains = Vec::<Vec<String>>::new();
    for left in 0..seed_keys.len() {
        for right in (left + 1)..seed_keys.len() {
            let Some(chain) =
                shortest_path(&adjacency, &distances, &seed_keys[left], &seed_keys[right])
            else {
                continue;
            };
            if chain.len().saturating_sub(1) > depth {
                continue;
            }
            chains.push(chain);
        }
    }
    chains.sort_by_key(Vec::len);
    if chains.len() > MAX_PATHS {
        chains.truncate(MAX_PATHS);
        truncated = true;
    }
    let paths = chains
        .iter()
        .map(|chain| {
            chain
                .iter()
                .map(|key| relative(&vault, key, &absolute))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut candidates = Vec::<(usize, String, String, Vec<String>)>::new();
    for left in 0..order.len() {
        for right in (left + 1)..order.len() {
            let from = &order[left];
            let to = &order[right];
            if is_linked(&adjacency, from, to) {
                continue;
            }
            let shared = shared_neighbours(&adjacency, &distances, from, to);
            if shared.is_empty() {
                continue;
            }
            candidates.push((shared.len(), from.clone(), to.clone(), shared));
        }
    }
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    if candidates.len() > cap {
        candidates.truncate(cap);
        truncated = true;
    }
    let suggested = candidates
        .iter()
        .map(|(count, from, to, shared)| {
            let mut reasons = vec![format!("общих соседей: {count}")];
            for neighbour in shared.iter().take(3) {
                reasons.push(format!(
                    "общий сосед: {}",
                    Vault::title(Path::new(neighbour))
                ));
            }
            reasons.push("прямой ссылки нет".to_owned());
            json!({
                "from": relative(&vault, from, &absolute),
                "to": relative(&vault, to, &absolute),
                "kind": "wiki",
                "existing": false,
                "reasons": reasons,
                "evidence": {
                    "fromExcerpt": excerpt(absolute.get(from)),
                    "toExcerpt": excerpt(absolute.get(to)),
                },
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "seeds": seed_keys
            .iter()
            .map(|key| relative(&vault, key, &absolute))
            .collect::<Vec<_>>(),
        "nodes": nodes,
        "edges": edges,
        "suggested": suggested,
        "paths": paths,
        "indexing": indexing,
        "truncated": truncated,
    }))
}

fn empty(indexing: bool) -> Value {
    json!({
        "seeds": [],
        "nodes": [],
        "edges": [],
        "suggested": [],
        "paths": [],
        "indexing": indexing,
        "truncated": false,
    })
}

fn depth(arguments: &Value) -> usize {
    arguments
        .get("depth")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_DEPTH, |value| {
            usize::try_from(value)
                .unwrap_or(MAX_DEPTH)
                .clamp(MIN_DEPTH, MAX_DEPTH)
        })
}

fn push_unique(seeds: &mut Vec<PathBuf>, path: PathBuf) {
    let key = identity(&path);
    if !seeds.iter().any(|existing| identity(existing) == key) {
        seeds.push(path);
    }
}

fn degree(adjacency: &HashMap<String, BTreeSet<String>>, key: &str) -> usize {
    adjacency.get(key).map_or(0, BTreeSet::len)
}

fn is_linked(adjacency: &HashMap<String, BTreeSet<String>>, left: &str, right: &str) -> bool {
    adjacency
        .get(left)
        .is_some_and(|neighbours| neighbours.contains(right))
}

fn shared_neighbours(
    adjacency: &HashMap<String, BTreeSet<String>>,
    visited: &HashMap<String, usize>,
    left: &str,
    right: &str,
) -> Vec<String> {
    let Some(left_neighbours) = adjacency.get(left) else {
        return Vec::new();
    };
    let Some(right_neighbours) = adjacency.get(right) else {
        return Vec::new();
    };
    let (small, large) = if left_neighbours.len() <= right_neighbours.len() {
        (left_neighbours, right_neighbours)
    } else {
        (right_neighbours, left_neighbours)
    };
    small
        .iter()
        .filter(|neighbour| large.contains(*neighbour) && visited.contains_key(*neighbour))
        .cloned()
        .collect()
}

fn shortest_path(
    adjacency: &HashMap<String, BTreeSet<String>>,
    visited: &HashMap<String, usize>,
    from: &str,
    to: &str,
) -> Option<Vec<String>> {
    if from == to {
        return None;
    }
    let mut previous = HashMap::<String, String>::new();
    let mut seen = HashSet::<String>::from([from.to_owned()]);
    let mut queue = VecDeque::<String>::from([from.to_owned()]);
    while let Some(current) = queue.pop_front() {
        if current == to {
            break;
        }
        for neighbour in adjacency.get(&current).into_iter().flatten() {
            if !visited.contains_key(neighbour) || !seen.insert(neighbour.clone()) {
                continue;
            }
            previous.insert(neighbour.clone(), current.clone());
            queue.push_back(neighbour.clone());
        }
    }
    if !seen.contains(to) {
        return None;
    }
    let mut chain = vec![to.to_owned()];
    let mut current = to.to_owned();
    while let Some(parent) = previous.get(&current) {
        chain.push(parent.clone());
        current = parent.clone();
    }
    chain.reverse();
    Some(chain)
}

fn relative(vault: &Vault, key: &str, absolute: &HashMap<String, PathBuf>) -> String {
    absolute
        .get(key)
        .map(|path| vault.relative(path))
        .unwrap_or_else(|| key.to_owned())
}

fn excerpt(path: Option<&PathBuf>) -> String {
    let Some(path) = path else {
        return String::new();
    };
    let Ok(text) = read_text(path) else {
        return String::new();
    };
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let mut first = lines.next().unwrap_or_default();
    if first == "---" {
        let mut rest = lines.skip_while(|line| *line != "---");
        rest.next();
        first = rest.next().unwrap_or_default();
    }
    let first = first.trim_start_matches('#').trim();
    shorten(first, EXCERPT_LIMIT)
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

    fn request(vault: &Vault, fields: Value) -> Value {
        let mut object = fields.as_object().cloned().unwrap_or_default();
        object.insert(
            "workspace".to_owned(),
            Value::String(vault.root.to_string_lossy().into_owned()),
        );
        Value::Object(object)
    }

    fn invoke(core: &Core, arguments: &Value) -> Value {
        call(core, "discover_connections", arguments)
            .unwrap()
            .unwrap()
    }

    fn strings(value: &Value, key: &str, field: &str) -> Vec<String> {
        value[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item[field].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn two_seeds_are_joined_through_a_middle_note() {
        let (_guard, core, vault) = fixture(&[
            ("A.md", "начало [[Middle]]\n"),
            ("B.md", "конец [[Middle]]\n"),
            ("Middle.md", "середина\n"),
        ]);

        let found = invoke(&core, &request(&vault, json!({ "notes": ["A", "B"] })));

        let paths = found["paths"].as_array().unwrap();
        assert!(
            paths
                .iter()
                .any(|chain| chain == &json!(["A.md", "Middle.md", "B.md"])),
            "цепочка между затравками: {paths:?}"
        );
        assert_eq!(
            strings(&found, "nodes", "path"),
            vec!["A.md", "B.md", "Middle.md"]
        );

        let suggested = found["suggested"].as_array().unwrap();
        let pair = suggested
            .iter()
            .find(|item| item["from"] == "A.md" && item["to"] == "B.md")
            .expect("пара через общий сосед предложена");
        assert_eq!(pair["existing"], false);
        assert_eq!(pair["kind"], "wiki");
        assert_eq!(pair["evidence"]["fromExcerpt"], "начало [[Middle]]");
        assert_eq!(pair["evidence"]["toExcerpt"], "конец [[Middle]]");
    }

    #[test]
    fn an_already_linked_pair_is_not_suggested() {
        let (_guard, core, vault) = fixture(&[
            ("A.md", "[[B]]\n[[C]]\n"),
            ("B.md", "[[C]]\n"),
            ("C.md", "общий сосед\n"),
        ]);

        let found = invoke(&core, &request(&vault, json!({ "notes": ["A", "B"] })));

        let suggested = found["suggested"].as_array().unwrap();
        assert!(
            !suggested
                .iter()
                .any(|item| item["from"] == "A.md" && item["to"] == "B.md"),
            "прямая ссылка не предлагается: {suggested:?}"
        );
        assert!(suggested.is_empty(), "{suggested:?}");
    }

    #[test]
    fn a_hub_does_not_swallow_the_result() {
        let mut hub = String::new();
        for index in 0..45 {
            hub.push_str(&format!("[[N{index:02}]]\n"));
        }
        let mut files = vec![
            ("A.md".to_owned(), "[[Hub]]\n".to_owned()),
            ("B.md".to_owned(), "[[Hub]]\n".to_owned()),
            ("Hub.md".to_owned(), hub),
        ];
        for index in 0..45 {
            files.push((format!("N{index:02}.md"), "лист [[Hub]]\n".to_owned()));
        }
        let borrowed = files
            .iter()
            .map(|(name, content)| (name.as_str(), content.as_str()))
            .collect::<Vec<_>>();
        let (_guard, core, vault) = fixture(&borrowed);

        let found = invoke(
            &core,
            &request(&vault, json!({ "notes": ["A", "B"], "depth": 2 })),
        );

        let nodes = strings(&found, "nodes", "path");
        assert!(!nodes.contains(&"Hub.md".to_owned()), "{nodes:?}");
        assert_eq!(nodes, vec!["A.md".to_owned(), "B.md".to_owned()]);
    }

    #[test]
    fn depth_one_stops_before_the_second_hop() {
        let (_guard, core, vault) = fixture(&[
            ("A.md", "[[B]]\n"),
            ("B.md", "[[C]]\n"),
            ("C.md", "конец\n"),
        ]);

        let found = invoke(
            &core,
            &request(&vault, json!({ "notes": ["A"], "depth": 1 })),
        );

        let nodes = strings(&found, "nodes", "path");
        assert_eq!(nodes, vec!["A.md".to_owned(), "B.md".to_owned()]);
        assert!(!nodes.contains(&"C.md".to_owned()), "{nodes:?}");
    }

    #[test]
    fn seeds_are_required() {
        let (_guard, core, vault) = fixture(&[("A.md", "заметка\n")]);

        let error = call(&core, "discover_connections", &request(&vault, json!({})))
            .unwrap()
            .unwrap_err();
        assert!(error.contains("notes"), "{error}");
        assert!(error.contains("query"), "{error}");
    }
}
