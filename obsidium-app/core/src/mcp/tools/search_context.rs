use super::workspace::indexed_vault;
use super::{limit, optional_text, text, tool, workspace_property};
use crate::app_core::Core;
use crate::files::document::{read_file_snapshot_impl, read_text};
use crate::mcp::vault::Vault;
use crate::search::analysis::graph::GraphSnapshot;
use crate::search::analysis::models::AnalysisMethod;
use crate::search::excerpt::{self, Fragment};
use crate::search::fields;
use crate::search::matching::find_prefix_matches;
use crate::search::paths::identity;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 20;
const DEFAULT_MAX_CHARS: usize = 12_000;
const MIN_MAX_CHARS: usize = 2_000;
const MAX_MAX_CHARS: usize = 40_000;
const DEFAULT_GRAPH_DEPTH: usize = 1;
const MAX_GRAPH_DEPTH: usize = 2;
const CANDIDATE_FACTOR: usize = 8;
const MAX_CANDIDATES: usize = 200;
const DEEP_SEEDS: usize = 3;
const FRAGMENTS_PER_NOTE: usize = 2;
const RRF_K: f64 = 60.0;
const TEXT_WEIGHT: f64 = 1.0;
const TAGS_WEIGHT: f64 = 0.6;
const GRAPH_WEIGHT: f64 = 0.4;
const GRAPH_ONLY_PENALTY: f64 = 0.5;
const ARCHIVE_PENALTY: f64 = 0.45;

pub fn definitions() -> Vec<Value> {
    vec![tool(
        "search_context",
        "Ограниченная подготовка контекста для ответа: фрагменты заметок с путями, разделами, строками, причинами совпадения и хэшами. Tantivy даёт основной лексический порядок; граф ссылок дополняет свободные места, но не поднимает заметку над прямым совпадением. Это полнотекстовый поиск, не семантический. folder и tags сужают набор, mode=deep дополнительно использует BM25F и Adamic-Adar. Индекс сообщает состояние и число документов. Ответ ограничен maxChars символов JSON; truncated и omitted показывают усечение, hasMore — наличие следующих кандидатов. searchMethod указывает реально использованные лексические, графовые и BM25F-сигналы. hash пригоден для expectedHash при последующей правке.",
        json!({
            "query": { "type": "string", "description": "Поисковый запрос: слова, которые должны встретиться в заметке" },
            "workspace": workspace_property(),
            "folder": { "type": "string", "description": "Искать только в этой папке, пусто — вся база; окно кандидатов расширяется, пока фильтр не даст limit результатов или поиск не исчерпает лимит" },
            "tags": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Оставить только заметки с этими тегами frontmatter",
            },
            "seedNotes": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Заметки, от которых начать обход графа в дополнение к лучшим результатам поиска",
            },
            "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "Сколько заметок вернуть, по умолчанию 8, максимум 20" },
            "maxChars": { "type": "integer", "minimum": MIN_MAX_CHARS, "maximum": MAX_MAX_CHARS, "description": "Предел размера results в символах JSON, по умолчанию 12000, от 2000 до 40000" },
            "graphDepth": { "type": "integer", "minimum": 0, "maximum": MAX_GRAPH_DEPTH, "description": "Глубина обхода графа ссылок от 0 до 2, по умолчанию 1; 0 отключает соседей" },
            "mode": { "type": "string", "enum": ["fast", "deep"], "description": "fast — только поиск и граф, deep — ещё BM25F и Adamic-Adar для лучших заметок" },
        }),
        &["query"],
    )]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    match name {
        "search_context" => Some(search_context(core, arguments)),
        _ => None,
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Mode {
    Fast,
    Deep,
}

impl Mode {
    fn parse(arguments: &Value) -> Result<Self, String> {
        match optional_text(arguments, "mode")
            .map(|value| value.to_lowercase())
            .as_deref()
        {
            None | Some("fast") => Ok(Self::Fast),
            Some("deep") => Ok(Self::Deep),
            Some(other) => Err(format!("Режим «{other}» неизвестен: fast или deep")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Deep => "deep",
        }
    }
}

struct Candidate {
    path: PathBuf,
    text_rank: Option<usize>,
    tags_rank: Option<usize>,
    graph_rank: Option<usize>,
    distance: Option<usize>,
    via: Option<PathBuf>,
    matched_tags: Vec<String>,
    archived: bool,
}

impl Candidate {
    fn new(path: PathBuf) -> Self {
        let archived = is_archived(&path);
        Self {
            path,
            text_rank: None,
            tags_rank: None,
            graph_rank: None,
            distance: None,
            via: None,
            matched_tags: Vec::new(),
            archived,
        }
    }

    fn signal(&self) -> (f64, f64, f64) {
        (
            rank_signal(self.text_rank, TEXT_WEIGHT),
            rank_signal(self.tags_rank, TAGS_WEIGHT),
            rank_signal(self.graph_rank, GRAPH_WEIGHT),
        )
    }

    fn score(&self) -> f64 {
        let (text, tags, graph) = self.signal();
        let base = if text == 0.0 {
            graph * GRAPH_ONLY_PENALTY
        } else {
            text + tags
        };
        base * self.archive_penalty()
    }

    fn archive_penalty(&self) -> f64 {
        if self.archived {
            ARCHIVE_PENALTY
        } else {
            1.0
        }
    }
}

fn rank_signal(rank: Option<usize>, weight: f64) -> f64 {
    rank.map_or(0.0, |rank| weight / (RRF_K + rank as f64))
}

fn search_context(core: &Core, arguments: &Value) -> Result<Value, String> {
    let query = text(arguments, "query")?;
    let vault = indexed_vault(core, arguments)?;
    let folder = optional_text(arguments, "folder")
        .map(|value| normalize_folder(&value))
        .filter(|value| !value.is_empty());
    let mut tags = string_list(arguments, "tags")?
        .iter()
        .map(|tag| normalize_tag(tag))
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    let size = limit(arguments, DEFAULT_LIMIT, MAX_LIMIT);
    let max_chars = integer(
        arguments,
        "maxChars",
        DEFAULT_MAX_CHARS,
        MIN_MAX_CHARS,
        MAX_MAX_CHARS,
    );
    let depth = integer(
        arguments,
        "graphDepth",
        DEFAULT_GRAPH_DEPTH,
        0,
        MAX_GRAPH_DEPTH,
    );
    let mode = Mode::parse(arguments)?;
    let seeds = seed_notes(core, &vault, arguments)?;
    let workspace = vault.root.to_string_lossy().into_owned();
    let config = core.settings.get_config();
    let mut window = (size.saturating_mul(CANDIDATE_FACTOR))
        .min(MAX_CANDIDATES)
        .max(1);
    let mut candidates = Vec::<Candidate>::new();
    let mut index = HashMap::<String, usize>::new();
    let mut text_order = Vec::<usize>::new();
    let (terms, indexing, index_status) = loop {
        let response = core
            .search
            .search(&workspace, &query, Some(window), &config.search)
            .map_err(|error| error.to_string())?;
        let terms = response.query_terms;
        let indexing = response.status.updating;
        let index_status = json!({
            "state": response.status.state,
            "updating": indexing,
            "indexedDocuments": response.status.indexed_documents,
            "scannedDocuments": response.status.scanned_documents,
        });
        let returned = response.results.len();
        for result in response.results {
            push_text(
                &mut candidates,
                &mut index,
                &mut text_order,
                PathBuf::from(&result.path),
                &result.matched_tags,
                &tags,
                folder.as_deref(),
                &vault,
            );
        }
        if text_order.len() >= size
            || returned < window
            || window >= crate::search::query::MAX_WINDOW
        {
            break (terms, indexing, index_status);
        }
        window = (window * 2).min(crate::search::query::MAX_WINDOW);
    };

    let deep_seeds = text_order
        .iter()
        .take(DEEP_SEEDS)
        .map(|position| candidates[*position].path.clone())
        .collect::<Vec<_>>();
    let mut bm25f_used = false;
    if mode == Mode::Deep {
        for seed in &deep_seeds {
            if let Ok(found) = core.search.analyze_document(
                &workspace,
                &seed.to_string_lossy(),
                AnalysisMethod::Bm25f,
                Some(size),
                &config,
            ) {
                bm25f_used = true;
                for result in found {
                    push_text(
                        &mut candidates,
                        &mut index,
                        &mut text_order,
                        PathBuf::from(&result.path),
                        &[],
                        &tags,
                        folder.as_deref(),
                        &vault,
                    );
                }
            }
        }
    }

    let mut graph_order = Vec::<usize>::new();
    let mut graph_used = false;
    let mut adamic_adar_used = false;
    if depth > 0 {
        if let Ok(graph) = core.search.graph_snapshot(&workspace) {
            if !text_order.is_empty() || !seeds.is_empty() {
                expand_graph(
                    &graph,
                    &vault,
                    &mut candidates,
                    &mut index,
                    &mut graph_order,
                    &text_order,
                    &seeds,
                    &tags,
                    folder.as_deref(),
                    size,
                    depth,
                );
                graph_used = true;
            }
        }
        if mode == Mode::Deep {
            for seed in &deep_seeds {
                if let Ok(found) = core.search.analyze_document(
                    &workspace,
                    &seed.to_string_lossy(),
                    AnalysisMethod::AdamicAdar,
                    Some(size),
                    &config,
                ) {
                    adamic_adar_used = true;
                    for result in found {
                        let path = PathBuf::from(&result.path);
                        let relative = vault.relative(&path);
                        if !folder
                            .as_deref()
                            .is_none_or(|folder| in_folder(&relative, folder))
                        {
                            continue;
                        }
                        let hits = if tags.is_empty() {
                            Vec::new()
                        } else {
                            match matched_tags_for(&path, &[], &tags) {
                                Some(hits) => hits,
                                None => continue,
                            }
                        };
                        let position = ensure(&mut candidates, &mut index, path);
                        let candidate = &mut candidates[position];
                        candidate.distance = None;
                        candidate.via = Some(seed.clone());
                        if !hits.is_empty() {
                            candidate.matched_tags = hits;
                        }
                        if !graph_order.contains(&position) {
                            graph_order.push(position);
                        }
                    }
                }
            }
        }
    }

    for (rank, position) in text_order.iter().enumerate() {
        candidates[*position].text_rank = Some(rank + 1);
    }
    let mut tags_order = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !candidate.matched_tags.is_empty())
        .map(|(position, _)| position)
        .collect::<Vec<_>>();
    tags_order.sort_by(|left, right| {
        let left = &candidates[*left];
        let right = &candidates[*right];
        right
            .matched_tags
            .len()
            .cmp(&left.matched_tags.len())
            .then_with(|| {
                left.text_rank
                    .unwrap_or(usize::MAX)
                    .cmp(&right.text_rank.unwrap_or(usize::MAX))
            })
            .then_with(|| left.path.cmp(&right.path))
    });
    for (rank, position) in tags_order.iter().enumerate() {
        candidates[*position].tags_rank = Some(rank + 1);
    }
    for (rank, position) in graph_order.iter().enumerate() {
        candidates[*position].graph_rank = Some(rank + 1);
    }

    let mut ordered = (0..candidates.len()).collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let left = &candidates[*left];
        let right = &candidates[*right];
        right
            .score()
            .partial_cmp(&left.score())
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                left.text_rank
                    .unwrap_or(usize::MAX)
                    .cmp(&right.text_rank.unwrap_or(usize::MAX))
            })
            .then_with(|| left.path.cmp(&right.path))
    });

    let mut results = Vec::<Value>::new();
    let mut omitted = 0usize;
    let mut has_more = false;
    let mut seen_excerpts = HashSet::<String>::new();
    let mut included_notes = 0usize;
    for position in &ordered {
        if included_notes >= size {
            has_more = true;
            break;
        }
        let candidate = &candidates[*position];
        let Ok(snapshot) = read_file_snapshot_impl(&candidate.path) else {
            continue;
        };
        let found = excerpt::fragments(&snapshot.content, &terms, FRAGMENTS_PER_NOTE);
        if found.is_empty() {
            continue;
        }
        let mut included = false;
        for fragment in found {
            if seen_excerpts.contains(&fragment.excerpt) {
                continue;
            }
            let value = fragment_value(&vault, candidate, &fragment, &snapshot.hash, &terms);
            results.push(value);
            let chars = serde_json::to_string(&results)
                .map_err(|error| error.to_string())?
                .chars()
                .count();
            if chars > max_chars {
                results.pop();
                omitted += 1;
            } else {
                seen_excerpts.insert(fragment.excerpt.clone());
                included = true;
            }
        }
        if included {
            included_notes += 1;
        }
    }
    let used = serde_json::to_string(&results)
        .map_err(|error| error.to_string())?
        .chars()
        .count();
    let mut search_methods = vec!["tantivy"];
    if bm25f_used {
        search_methods.push("bm25f");
    }
    if adamic_adar_used {
        search_methods.push("adamic-adar");
    }
    if graph_used {
        search_methods.push("graph");
    }
    let search_method = search_methods.join("+");

    Ok(json!({
        "indexing": indexing,
        "indexStatus": index_status,
        "searchMethod": search_method,
        "query": {
            "terms": terms,
            "folder": folder,
            "tags": tags,
        },
        "mode": mode.as_str(),
        "results": results,
        "truncated": omitted > 0,
        "hasMore": has_more,
        "omitted": omitted,
        "budget": {
            "maxChars": max_chars,
            "usedChars": used,
        },
    }))
}

#[allow(clippy::too_many_arguments)]
fn push_text(
    candidates: &mut Vec<Candidate>,
    index: &mut HashMap<String, usize>,
    order: &mut Vec<usize>,
    path: PathBuf,
    matched: &[String],
    wanted: &[String],
    folder: Option<&str>,
    vault: &Vault,
) {
    let relative = vault.relative(&path);
    if !folder.is_none_or(|folder| in_folder(&relative, folder)) {
        return;
    }
    let Some(hits) = matched_tags_for(&path, matched, wanted) else {
        return;
    };
    let position = ensure(candidates, index, path);
    if !hits.is_empty() {
        candidates[position].matched_tags = hits;
    }
    if !order.contains(&position) {
        order.push(position);
    }
}

#[allow(clippy::too_many_arguments)]
fn expand_graph(
    graph: &GraphSnapshot,
    vault: &Vault,
    candidates: &mut Vec<Candidate>,
    index: &mut HashMap<String, usize>,
    graph_order: &mut Vec<usize>,
    text_order: &[usize],
    seeds: &[PathBuf],
    tags: &[String],
    folder: Option<&str>,
    size: usize,
    depth: usize,
) {
    let adjacency = adjacency(graph);
    let mut visited = HashSet::<String>::new();
    let mut queue = VecDeque::<(String, usize)>::new();
    for position in text_order.iter().take(size) {
        let key = identity(&candidates[*position].path);
        if visited.insert(key.clone()) {
            queue.push_back((key, 0));
        }
    }
    for seed in seeds {
        let key = identity(seed);
        if visited.insert(key.clone()) {
            queue.push_back((key, 0));
        }
    }

    while let Some((node, distance)) = queue.pop_front() {
        if distance >= depth {
            continue;
        }
        let Some(neighbours) = adjacency.get(&node) else {
            continue;
        };
        for neighbour in neighbours {
            if !visited.insert(neighbour.clone()) {
                continue;
            }
            let Some(path) = graph.path_of(neighbour).map(PathBuf::from) else {
                continue;
            };
            let relative = vault.relative(&path);
            if !folder.is_none_or(|folder| in_folder(&relative, folder)) {
                continue;
            }
            let hits = if tags.is_empty() {
                Vec::new()
            } else {
                match matched_tags_for(&path, &[], tags) {
                    Some(hits) => hits,
                    None => continue,
                }
            };
            let position = ensure(candidates, index, path);
            let candidate = &mut candidates[position];
            candidate.distance = Some(distance + 1);
            candidate.via = graph.path_of(&node).map(PathBuf::from);
            if !hits.is_empty() {
                candidate.matched_tags = hits;
            }
            if !graph_order.contains(&position) {
                graph_order.push(position);
            }
            queue.push_back((neighbour.clone(), distance + 1));
        }
    }
}

fn adjacency(graph: &GraphSnapshot) -> HashMap<String, Vec<String>> {
    let mut adjacency = HashMap::<String, Vec<String>>::new();
    for (source, target, _) in graph.edges() {
        adjacency
            .entry(source.to_owned())
            .or_default()
            .push(target.to_owned());
        adjacency
            .entry(target.to_owned())
            .or_default()
            .push(source.to_owned());
    }
    for neighbours in adjacency.values_mut() {
        neighbours.sort();
        neighbours.dedup();
    }
    adjacency
}

fn ensure(
    candidates: &mut Vec<Candidate>,
    index: &mut HashMap<String, usize>,
    path: PathBuf,
) -> usize {
    let key = identity(&path);
    if let Some(position) = index.get(&key) {
        return *position;
    }
    let position = candidates.len();
    candidates.push(Candidate::new(path));
    index.insert(key, position);
    position
}

fn fragment_value(
    vault: &Vault,
    candidate: &Candidate,
    fragment: &Fragment,
    hash: &str,
    terms: &[String],
) -> Value {
    let (text, tags, graph) = candidate.signal();
    json!({
        "path": vault.relative(&candidate.path),
        "heading": fragment.heading,
        "lineStart": fragment.line_start,
        "lineEnd": fragment.line_end,
        "excerpt": fragment.excerpt,
        "hash": hash,
        "reasons": reasons(vault, candidate, fragment, terms),
        "signals": {
            "text": round(text),
            "tags": round(tags),
            "graph": round(graph),
        },
        "score": round(candidate.score()),
    })
}

fn reasons(
    vault: &Vault,
    candidate: &Candidate,
    fragment: &Fragment,
    terms: &[String],
) -> Vec<String> {
    let mut reasons = Vec::new();
    if let Some(heading) = fragment.heading.as_deref() {
        if !find_prefix_matches(heading, terms).is_empty() {
            reasons.push("совпадение по заголовку".to_owned());
        }
    }
    let matched = matched_terms(&fragment.excerpt, terms);
    if !matched.is_empty() {
        reasons.push(format!("совпадение по тексту: {}", matched.join(", ")));
    }
    for tag in &candidate.matched_tags {
        reasons.push(format!("тег «{tag}»"));
    }
    if let Some(via) = candidate.via.as_deref() {
        let relative = vault.relative(via);
        let name = relative.strip_suffix(".md").unwrap_or(&relative);
        match candidate.distance {
            Some(1) => reasons.push(format!("ссылка из «{name}»")),
            Some(2) => reasons.push(format!("общий сосед «{name}»")),
            _ => reasons.push(format!("связь через «{name}»")),
        }
    }
    if reasons.is_empty() {
        reasons.push("фрагмент заметки".to_owned());
    }
    reasons
}

fn matched_terms(text: &str, terms: &[String]) -> Vec<String> {
    let mut hit = vec![false; terms.len()];
    for (_, _, index) in find_prefix_matches(text, terms) {
        hit[index] = true;
    }
    terms
        .iter()
        .zip(hit)
        .filter(|(_, found)| *found)
        .map(|(term, _)| term.clone())
        .collect()
}

fn seed_notes(core: &Core, vault: &Vault, arguments: &Value) -> Result<Vec<PathBuf>, String> {
    string_list(arguments, "seedNotes")?
        .iter()
        .map(|name| vault.note(core, name))
        .collect()
}

fn matched_tags_for(path: &Path, matched: &[String], wanted: &[String]) -> Option<Vec<String>> {
    let matched = matched
        .iter()
        .map(|tag| normalize_tag(tag))
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    if wanted.is_empty() {
        return Some(matched);
    }
    let all = if matched.is_empty() {
        let content = read_text(path).ok()?;
        frontmatter_tags(&content)
    } else {
        matched
    };
    let mut hits = Vec::new();
    for want in wanted {
        if all.iter().any(|tag| tag == want) {
            hits.push(want.clone());
        } else {
            return None;
        }
    }
    Some(hits)
}

fn frontmatter_tags(content: &str) -> Vec<String> {
    fields::note_fields(content)
        .into_iter()
        .find(|field| field.key.eq_ignore_ascii_case("tags"))
        .map(|field| {
            if field.items.is_empty() {
                field
                    .text
                    .split([',', ' '])
                    .map(|tag| normalize_tag(tag))
                    .filter(|tag| !tag.is_empty())
                    .collect()
            } else {
                field
                    .items
                    .iter()
                    .map(|tag| normalize_tag(tag))
                    .filter(|tag| !tag.is_empty())
                    .collect()
            }
        })
        .unwrap_or_default()
}

fn is_archived(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        matches!(
            name.as_str(),
            "архив" | "archive" | "archived" | "archive-old" | "старое"
        )
    }) || path.file_stem().is_some_and(|name| {
        let name = name.to_string_lossy().to_lowercase();
        ["копия", "stale", "устарев"]
            .iter()
            .any(|marker| name.contains(marker))
            || name
                .split([' ', '-', '_', '(', ')', '[', ']'])
                .any(|part| matches!(part, "old" | "backup" | "copy"))
    })
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('#').to_lowercase()
}

fn normalize_folder(value: &str) -> String {
    value.trim().replace('\\', "/").trim_matches('/').to_owned()
}

fn in_folder(relative: &str, folder: &str) -> bool {
    relative == folder
        || relative
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn string_list(arguments: &Value, key: &str) -> Result<Vec<String>, String> {
    let Some(value) = arguments.get(key) else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let list = value
        .as_array()
        .ok_or_else(|| format!("Аргумент «{key}» должен быть списком строк"))?;
    let mut found = Vec::new();
    for item in list {
        let item = item
            .as_str()
            .ok_or_else(|| format!("Аргумент «{key}» должен быть списком строк"))?
            .trim();
        if !item.is_empty()
            && !found
                .iter()
                .any(|existing: &String| existing.as_str() == item)
        {
            found.push(item.to_owned());
        }
    }
    Ok(found)
}

fn integer(arguments: &Value, key: &str, fallback: usize, minimum: usize, maximum: usize) -> usize {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .map_or(fallback, |value| value as usize)
        .clamp(minimum, maximum)
}

fn round(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::call as dispatch;
    use crate::app_core::{Core, EventSink};
    use crate::search::models::SearchIndexState;
    use serde_json::{json, Value};
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    fn call(core: &Core, name: &str, arguments: &Value) -> Result<Value, String> {
        dispatch(core, name, arguments)
            .unwrap_or_else(|| Err(format!("инструмент не зарегистрирован: {name}")))
    }

    fn fixture(files: &[(&str, &str)]) -> (tempfile::TempDir, Arc<Core>, PathBuf) {
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
        (directory, core, root)
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

    fn paths(answer: &Value) -> Vec<String> {
        answer["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn a_query_returns_the_section_with_real_line_numbers() {
        let content = "# Введение\n\nОбщие сведения.\n\n## Установка\n\nСтавим пакет командой установка пакета.\n\n## Настройка\n\nМеняем параметры.\n";
        let (_directory, core, root) = fixture(&[("Установка.md", content)]);

        let answer = call(&core, "search_context", &json!({ "query": "установка" })).unwrap();

        let first = &answer["results"][0];
        assert_eq!(answer["searchMethod"], "tantivy+graph");
        assert_eq!(first["heading"], "Установка", "{answer}");
        let start = first["lineStart"].as_u64().unwrap() as usize;
        let end = first["lineEnd"].as_u64().unwrap() as usize;
        let excerpt = first["excerpt"].as_str().unwrap();
        let file = fs::read_to_string(root.join("Установка.md")).unwrap();
        let lines = file.lines().collect::<Vec<_>>();
        assert!(end <= lines.len(), "{answer}");
        assert_eq!(lines[start - 1..end].join("\n"), excerpt, "{answer}");
        assert!(excerpt.contains("установка"), "{answer}");
        assert_eq!(first["hash"].as_str().unwrap().len(), 64, "{answer}");
        core.shutdown();
    }

    #[test]
    fn the_same_excerpt_is_never_returned_twice() {
        let content = "# Раздел\n\nслово\n\n# Раздел\n\nслово\n";
        let (_directory, core, _root) = fixture(&[("Повтор.md", content)]);

        let answer = call(&core, "search_context", &json!({ "query": "слово" })).unwrap();

        let results = answer["results"].as_array().unwrap();
        assert_eq!(results.len(), 1, "{answer}");
        let mut seen = HashSet::new();
        for item in results {
            let key = (
                item["path"].as_str().unwrap().to_owned(),
                item["excerpt"].as_str().unwrap().to_owned(),
            );
            assert!(seen.insert(key), "фрагмент повторился: {answer}");
        }
        core.shutdown();
    }

    #[test]
    fn exact_excerpts_are_deduplicated_across_notes_and_lower_results_fill_slots() {
        let (_directory, core, _root) = fixture(&[
            ("А.md", "# Раздел\n\nсовпадение общее\n"),
            ("Б.md", "# Раздел\n\nсовпадение общее\n"),
            ("В.md", "# Раздел\n\nсовпадение уникальное\n"),
        ]);

        let answer = call(
            &core,
            "search_context",
            &json!({ "query": "совпадение", "limit": 2, "graphDepth": 0 }),
        )
        .unwrap();

        let results = answer["results"].as_array().unwrap();
        assert_eq!(results.len(), 2, "{answer}");
        let excerpts = results
            .iter()
            .map(|item| item["excerpt"].as_str().unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(excerpts.len(), results.len(), "{answer}");
        assert!(
            results.iter().any(|item| item["path"] == "В.md"),
            "{answer}"
        );
        core.shutdown();
    }

    #[test]
    fn filename_copy_markers_are_treated_as_archived() {
        assert!(super::is_archived(Path::new("Проекты/План (копия).md")));
        assert!(super::is_archived(Path::new("Projects/Plan-old.md")));
        assert!(!super::is_archived(Path::new("Projects/Copywriting.md")));
        assert!(!super::is_archived(Path::new("Projects/Copycat.md")));
        assert!(!super::is_archived(Path::new("Проекты/План.md")));
    }

    #[test]
    fn graph_bonus_does_not_reorder_direct_lexical_results() {
        let mut first = super::Candidate::new(PathBuf::from("Первый.md"));
        first.text_rank = Some(1);
        let mut second = super::Candidate::new(PathBuf::from("Второй.md"));
        second.text_rank = Some(2);
        second.graph_rank = Some(1);

        assert!(first.score() > second.score());

        let vault = crate::mcp::vault::Vault {
            root: PathBuf::from("/vault"),
            visible: false,
        };
        let fragment = crate::search::excerpt::Fragment {
            heading: None,
            line_start: 1,
            line_end: 1,
            excerpt: "совпадение".to_owned(),
        };
        let value = super::fragment_value(
            &vault,
            &second,
            &fragment,
            "hash",
            &["совпадение".to_owned()],
        );
        assert!(value["signals"]["graph"].as_f64().unwrap() > 0.0);
        assert_eq!(
            value["score"].as_f64().unwrap(),
            super::round(second.score())
        );
    }

    #[test]
    fn folder_filter_searches_beyond_the_initial_candidate_window() {
        let mut files = (0..210)
            .map(|index| {
                let name = format!("Шум/Ротация ключей TLS {index:03}.md");
                (name, "# Ротация ключей TLS\n\nротация ключей tls\n")
            })
            .collect::<Vec<_>>();
        files.push((
            "Цель/Ключи.md".to_owned(),
            "# Ключи\n\nротация ключей tls\n",
        ));
        let borrowed = files
            .iter()
            .map(|(name, content)| (name.as_str(), *content))
            .collect::<Vec<_>>();
        let (_directory, core, _root) = fixture(&borrowed);

        let answer = call(
            &core,
            "search_context",
            &json!({ "query": "ротация ключей tls", "folder": "Цель", "graphDepth": 0 }),
        )
        .unwrap();

        assert_eq!(paths(&answer), ["Цель/Ключи.md"], "{answer}");
        core.shutdown();
    }

    #[test]
    fn max_chars_bounds_the_serialized_results() {
        let files = (0..6)
            .map(|index| {
                let name = format!("Заметка{index}.md");
                let content = format!(
                    "# Раздел\n\n{}",
                    format!("слово строка {index}\n").repeat(60)
                );
                (name, content)
            })
            .collect::<Vec<_>>();
        let borrowed = files
            .iter()
            .map(|(name, content)| (name.as_str(), content.as_str()))
            .collect::<Vec<_>>();
        let (_directory, core, _root) = fixture(&borrowed);

        let answer = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "maxChars": 2000 }),
        )
        .unwrap();

        let used = serde_json::to_string(&answer["results"])
            .unwrap()
            .chars()
            .count();
        assert!(used <= 2000, "results больше maxChars: {used}");
        assert_eq!(answer["budget"]["maxChars"], 2000);
        assert_eq!(answer["budget"]["usedChars"], used);
        assert_eq!(answer["truncated"], true, "{answer}");
        assert!(answer["omitted"].as_u64().unwrap() >= 1, "{answer}");
        core.shutdown();
    }

    #[test]
    fn folder_and_tags_narrow_the_set() {
        let (_directory, core, _root) = fixture(&[
            (
                "Проекты/Альфа.md",
                "---\ntags: [план]\n---\n# Альфа\n\nслово\n",
            ),
            (
                "Заметки/Бета.md",
                "---\ntags: [план]\n---\n# Бета\n\nслово\n",
            ),
            (
                "Заметки/Гамма.md",
                "---\ntags: [отчёт]\n---\n# Гамма\n\nслово\n",
            ),
        ]);

        let by_folder = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "folder": "Проекты", "limit": 10 }),
        )
        .unwrap();
        assert_eq!(paths(&by_folder), ["Проекты/Альфа.md"]);

        let by_tags = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "tags": ["отчёт"], "limit": 10 }),
        )
        .unwrap();
        assert_eq!(paths(&by_tags), ["Заметки/Гамма.md"]);

        let both = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "tags": ["план"], "limit": 10 }),
        )
        .unwrap();
        let mut found = paths(&both);
        found.sort();
        assert_eq!(found, ["Заметки/Бета.md", "Проекты/Альфа.md"]);
        core.shutdown();
    }

    #[test]
    fn graph_neighbours_join_only_when_depth_is_positive() {
        let (_directory, core, _root) = fixture(&[
            ("Центр.md", "# Центр\n\nслово про поиск\n\n[[Сосед]]\n"),
            ("Сосед.md", "# Сосед\n\nдругой текст\n"),
            ("Дальний.md", "# Дальний\n\n[[Сосед]]\n"),
        ]);

        let with_graph = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "graphDepth": 1, "limit": 10 }),
        )
        .unwrap();
        let found = paths(&with_graph);
        assert!(found.contains(&"Центр.md".to_owned()), "{with_graph}");
        assert!(found.contains(&"Сосед.md".to_owned()), "{with_graph}");
        assert!(!found.contains(&"Дальний.md".to_owned()), "{with_graph}");
        assert_eq!(with_graph["searchMethod"], "tantivy+graph");

        let without = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "graphDepth": 0, "limit": 10 }),
        )
        .unwrap();
        let found = paths(&without);
        assert_eq!(found, ["Центр.md"], "{without}");
        core.shutdown();
    }

    #[test]
    fn search_method_reports_only_signals_that_ran() {
        let (_directory, core, _root) =
            fixture(&[("Заметка.md", "# Заметка\n\nслово для поиска\n")]);

        let without_seeds = call(
            &core,
            "search_context",
            &json!({ "query": "несуществующее", "mode": "deep", "graphDepth": 0 }),
        )
        .unwrap();
        assert_eq!(without_seeds["searchMethod"], "tantivy");

        let deep = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "mode": "deep", "graphDepth": 0 }),
        )
        .unwrap();
        assert_eq!(deep["searchMethod"], "tantivy+bm25f");

        let deep_without_links = call(
            &core,
            "search_context",
            &json!({ "query": "слово", "mode": "deep", "graphDepth": 1 }),
        )
        .unwrap();
        assert_eq!(
            deep_without_links["searchMethod"],
            "tantivy+bm25f+adamic-adar+graph"
        );
        core.shutdown();
    }

    #[test]
    fn an_empty_query_names_the_field() {
        let (_directory, core, _root) = fixture(&[("Заметка.md", "# Заметка\n\nтекст\n")]);

        let error = call(&core, "search_context", &json!({ "query": "   " })).unwrap_err();

        assert!(error.contains("query"), "{error}");
        core.shutdown();
    }

    #[test]
    fn the_tool_is_defined_first() {
        let first = super::definitions().into_iter().next().unwrap();
        assert_eq!(first["name"], "search_context");
    }
}
