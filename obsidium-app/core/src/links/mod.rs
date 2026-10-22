use crate::app_core::Core;
use crate::files::document::{read_file_snapshot_impl, read_text};
use crate::files::error::FileCommandError;
use crate::files::gate;
use crate::history::Source;
use crate::mcp::vault::Vault;
use crate::search::analysis::models::AnalysisMethod;
use crate::search::paths::{identity, strip_markdown_extension};
use crate::search::wiki::parser::extract;
use crate::search::wiki::target::{pick_candidate, relative_key, target_key, title_key};
use crate::wiki::compose;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const WRITE_DISABLED: &str = "Изменение заметок запрещено в настройках Obsidium";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkKind {
    Wiki,
    Parent,
    Related,
    DependsOn,
    Blocks,
}

impl LinkKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "wiki" => Ok(Self::Wiki),
            "parent" => Ok(Self::Parent),
            "related" => Ok(Self::Related),
            "depends_on" | "depends-on" | "dependson" => Ok(Self::DependsOn),
            "blocks" => Ok(Self::Blocks),
            other => Err(format!(
                "Неизвестный вид связи «{other}»: допустимы wiki, parent, related, depends_on, blocks"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wiki => "wiki",
            Self::Parent => "parent",
            Self::Related => "related",
            Self::DependsOn => "depends_on",
            Self::Blocks => "blocks",
        }
    }

    fn structural(self) -> Option<&'static str> {
        match self {
            Self::Wiki => None,
            other => Some(other.as_str()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub path: String,
    pub score: f64,
    pub reasons: Vec<String>,
    pub already_linked: bool,
    pub method: &'static str,
}

#[derive(Clone, Debug)]
pub struct LinkPlan {
    pub source: PathBuf,
    pub target: PathBuf,
    pub kind: LinkKind,
    pub link_text: String,
    pub before: String,
    pub after: String,
    pub hash: String,
    pub changed: bool,
    pub removal: bool,
    pub version_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub changed: bool,
    pub hash: String,
}

pub fn suggest(
    core: &Core,
    vault: &Vault,
    note: &Path,
    limit: usize,
) -> Result<Vec<Suggestion>, String> {
    let workspace = vault.root.to_string_lossy().into_owned();
    let document = note.to_string_lossy().into_owned();
    let config = core.settings.get_config();
    let analysis = &config.analysis;
    let methods = [
        (AnalysisMethod::Bm25f, "bm25f", analysis.enable_bm25f),
        (
            AnalysisMethod::AdamicAdar,
            "adamicAdar",
            analysis.enable_adamic_adar,
        ),
        (
            AnalysisMethod::Duplicates,
            "duplicates",
            analysis.enable_duplicates,
        ),
        (
            AnalysisMethod::UnlinkedMentions,
            "unlinkedMentions",
            analysis.enable_unlinked_mentions,
        ),
    ];
    let mut merged = Vec::<(String, f64, Vec<String>, &'static str)>::new();
    let mut positions = HashMap::<String, usize>::new();
    for (method, label, enabled) in methods {
        if !enabled {
            continue;
        }
        let results = core
            .search
            .analyze_document(&workspace, &document, method, Some(limit), &config)
            .map_err(|error| error.to_string())?;
        for result in results {
            let path = vault.relative(Path::new(&result.path));
            let position = match positions.get(&path).copied() {
                Some(position) => position,
                None => {
                    positions.insert(path.clone(), merged.len());
                    merged.push((path, 0.0, Vec::new(), label));
                    merged.len() - 1
                }
            };
            let entry = &mut merged[position];
            if result.raw_score > entry.1 {
                entry.1 = result.raw_score;
                entry.3 = label;
            }
            for reason in result.reasons {
                if !entry.2.contains(&reason) {
                    entry.2.push(reason);
                }
            }
        }
    }
    let linked = linked_identities(vault, note)?;
    let mut suggestions = merged
        .into_iter()
        .filter(|(path, _, _, _)| identity(&vault.root.join(path)) != identity(note))
        .map(|(path, score, reasons, method)| Suggestion {
            already_linked: linked.contains(&identity(&vault.root.join(&path))),
            path,
            score: (score * 100.0).round() / 100.0,
            reasons,
            method,
        })
        .collect::<Vec<_>>();
    suggestions.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.path.cmp(&right.path))
    });
    suggestions.truncate(limit.max(1));
    Ok(suggestions)
}

pub fn plan_link(
    core: &Core,
    vault: &Vault,
    source: &str,
    target: &str,
    kind: LinkKind,
) -> Result<LinkPlan, String> {
    require_write(core)?;
    let source_path = vault.note(source)?;
    let target_path = vault.note(target)?;
    ensure_distinct(vault, &source_path, &target_path)?;
    let snapshot = read_file_snapshot_impl(&source_path).map_err(|error| error.to_string())?;
    let resolver = Resolver::new(vault, &source_path);
    let link_text = match kind {
        LinkKind::Wiki => wiki_link_text(vault, &target_path),
        _ => strip_markdown_extension(&vault.relative(&target_path)).to_owned(),
    };
    let mut plan = LinkPlan {
        source: source_path,
        target: target_path,
        kind,
        link_text,
        before: snapshot.content.clone(),
        after: snapshot.content.clone(),
        hash: snapshot.hash,
        changed: false,
        removal: false,
        version_name: "Agent link".to_owned(),
    };
    let already = match plan.kind.structural() {
        Some(field) => structural_entry(&plan.before, field, &plan.target, &resolver).is_some(),
        None => wiki_entry(&plan.before, &plan.target, &resolver).is_some(),
    };
    if already {
        return Ok(plan);
    }
    if let Some(after) = compose_link(&plan.before, &plan.link_text, plan.kind)? {
        plan.after = after;
        plan.changed = true;
    }
    Ok(plan)
}

pub fn plan_unlink(
    core: &Core,
    vault: &Vault,
    source: &str,
    target: &str,
    kind: LinkKind,
) -> Result<LinkPlan, String> {
    require_write(core)?;
    let source_path = vault.note(source)?;
    let target_path = vault.note(target)?;
    ensure_distinct(vault, &source_path, &target_path)?;
    let snapshot = read_file_snapshot_impl(&source_path).map_err(|error| error.to_string())?;
    let resolver = Resolver::new(vault, &source_path);
    let mut plan = LinkPlan {
        source: source_path,
        target: target_path,
        kind,
        link_text: String::new(),
        before: snapshot.content.clone(),
        after: snapshot.content.clone(),
        hash: snapshot.hash,
        changed: false,
        removal: true,
        version_name: "Agent unlink".to_owned(),
    };
    let found = match plan.kind.structural() {
        Some(field) => structural_entry(&plan.before, field, &plan.target, &resolver),
        None => wiki_entry(&plan.before, &plan.target, &resolver),
    };
    let Some(found) = found else {
        return Ok(plan);
    };
    plan.link_text = found;
    if let Some(after) = compose_unlink(&plan.before, &plan.link_text, plan.kind)? {
        plan.after = after;
        plan.changed = true;
    }
    Ok(plan)
}

pub fn apply_link(core: &Core, vault: &Vault, plan: &LinkPlan) -> Result<Applied, String> {
    if !plan.source.starts_with(&vault.root) {
        return Err(format!(
            "Заметка вне базы знаний: {}",
            plan.source.to_string_lossy()
        ));
    }
    if !plan.changed {
        return Ok(Applied {
            changed: false,
            hash: plan.hash.clone(),
        });
    }
    match gate::write(
        core,
        &plan.source,
        &plan.after,
        Some(&plan.hash),
        Source::Agent,
        Some(&plan.version_name),
    ) {
        Ok(result) => Ok(Applied {
            changed: true,
            hash: result.hash,
        }),
        Err(FileCommandError::Conflict { .. }) => {
            let snapshot =
                read_file_snapshot_impl(&plan.source).map_err(|error| error.to_string())?;
            let after = recompose(&snapshot.content, plan)?;
            if after == snapshot.content {
                return Ok(Applied {
                    changed: false,
                    hash: snapshot.hash,
                });
            }
            let result = gate::write(
                core,
                &plan.source,
                &after,
                Some(&snapshot.hash),
                Source::Agent,
                Some(&plan.version_name),
            )
            .map_err(|error| error.to_string())?;
            Ok(Applied {
                changed: true,
                hash: result.hash,
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

pub fn unlink(
    core: &Core,
    vault: &Vault,
    source: &str,
    target: &str,
    kind: LinkKind,
) -> Result<Applied, String> {
    let plan = plan_unlink(core, vault, source, target, kind)?;
    apply_link(core, vault, &plan)
}

fn recompose(content: &str, plan: &LinkPlan) -> Result<String, String> {
    let composed = if plan.removal {
        compose_unlink(content, &plan.link_text, plan.kind)?
    } else {
        compose_link(content, &plan.link_text, plan.kind)?
    };
    Ok(composed.unwrap_or_else(|| content.to_owned()))
}

fn compose_link(content: &str, link_text: &str, kind: LinkKind) -> Result<Option<String>, String> {
    match kind.structural() {
        Some(field) => compose::add_frontmatter_link(content, field, link_text),
        None => Ok(compose::append_link(content, link_text)),
    }
}

fn compose_unlink(
    content: &str,
    link_text: &str,
    kind: LinkKind,
) -> Result<Option<String>, String> {
    match kind.structural() {
        Some(field) => compose::remove_frontmatter_link(content, field, link_text),
        None => Ok(compose::remove_link(content, link_text)),
    }
}

fn require_write(core: &Core) -> Result<(), String> {
    if core.settings.get_config().mcp.allow_write {
        Ok(())
    } else {
        Err(WRITE_DISABLED.to_owned())
    }
}

fn ensure_distinct(vault: &Vault, source: &Path, target: &Path) -> Result<(), String> {
    if identity(source) == identity(target) {
        return Err(format!(
            "Нельзя связать заметку с самой собой: {}",
            vault.relative(target)
        ));
    }
    Ok(())
}

fn wiki_link_text(vault: &Vault, target: &Path) -> String {
    let title = Vault::title(target);
    let same_title = vault
        .markdown_files()
        .filter(|path| Vault::title(path).eq_ignore_ascii_case(&title))
        .count();
    if same_title == 1 {
        return title;
    }
    strip_markdown_extension(&vault.relative(target)).to_owned()
}

fn linked_identities(vault: &Vault, note: &Path) -> Result<HashSet<String>, String> {
    let content = read_text(note).map_err(|error| error.to_string())?;
    let resolver = Resolver::new(vault, note);
    let mut linked = HashSet::new();
    for link in extract(&content) {
        if let Some(path) = resolver.resolve(&link.target) {
            linked.insert(identity(&path));
        }
    }
    for kind in [
        LinkKind::Parent,
        LinkKind::Related,
        LinkKind::DependsOn,
        LinkKind::Blocks,
    ] {
        let field = kind.as_str();
        for value in compose::frontmatter_links(&content, field) {
            if let Some(path) = resolver.resolve(&value) {
                linked.insert(identity(&path));
            }
        }
    }
    Ok(linked)
}

fn wiki_entry(content: &str, target: &Path, resolver: &Resolver) -> Option<String> {
    extract(content)
        .into_iter()
        .map(|link| link.target)
        .find(|value| resolver.refers_to(value, target))
}

fn structural_entry(
    content: &str,
    field: &str,
    target: &Path,
    resolver: &Resolver,
) -> Option<String> {
    compose::frontmatter_links(content, field)
        .into_iter()
        .find(|value| resolver.refers_to(value, target))
}

struct Resolver {
    root: PathBuf,
    source: PathBuf,
    by_title: HashMap<String, Vec<String>>,
    by_relative: HashMap<String, Vec<String>>,
}

impl Resolver {
    fn new(vault: &Vault, source: &Path) -> Self {
        let mut by_title = HashMap::<String, Vec<String>>::new();
        let mut by_relative = HashMap::<String, Vec<String>>::new();
        for path in vault.markdown_files() {
            let text = path.to_string_lossy().into_owned();
            by_title
                .entry(title_key(&path))
                .or_default()
                .push(text.clone());
            by_relative
                .entry(relative_key(&vault.root, &path))
                .or_default()
                .push(text);
        }
        Self {
            root: vault.root.clone(),
            source: source.to_path_buf(),
            by_title,
            by_relative,
        }
    }

    fn resolve(&self, value: &str) -> Option<PathBuf> {
        let (key, kind) = target_key(link_value(value));
        let candidates = if kind == "path" {
            self.by_relative.get(&key)
        } else {
            self.by_title.get(&key)
        }?;
        let borrowed = candidates.iter().map(String::as_str).collect::<Vec<_>>();
        pick_candidate(&self.root, &self.source, &borrowed).map(PathBuf::from)
    }

    fn refers_to(&self, value: &str, target: &Path) -> bool {
        self.resolve(value)
            .is_some_and(|path| identity(&path) == identity(target))
    }
}

fn link_value(value: &str) -> &str {
    let value = value.trim();
    let value = value
        .strip_prefix("[[")
        .and_then(|rest| rest.strip_suffix("]]"))
        .unwrap_or(value);
    value.split('|').next().unwrap_or_default().trim()
}
