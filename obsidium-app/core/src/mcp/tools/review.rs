use super::workspace::indexed_vault;
use super::{limit, offset, optional_names, optional_text, shorten, tool, workspace_property};
use crate::app_core::Core;
use crate::files::document::{hash_bytes, normalize_line_endings};
use crate::mcp::vault::Vault;
use crate::search::analysis::models::AnalysisMethod;
use crate::search::error::SearchError;
use crate::search::fields::NoteFields;
use crate::search::models::SearchIndexState;
use crate::search::wiki::parser;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_LIMIT: usize = 40;
const MAX_LIMIT: usize = 100;
const DEFAULT_STALE_DAYS: u64 = 365;
const ANALYSIS_LIMIT: usize = 50;
const DUPLICATE_RESULTS: usize = 3;
const MENTION_RESULTS: usize = 20;
const EXCERPT_LIMIT: usize = 240;
const REASON_LIMIT: usize = 400;
const RELATED_LIMIT: usize = 12;
const RELATED_LISTED: usize = 3;
const NS_PER_DAY: i64 = 86_400_000_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Check {
    Stale,
    Duplicates,
    BrokenLinks,
    UnlinkedMentions,
    FieldInconsistency,
    Volatile,
}

const ALL_CHECKS: [Check; 6] = [
    Check::Stale,
    Check::Duplicates,
    Check::BrokenLinks,
    Check::UnlinkedMentions,
    Check::FieldInconsistency,
    Check::Volatile,
];

impl Check {
    fn name(self) -> &'static str {
        match self {
            Self::Stale => "stale",
            Self::Duplicates => "duplicates",
            Self::BrokenLinks => "brokenLinks",
            Self::UnlinkedMentions => "unlinkedMentions",
            Self::FieldInconsistency => "fieldInconsistency",
            Self::Volatile => "volatile",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "stale" => Some(Self::Stale),
            "duplicates" => Some(Self::Duplicates),
            "brokenLinks" | "broken_links" | "brokenlinks" => Some(Self::BrokenLinks),
            "unlinkedMentions" | "unlinked_mentions" | "unlinkedmentions" => {
                Some(Self::UnlinkedMentions)
            }
            "fieldInconsistency" | "field_inconsistency" | "fieldinconsistency" => {
                Some(Self::FieldInconsistency)
            }
            "volatile" => Some(Self::Volatile),
            _ => None,
        }
    }

    fn severity(self) -> &'static str {
        match self {
            Self::Stale | Self::Duplicates | Self::BrokenLinks | Self::FieldInconsistency => {
                "warning"
            }
            Self::UnlinkedMentions | Self::Volatile => "info",
        }
    }

    fn rank(self) -> usize {
        ALL_CHECKS
            .iter()
            .position(|check| *check == self)
            .unwrap_or(usize::MAX)
    }
}

enum Evidence<'a> {
    Field(&'a str),
    Title,
}

struct Finding {
    kind: Check,
    path: PathBuf,
    reason: String,
    line: usize,
    excerpt: String,
    hash: String,
    related: Vec<PathBuf>,
}

struct ScopeNote {
    path: PathBuf,
    modified_ns: i64,
    fields: Map<String, Value>,
}

struct Notes {
    hashes: HashMap<PathBuf, String>,
}

impl Notes {
    fn new() -> Self {
        Self {
            hashes: HashMap::new(),
        }
    }

    fn read(&mut self, path: &Path) -> Option<String> {
        let bytes = fs::read(path).ok()?;
        self.hashes.insert(path.to_path_buf(), hash_bytes(&bytes));
        let text = String::from_utf8_lossy(&bytes).into_owned();
        Some(normalize_line_endings(text))
    }

    fn hash(&mut self, path: &Path) -> String {
        if let Some(hash) = self.hashes.get(path) {
            return hash.clone();
        }
        let hash = fs::read(path)
            .map(|bytes| hash_bytes(&bytes))
            .unwrap_or_default();
        self.hashes.insert(path.to_path_buf(), hash.clone());
        hash
    }
}

pub fn definitions() -> Vec<Value> {
    vec![tool(
        "review_knowledge",
        "Кандидаты на перепроверку базы знаний, а не утверждения об ошибках: инструмент ничего не меняет, не ходит в сеть и не обращается к языковой модели. stale — заметки, которые не менялись дольше staleAfterDays по дате изменения из индекса; duplicates и unlinkedMentions — до 50 недавно изменённых заметок с почти одинаковым текстом или с упоминанием названия без ссылки; brokenLinks — ссылки [[...]] на несуществующие заметки; fieldInconsistency — заметки одного type, расходящиеся в поле status или version; volatile — строки с версиями, датами и командами оболочки. У каждой находки причина по-русски, severity (warning — вероятная проблема, info — повод перепроверить), evidence с настоящими номерами строк и hash заметки для expectedHash. Проверку фактов по внешним источникам инструмент не выполняет — это делаете вы.",
        json!({
            "folder": { "type": "string", "description": "Проверять только эту папку, пусто — вся база" },
            "tags": { "type": "array", "items": { "type": "string" }, "description": "Проверять только заметки с этими тегами" },
            "checks": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["stale", "duplicates", "brokenLinks", "unlinkedMentions", "fieldInconsistency", "volatile"]
                },
                "description": "Какие проверки выполнить; по умолчанию все"
            },
            "staleAfterDays": { "type": "integer", "description": "Сколько дней без изменений считать поводом перепроверить заметку, по умолчанию 365" },
            "limit": { "type": "integer", "description": "Сколько находок вернуть, по умолчанию 40, максимум 100" },
            "offset": { "type": "integer", "description": "Сколько находок пропустить, чтобы получить следующую страницу" },
            "workspace": workspace_property(),
        }),
        &[],
    )]
}

pub fn call(core: &Core, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    Some(match name {
        "review_knowledge" => review(core, arguments),
        _ => return None,
    })
}

fn review(core: &Core, arguments: &Value) -> Result<Value, String> {
    let vault = indexed_vault(core, arguments)?;
    let workspace = vault.root.to_string_lossy().into_owned();
    let checks = selected_checks(arguments)?;
    let folder = optional_text(arguments, "folder")
        .map(|value| vault.folder(&value))
        .transpose()?;
    if let Some(folder) = folder.as_ref().filter(|folder| !folder.is_dir()) {
        return Err(format!("Папка не найдена: {}", vault.relative(folder)));
    }
    let tags = tags(arguments)?;
    let status = core.search.status(Some(workspace.as_str()));
    let indexing = status.updating || status.state == SearchIndexState::Indexing;
    let notes = scoped_notes(core, &workspace, folder.as_deref(), &tags)?;
    let mut reader = Notes::new();
    let mut findings = Vec::new();

    scan_notes(
        core,
        &workspace,
        &notes,
        &checks,
        stale_days(arguments),
        &mut reader,
        &mut findings,
    )?;
    if checks.contains(&Check::Duplicates) {
        duplicates(core, &workspace, &notes, &mut reader, &mut findings)?;
    }
    if checks.contains(&Check::UnlinkedMentions) {
        unlinked_mentions(core, &workspace, &notes, &mut reader, &mut findings)?;
    }
    if checks.contains(&Check::FieldInconsistency) {
        field_inconsistency(&vault, &notes, &mut reader, &mut findings);
    }

    findings.sort_by(|left, right| {
        severity_rank(left.kind.severity())
            .cmp(&severity_rank(right.kind.severity()))
            .then_with(|| left.kind.rank().cmp(&right.kind.rank()))
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.reason.cmp(&right.reason))
    });

    let total = findings.len();
    let skip = offset(arguments);
    let size = limit(arguments, DEFAULT_LIMIT, MAX_LIMIT);
    let page = findings
        .iter()
        .skip(skip)
        .take(size)
        .map(|finding| finding_json(&vault, finding))
        .collect::<Vec<_>>();
    let truncated = skip.saturating_add(page.len()) < total;

    Ok(json!({
        "findings": page,
        "total": total,
        "truncated": truncated,
        "indexing": indexing,
        "checks": checks.iter().map(|check| check.name()).collect::<Vec<_>>(),
    }))
}

fn selected_checks(arguments: &Value) -> Result<Vec<Check>, String> {
    let Some(names) = optional_names(arguments, "checks")? else {
        return Ok(ALL_CHECKS.to_vec());
    };
    let mut wanted = Vec::new();
    for name in names {
        let check = Check::parse(&name).ok_or_else(|| {
            format!(
                "Неизвестная проверка «{name}»; доступны: {}",
                ALL_CHECKS
                    .iter()
                    .map(|check| check.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        if !wanted.contains(&check) {
            wanted.push(check);
        }
    }
    Ok(ALL_CHECKS
        .iter()
        .copied()
        .filter(|check| wanted.contains(check))
        .collect())
}

fn tags(arguments: &Value) -> Result<Vec<String>, String> {
    Ok(optional_names(arguments, "tags")?
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.trim().trim_start_matches('#').trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect())
}

fn stale_days(arguments: &Value) -> u64 {
    arguments
        .get("staleAfterDays")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_STALE_DAYS)
}

fn scoped_notes(
    core: &Core,
    workspace: &str,
    folder: Option<&Path>,
    tags: &[String],
) -> Result<Vec<ScopeNote>, String> {
    let rows = core
        .search
        .base_rows(workspace)
        .map_err(|error| error.to_string())?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let modified = core
        .search
        .with_metadata(workspace, |_open, connection| {
            let mut statement = connection.prepare("SELECT path, modified_ns FROM documents")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?;
            let mut found = HashMap::new();
            for row in rows {
                let (path, modified_ns) = row?;
                found.insert(path, modified_ns);
            }
            Ok(found)
        })
        .map_err(|error| error.to_string())?;

    let mut notes = Vec::new();
    for NoteFields { path, fields } in rows {
        let path = PathBuf::from(path);
        if folder.is_some_and(|folder| !path.starts_with(folder)) {
            continue;
        }
        if !tags.is_empty() && !tags.iter().all(|tag| has_tag(&fields, tag)) {
            continue;
        }
        let modified_ns = modified
            .get(&path.to_string_lossy().into_owned())
            .copied()
            .unwrap_or(0);
        notes.push(ScopeNote {
            path,
            modified_ns,
            fields,
        });
    }
    notes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(notes)
}

fn has_tag(fields: &Map<String, Value>, tag: &str) -> bool {
    let Some(value) = field_value(fields, "tags") else {
        return false;
    };
    let items = match value {
        Value::String(text) => text
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => return false,
    };
    items.iter().any(|item| {
        let item = item.trim().trim_start_matches('#').to_lowercase();
        item == tag || item.starts_with(&format!("{tag}/"))
    })
}

fn field_value<'a>(fields: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    fields.get(key).or_else(|| {
        fields
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, value)| value)
    })
}

fn scalar(fields: &Map<String, Value>, key: &str) -> Option<String> {
    match field_value(fields, key)? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn scan_notes(
    core: &Core,
    workspace: &str,
    notes: &[ScopeNote],
    checks: &[Check],
    stale_after_days: u64,
    reader: &mut Notes,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    let stale = checks.contains(&Check::Stale);
    let volatile = checks.contains(&Check::Volatile);
    let broken = checks.contains(&Check::BrokenLinks);
    if !(stale || volatile || broken) {
        return Ok(());
    }
    let threshold = i64::try_from(stale_after_days)
        .unwrap_or(i64::MAX)
        .saturating_mul(NS_PER_DAY);
    let now = now_ns();

    for note in notes {
        let age = now.saturating_sub(note.modified_ns);
        let days = (stale && age > threshold).then_some((age / NS_PER_DAY) as u64);
        let text = if days.is_some() || volatile || broken {
            reader.read(&note.path)
        } else {
            None
        };

        if let Some(days) = days {
            let (line, excerpt) = text
                .as_deref()
                .map(stale_evidence)
                .unwrap_or_else(|| (1, String::new()));
            findings.push(Finding {
                kind: Check::Stale,
                path: note.path.clone(),
                reason: stale_reason(days),
                line,
                excerpt,
                hash: reader.hash(&note.path),
                related: Vec::new(),
            });
        }

        let Some(text) = text else {
            continue;
        };

        if volatile {
            for (index, line) in text.lines().enumerate() {
                if volatile_line(line) {
                    findings.push(Finding {
                        kind: Check::Volatile,
                        path: note.path.clone(),
                        reason: "Строка содержит версию, дату или команду оболочки: сверьте её с текущим состоянием источников".to_owned(),
                        line: index + 1,
                        excerpt: excerpt_of(line),
                        hash: reader.hash(&note.path),
                        related: Vec::new(),
                    });
                }
            }
        }

        if broken {
            let links = core
                .search
                .outgoing_links(workspace, &note.path.to_string_lossy())
                .map_err(|error| error.to_string())?;
            let extracted = parser::extract(&text);
            let mut seen = HashSet::new();
            for link in links.iter().filter(|link| link.path.is_none()) {
                if !seen.insert(link.target.clone()) {
                    continue;
                }
                let (line, excerpt) = extracted
                    .iter()
                    .find(|candidate| candidate.target == link.target)
                    .map_or_else(
                        || evidence(&text, Evidence::Title),
                        |candidate| {
                            let line = line_at(&text, candidate.target_range.start);
                            (line, excerpt_of(line_text(&text, line)))
                        },
                    );
                findings.push(Finding {
                    kind: Check::BrokenLinks,
                    path: note.path.clone(),
                    reason: format!(
                        "Ссылка [[{}]] никуда не ведёт: заметка «{}» не найдена",
                        link.target, link.target
                    ),
                    line,
                    excerpt,
                    hash: reader.hash(&note.path),
                    related: Vec::new(),
                });
            }
        }
    }
    Ok(())
}

fn duplicates(
    core: &Core,
    workspace: &str,
    notes: &[ScopeNote],
    reader: &mut Notes,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    let config = core.settings.get_config();
    let mut seen = HashSet::<(PathBuf, PathBuf)>::new();
    for note in recent(notes) {
        let results = match core.search.analyze_document(
            workspace,
            &note.path.to_string_lossy(),
            AnalysisMethod::Duplicates,
            Some(DUPLICATE_RESULTS),
            &config,
        ) {
            Ok(results) => results,
            Err(SearchError::Unavailable { .. }) => continue,
            Err(error) => return Err(error.to_string()),
        };
        for result in results {
            let other = PathBuf::from(&result.path);
            if other == note.path {
                continue;
            }
            let pair = if note.path <= other {
                (note.path.clone(), other.clone())
            } else {
                (other.clone(), note.path.clone())
            };
            if !seen.insert(pair) {
                continue;
            }
            let percent = result.similarity.unwrap_or(result.raw_score) * 100.0;
            let (line, excerpt) = reader
                .read(&note.path)
                .map(|text| evidence(&text, Evidence::Title))
                .unwrap_or_else(|| (1, String::new()));
            findings.push(Finding {
                kind: Check::Duplicates,
                path: note.path.clone(),
                reason: format!(
                    "Похожа на «{}»: текст совпадает примерно на {percent:.0}%",
                    title_of(&other)
                ),
                line,
                excerpt,
                hash: reader.hash(&note.path),
                related: vec![other],
            });
        }
    }
    Ok(())
}

fn unlinked_mentions(
    core: &Core,
    workspace: &str,
    notes: &[ScopeNote],
    reader: &mut Notes,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    let config = core.settings.get_config();
    let mut seen = HashSet::<(PathBuf, PathBuf)>::new();
    for note in recent(notes) {
        let title = title_of(&note.path);
        if title.is_empty() {
            continue;
        }
        let results = match core.search.analyze_document(
            workspace,
            &note.path.to_string_lossy(),
            AnalysisMethod::UnlinkedMentions,
            Some(MENTION_RESULTS),
            &config,
        ) {
            Ok(results) => results,
            Err(SearchError::Unavailable { .. }) => continue,
            Err(error) => return Err(error.to_string()),
        };
        for result in results {
            let mentioning = PathBuf::from(&result.path);
            if !seen.insert((mentioning.clone(), note.path.clone())) {
                continue;
            }
            let (line, excerpt) = reader
                .read(&mentioning)
                .map(|text| {
                    line_with(&text, &title).map_or_else(
                        || evidence(&text, Evidence::Title),
                        |line| (line, excerpt_of(line_text(&text, line))),
                    )
                })
                .unwrap_or_else(|| (1, String::new()));
            findings.push(Finding {
                kind: Check::UnlinkedMentions,
                path: mentioning.clone(),
                reason: format!(
                    "Упоминает «{title}» без ссылки: поставьте [[{title}]] или уберите упоминание"
                ),
                line,
                excerpt,
                hash: reader.hash(&mentioning),
                related: vec![note.path.clone()],
            });
        }
    }
    Ok(())
}

fn field_inconsistency(
    vault: &Vault,
    notes: &[ScopeNote],
    reader: &mut Notes,
    findings: &mut Vec<Finding>,
) {
    let mut groups = BTreeMap::<String, Vec<&ScopeNote>>::new();
    for note in notes {
        let Some(value) = scalar(&note.fields, "type") else {
            continue;
        };
        let key = value.trim().to_lowercase();
        if !key.is_empty() {
            groups.entry(key).or_default().push(note);
        }
    }

    for (type_key, group) in groups {
        if group.len() < 2 {
            continue;
        }
        let display_type = group
            .iter()
            .find_map(|note| scalar(&note.fields, "type"))
            .unwrap_or_else(|| type_key.clone());
        let mut keys = BTreeSet::new();
        for note in &group {
            for key in note.fields.keys() {
                if status_field(key) {
                    keys.insert(key.clone());
                }
            }
        }

        for key in keys {
            let mut values = BTreeMap::<String, Vec<(&ScopeNote, String)>>::new();
            for note in &group {
                let Some(value) = scalar(&note.fields, &key) else {
                    continue;
                };
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    continue;
                }
                values
                    .entry(trimmed.to_lowercase())
                    .or_default()
                    .push((*note, trimmed.to_owned()));
            }
            if values.len() < 2 {
                continue;
            }
            let Some(representative) = values
                .values()
                .next()
                .and_then(|carriers| carriers.first().map(|(note, _)| *note))
            else {
                continue;
            };
            let mut parts = Vec::new();
            for carriers in values.values() {
                let display = &carriers[0].1;
                let mut names = carriers
                    .iter()
                    .map(|(note, _)| vault.relative(&note.path))
                    .collect::<Vec<_>>();
                let extra = names.len().saturating_sub(RELATED_LISTED);
                names.truncate(RELATED_LISTED);
                let suffix = if extra > 0 {
                    format!(" и ещё {extra}")
                } else {
                    String::new()
                };
                parts.push(format!("«{display}» — {}{suffix}", names.join(", ")));
            }
            let reason = format!(
                "У заметок с type «{display_type}» поле «{key}» расходится: {}",
                parts.join("; ")
            );
            let related = group
                .iter()
                .filter(|note| note.path != representative.path)
                .filter(|note| scalar(&note.fields, &key).is_some())
                .map(|note| note.path.clone())
                .take(RELATED_LIMIT)
                .collect::<Vec<_>>();
            let (line, excerpt) = reader
                .read(&representative.path)
                .map(|text| evidence(&text, Evidence::Field(&key)))
                .unwrap_or_else(|| (1, String::new()));
            findings.push(Finding {
                kind: Check::FieldInconsistency,
                path: representative.path.clone(),
                reason: shorten(&reason, REASON_LIMIT),
                line,
                excerpt,
                hash: reader.hash(&representative.path),
                related,
            });
        }
    }
}

fn status_field(key: &str) -> bool {
    const NAMES: [&str; 7] = [
        "status", "state", "stage", "version", "revision", "release", "phase",
    ];
    let key = key.trim().to_lowercase();
    NAMES
        .iter()
        .any(|name| key == *name || key.ends_with(*name))
}

fn recent(notes: &[ScopeNote]) -> Vec<&ScopeNote> {
    let mut sorted = notes.iter().collect::<Vec<_>>();
    sorted.sort_by(|left, right| {
        right
            .modified_ns
            .cmp(&left.modified_ns)
            .then_with(|| left.path.cmp(&right.path))
    });
    sorted.truncate(ANALYSIS_LIMIT);
    sorted
}

fn now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| i64::try_from(value.as_nanos()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn stale_reason(days: u64) -> String {
    format!(
        "Заметка не проверялась {}: содержимое могло устареть, поэтому сверьте её с источниками",
        days_label(days)
    )
}

fn days_label(days: u64) -> String {
    let tail = days % 100;
    let word = if (11..=14).contains(&tail) {
        "дней"
    } else {
        match days % 10 {
            1 => "день",
            2..=4 => "дня",
            _ => "дней",
        }
    };
    format!("{days} {word}")
}

fn volatile_line(line: &str) -> bool {
    has_command(line) || has_version(line) || has_date(line)
}

fn has_command(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.contains("$ ") {
        return true;
    }
    const COMMANDS: [&str; 7] = ["sudo", "kubectl", "docker", "npm", "cargo", "brew", "apt"];
    for command in COMMANDS {
        let mut from = 0;
        while let Some(position) = lower[from..].find(command) {
            let at = from + position;
            let before = lower[..at].chars().next_back();
            let after = at + command.len();
            let starts =
                at == 0 || !before.is_some_and(|symbol| symbol.is_alphanumeric() || symbol == '_');
            let ends = lower[after..].starts_with(' ') || lower[after..].starts_with('\t');
            if starts && ends {
                return true;
            }
            from = after;
        }
    }
    false
}

fn has_version(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end < bytes.len() && bytes[end] == b'.' {
            let mut minor = end + 1;
            while minor < bytes.len() && bytes[minor].is_ascii_digit() {
                minor += 1;
            }
            if minor > end + 1 {
                return true;
            }
        }
        index = end.max(index + 1);
    }
    false
}

fn has_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        let digits = end - index;
        if digits == 4 && end < bytes.len() && bytes[end] == b'-' {
            let month = end + 1;
            if month + 1 < bytes.len()
                && bytes[month].is_ascii_digit()
                && bytes[month + 1].is_ascii_digit()
                && bytes.get(month + 2) == Some(&b'-')
                && bytes.get(month + 3).is_some_and(u8::is_ascii_digit)
                && bytes.get(month + 4).is_some_and(u8::is_ascii_digit)
            {
                return true;
            }
        }
        if digits == 2 && end < bytes.len() && bytes[end] == b'.' {
            let month = end + 1;
            if month + 1 < bytes.len()
                && bytes[month].is_ascii_digit()
                && bytes[month + 1].is_ascii_digit()
                && bytes.get(month + 2) == Some(&b'.')
            {
                let year = month + 3;
                let mut cursor = year;
                while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
                    cursor += 1;
                }
                if cursor - year == 4 {
                    return true;
                }
            }
        }
        index = end.max(index + 1);
    }
    false
}

fn evidence(text: &str, hint: Evidence<'_>) -> (usize, String) {
    let line = match hint {
        Evidence::Field(key) => field_line(text, key).unwrap_or_else(|| title_line(text)),
        Evidence::Title => title_line(text),
    };
    let line = line.max(1).min(text.lines().count().max(1));
    (line, excerpt_of(line_text(text, line)))
}

fn stale_evidence(text: &str) -> (usize, String) {
    const KEYS: [&str; 6] = [
        "updated",
        "modified",
        "last_verified",
        "reviewed",
        "checked",
        "date",
    ];
    for key in KEYS {
        if let Some(line) = field_line(text, key) {
            return (line, excerpt_of(line_text(text, line)));
        }
    }
    evidence(text, Evidence::Title)
}

fn field_line(text: &str, key: &str) -> Option<usize> {
    let wanted = key.trim().to_lowercase();
    text.lines().enumerate().find_map(|(index, line)| {
        let (name, _) = line.trim_start().split_once(':')?;
        (name.trim().to_lowercase() == wanted).then_some(index + 1)
    })
}

fn title_line(text: &str) -> usize {
    let lines = text.lines().collect::<Vec<_>>();
    if let Some(index) = lines
        .iter()
        .position(|line| line.trim_start().starts_with('#'))
    {
        return index + 1;
    }
    let opening = lines.first().is_some_and(|line| line.trim() == "---");
    let mut in_frontmatter = opening;
    for (index, line) in lines.iter().enumerate() {
        if index == 0 && opening {
            continue;
        }
        if in_frontmatter {
            if line.trim() == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        if !line.trim().is_empty() {
            return index + 1;
        }
    }
    1
}

fn line_at(text: &str, byte: usize) -> usize {
    text.as_bytes()[..byte.min(text.len())]
        .iter()
        .filter(|value| **value == b'\n')
        .count()
        + 1
}

fn line_text(text: &str, line: usize) -> &str {
    text.lines().nth(line.saturating_sub(1)).unwrap_or("")
}

fn line_with(text: &str, needle: &str) -> Option<usize> {
    let needle = needle.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    text.lines()
        .position(|line| line.to_lowercase().contains(&needle))
        .map(|index| index + 1)
}

fn excerpt_of(line: &str) -> String {
    shorten(line.trim(), EXCERPT_LIMIT)
}

fn title_of(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn severity_rank(severity: &str) -> u8 {
    if severity == "warning" {
        0
    } else {
        1
    }
}

fn finding_json(vault: &Vault, finding: &Finding) -> Value {
    json!({
        "kind": finding.kind.name(),
        "path": vault.relative(&finding.path),
        "reason": &finding.reason,
        "severity": finding.kind.severity(),
        "evidence": {
            "lineStart": finding.line,
            "lineEnd": finding.line,
            "excerpt": &finding.excerpt,
        },
        "hash": &finding.hash,
        "related": finding.related.iter().map(|path| vault.relative(path)).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::call as dispatch;
    use crate::app_core::{Core, EventSink};
    use crate::search::models::SearchIndexState;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};

    struct Fixture {
        _directory: tempfile::TempDir,
        core: Arc<Core>,
        root: PathBuf,
    }

    fn fixture(files: &[(&str, &str)]) -> Fixture {
        let files = files
            .iter()
            .map(|(name, content)| (*name, *content, None))
            .collect::<Vec<_>>();
        build(&files)
    }

    fn aged_fixture(files: &[(&str, &str)], days: u64) -> Fixture {
        let files = files
            .iter()
            .map(|(name, content)| (*name, *content, Some(days)))
            .collect::<Vec<_>>();
        build(&files)
    }

    fn build(files: &[(&str, &str, Option<u64>)]) -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let root = directory.path().join("vault");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&root).unwrap();
        for (name, content, age) in files {
            let path = root.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, content).unwrap();
            if let Some(days) = age {
                let when = SystemTime::now() - Duration::from_secs(*days * 86_400);
                fs::File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_modified(when)
                    .unwrap();
            }
        }
        let events: Arc<dyn EventSink> = Arc::new(|_| {});
        let core = Core::open(&data, events);
        let root = crate::search::paths::canonical_path(&root);
        core.ui_state
            .resolve_workspace(&root.to_string_lossy(), 1)
            .unwrap();
        core.search.prepare(&root.to_string_lossy()).unwrap();
        wait_ready(&core, &root);
        Fixture {
            _directory: directory,
            core,
            root,
        }
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
        panic!("индекс не построился за отведённое время");
    }

    fn review(fixture: &Fixture, arguments: Value) -> Value {
        let mut object = arguments.as_object().cloned().unwrap_or_default();
        object.insert(
            "workspace".to_owned(),
            Value::String(fixture.root.to_string_lossy().into_owned()),
        );
        dispatch(&fixture.core, "review_knowledge", &Value::Object(object))
            .expect("инструмент зарегистрирован")
            .expect("проверка выполнена")
    }

    fn findings(answer: &Value) -> &Vec<Value> {
        answer["findings"].as_array().unwrap()
    }

    #[test]
    fn an_old_note_is_reported_as_unverified_not_as_wrong() {
        let fixture = aged_fixture(&[("Старая.md", "# Старая\n\nтекст\n")], 400);

        let answer = review(&fixture, json!({ "checks": ["stale"] }));
        let found = findings(&answer);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["kind"], "stale");
        assert_eq!(found[0]["path"], "Старая.md");
        assert_eq!(found[0]["severity"], "warning");
        let reason = found[0]["reason"].as_str().unwrap();
        assert!(reason.contains("400"), "в причине дни: {reason}");
        assert!(
            reason.contains("не проверялась"),
            "причина говорит о непроверенности: {reason}"
        );
        assert!(
            !reason.to_lowercase().contains("неверн"),
            "причина не утверждает, что содержимое неверно: {reason}"
        );
    }

    #[test]
    fn a_link_to_a_missing_note_is_reported_with_its_line() {
        let fixture = fixture(&[(
            "Источник.md",
            "# Источник\n\nСмотрите [[Нет такой]] здесь.\n",
        )]);

        let answer = review(&fixture, json!({ "checks": ["brokenLinks"] }));
        let found = findings(&answer);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["kind"], "brokenLinks");
        assert_eq!(found[0]["path"], "Источник.md");
        assert_eq!(found[0]["evidence"]["lineStart"], 3);
        assert_eq!(found[0]["evidence"]["lineEnd"], 3);
        let excerpt = found[0]["evidence"]["excerpt"].as_str().unwrap();
        assert!(
            excerpt.contains("[[Нет такой]]"),
            "фрагмент — строка со ссылкой: {excerpt}"
        );
    }

    #[test]
    fn one_type_with_two_statuses_is_reported() {
        let fixture = fixture(&[
            ("Книга.md", "---\ntype: book\nstatus: read\n---\n# Книга\n"),
            (
                "Другая.md",
                "---\ntype: book\nstatus: reading\n---\n# Другая\n",
            ),
        ]);

        let answer = review(&fixture, json!({ "checks": ["fieldInconsistency"] }));
        let found = findings(&answer);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["kind"], "fieldInconsistency");
        let reason = found[0]["reason"].as_str().unwrap();
        assert!(reason.contains("status"), "поле названо: {reason}");
        assert!(reason.contains("«read»"), "значение read: {reason}");
        assert!(reason.contains("«reading»"), "значение reading: {reason}");
        assert_eq!(found[0]["related"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_shell_command_line_is_a_reverification_candidate() {
        let fixture = fixture(&[("Инструкция.md", "# Инструкция\n\nkubectl apply -f x.yaml\n")]);

        let answer = review(&fixture, json!({ "checks": ["volatile"] }));
        let found = findings(&answer);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["kind"], "volatile");
        assert_eq!(found[0]["severity"], "info");
        assert_eq!(found[0]["evidence"]["lineStart"], 3);
        let excerpt = found[0]["evidence"]["excerpt"].as_str().unwrap();
        assert!(excerpt.contains("kubectl apply -f x.yaml"), "{excerpt}");
    }

    #[test]
    fn only_the_requested_check_is_reported() {
        let fixture = aged_fixture(&[("Старая.md", "# Старая\n\n[[Нет такой]]\n")], 400);

        let answer = review(&fixture, json!({ "checks": ["stale"] }));
        let found = findings(&answer);

        assert_eq!(answer["checks"], json!(["stale"]));
        assert!(!found.is_empty());
        assert!(found.iter().all(|finding| finding["kind"] == "stale"));
    }

    #[test]
    fn limit_and_offset_page_the_findings() {
        let fixture = aged_fixture(
            &[("A.md", "# A\n"), ("B.md", "# B\n"), ("C.md", "# C\n")],
            400,
        );

        let first = review(&fixture, json!({ "checks": ["stale"], "limit": 2 }));
        assert_eq!(first["total"], 3);
        assert_eq!(findings(&first).len(), 2);
        assert_eq!(first["truncated"], true);
        let first_paths = findings(&first)
            .iter()
            .map(|finding| finding["path"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(first_paths, ["A.md", "B.md"]);

        let second = review(
            &fixture,
            json!({ "checks": ["stale"], "limit": 2, "offset": 2 }),
        );
        assert_eq!(findings(&second).len(), 1);
        assert_eq!(findings(&second)[0]["path"], "C.md");
        assert_eq!(second["truncated"], false);

        let middle = review(
            &fixture,
            json!({ "checks": ["stale"], "limit": 1, "offset": 1 }),
        );
        assert_eq!(findings(&middle)[0]["path"], "B.md");
        assert_eq!(middle["truncated"], true);
    }
}
