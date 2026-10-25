use super::{JournalError, JournalNote};
use crate::files::document::{create_file_impl, ensure_directory_impl, read_text};
use crate::files::error::FileCommandError;
use crate::search::note_date;
use crate::settings::models::JournalSettings;
use std::fmt::Write as _;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Copy)]
enum Piece {
    Year,
    Month,
    Day,
    Literal(char),
}

pub fn today(root: &Path, settings: &JournalSettings) -> Result<JournalNote, JournalError> {
    let now = note_date::now();
    let (year, month, day, seconds) = note_date::to_civil(now);
    ensure(root, settings, (year, month, day), seconds)
}

pub fn note_path(
    root: &Path,
    settings: &JournalSettings,
    date: (i64, i64, i64),
) -> Result<PathBuf, JournalError> {
    let name = note_name(settings, date)?;
    Ok(folder(root, &settings.folder)?.join(format!("{name}.md")))
}

pub fn list_dates(root: &Path, settings: &JournalSettings) -> Vec<(i64, i64, i64)> {
    let Ok(directory) = folder(root, &settings.folder) else {
        return Vec::new();
    };
    let Ok(pieces) = parse_format(&settings.date_format) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut dates = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| date_from_file(&pieces, &entry.path()))
        .collect::<Vec<_>>();
    dates.sort_unstable();
    dates.dedup();
    dates
}

pub fn link_target(date: (i64, i64, i64)) -> String {
    let (year, month, day) = date;
    format!("[[{year:04}-{month:02}-{day:02}]]")
}

fn ensure(
    root: &Path,
    settings: &JournalSettings,
    date: (i64, i64, i64),
    seconds: i64,
) -> Result<JournalNote, JournalError> {
    let path = note_path(root, settings, date)?;
    if path.is_file() {
        return Ok(JournalNote {
            path,
            created: false,
        });
    }
    let content = initial_content(root, settings, date, seconds)?;
    if let Some(parent) = path.parent() {
        ensure_directory_impl(parent)?;
    }
    match create_file_impl(&path, &content) {
        Ok(_) => Ok(JournalNote {
            path,
            created: true,
        }),
        Err(FileCommandError::AlreadyExists { .. }) if path.is_file() => Ok(JournalNote {
            path,
            created: false,
        }),
        Err(error) => Err(error.into()),
    }
}

fn initial_content(
    root: &Path,
    settings: &JournalSettings,
    date: (i64, i64, i64),
    seconds: i64,
) -> Result<String, JournalError> {
    let Some(template) = settings
        .template_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_content(date));
    };
    let path = relative_path(root, template, "путь к шаблону")?;
    let text = read_text(&path).map_err(|error| JournalError::Template {
        message: format!("не удалось прочитать шаблон {}: {error}", path.display()),
    })?;
    let name = note_name(settings, date)?;
    let time = format!("{:02}:{:02}", seconds / 3600, (seconds % 3600) / 60);
    Ok(text
        .replace("{{date}}", &name)
        .replace("{{time}}", &time)
        .replace("{{title}}", &name))
}

fn default_content(date: (i64, i64, i64)) -> String {
    let (year, month, day) = date;
    format!("---\ncreated: {year:04}-{month:02}-{day:02}\n---\n")
}

fn note_name(settings: &JournalSettings, date: (i64, i64, i64)) -> Result<String, JournalError> {
    let (year, month, day) = date;
    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || day > note_date::days_in_month(year, month)
    {
        return Err(JournalError::Date {
            message: format!("недопустимая дата: {year:04}-{month:02}-{day:02}"),
        });
    }
    let pieces = parse_format(&settings.date_format)?;
    let mut name = String::with_capacity(settings.date_format.len());
    for piece in &pieces {
        match piece {
            Piece::Year => {
                let _ = write!(&mut name, "{year:04}");
            }
            Piece::Month => {
                let _ = write!(&mut name, "{month:02}");
            }
            Piece::Day => {
                let _ = write!(&mut name, "{day:02}");
            }
            Piece::Literal(symbol) => name.push(*symbol),
        }
    }
    if name.trim().is_empty() {
        return Err(JournalError::Settings {
            message: format!("формат даты даёт пустое имя: {}", settings.date_format),
        });
    }
    Ok(name)
}

fn parse_format(value: &str) -> Result<Vec<Piece>, JournalError> {
    let format = value.trim();
    if format.is_empty() {
        return Err(JournalError::Settings {
            message: "формат даты не задан".to_owned(),
        });
    }
    let mut pieces = Vec::new();
    let mut years = 0;
    let mut months = 0;
    let mut days = 0;
    let mut rest = format;
    while let Some(symbol) = rest.chars().next() {
        if let Some(tail) = rest.strip_prefix("YYYY") {
            pieces.push(Piece::Year);
            years += 1;
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("MM") {
            pieces.push(Piece::Month);
            months += 1;
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("DD") {
            pieces.push(Piece::Day);
            days += 1;
            rest = tail;
        } else if matches!(symbol, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            || symbol.is_control()
        {
            return Err(JournalError::Settings {
                message: format!("формат даты не может содержать «{symbol}»: {format}"),
            });
        } else if symbol.is_ascii_alphabetic() {
            let token = rest
                .chars()
                .take_while(|symbol| symbol.is_ascii_alphabetic())
                .collect::<String>();
            return Err(JournalError::Settings {
                message: format!("неизвестный токен «{token}» в формате даты: {format}"),
            });
        } else {
            pieces.push(Piece::Literal(symbol));
            rest = &rest[symbol.len_utf8()..];
        }
    }
    if years != 1 || months != 1 || days != 1 {
        return Err(JournalError::Settings {
            message: format!("формат даты должен содержать по одному YYYY, MM и DD: {format}"),
        });
    }
    Ok(pieces)
}

fn parse_name(pieces: &[Piece], name: &str) -> Option<(i64, i64, i64)> {
    let mut rest = name;
    let mut year = None;
    let mut month = None;
    let mut day = None;
    for piece in pieces {
        match piece {
            Piece::Literal(symbol) => rest = rest.strip_prefix(*symbol)?,
            Piece::Year => {
                let (value, tail) = take_number(rest, 4)?;
                year = Some(value);
                rest = tail;
            }
            Piece::Month => {
                let (value, tail) = take_number(rest, 2)?;
                month = Some(value);
                rest = tail;
            }
            Piece::Day => {
                let (value, tail) = take_number(rest, 2)?;
                day = Some(value);
                rest = tail;
            }
        }
    }
    if !rest.is_empty() {
        return None;
    }
    let (year, month, day) = (year?, month?, day?);
    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || day > note_date::days_in_month(year, month)
    {
        return None;
    }
    Some((year, month, day))
}

fn take_number(text: &str, width: usize) -> Option<(i64, &str)> {
    let digits = text.get(..width)?;
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, &text[width..]))
}

fn date_from_file(pieces: &[Piece], path: &Path) -> Option<(i64, i64, i64)> {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return None;
    }
    parse_name(pieces, path.file_stem()?.to_str()?)
}

fn folder(root: &Path, folder: &str) -> Result<PathBuf, JournalError> {
    relative_path(root, folder, "путь к папке журнала")
}

fn relative_path(root: &Path, value: &str, label: &str) -> Result<PathBuf, JournalError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(JournalError::Settings {
            message: format!("{label} не задан"),
        });
    }
    let bytes = trimmed.as_bytes();
    let windows_drive =
        bytes.get(1) == Some(&b':') && bytes.first().is_some_and(u8::is_ascii_alphabetic);
    if Path::new(trimmed).is_absolute() || windows_drive {
        return Err(JournalError::Settings {
            message: format!("{label} должен быть внутри базы знаний: {value}"),
        });
    }
    let normalized = trimmed.replace('\\', "/");
    let mut relative = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => {
                return Err(JournalError::Settings {
                    message: format!("{label} должен быть внутри базы знаний: {value}"),
                })
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(JournalError::Settings {
            message: format!("{label} не задан"),
        });
    }
    Ok(root.join(relative))
}
