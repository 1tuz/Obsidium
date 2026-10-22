pub fn strip_frontmatter(text: &str) -> String {
    let Some((author, body)) = parse(text) else {
        return text.to_owned();
    };
    match author.filter(|value| !value.is_empty()) {
        Some(name) => {
            if body.is_empty() {
                name
            } else {
                format!("{name}\n{body}")
            }
        }
        None => body,
    }
}

fn parse(text: &str) -> Option<(Option<String>, String)> {
    let (yaml, body) = block(text)?;
    Some((extract_author(yaml), body.to_owned()))
}

struct Bounds {
    yaml_start: usize,
    yaml_end: usize,
    body_start: usize,
}

fn block(text: &str) -> Option<(&str, &str)> {
    let found = bounds(text)?;
    let body = text[found.body_start..].trim_start_matches(['\r', '\n']);
    Some((&text[found.yaml_start..found.yaml_end], body))
}

fn bounds(text: &str) -> Option<Bounds> {
    let lead = text.len() - text.trim_start().len();
    let after_open = text[lead..].strip_prefix("---")?;
    let first_break = after_open.find('\n')?;
    if !after_open[..first_break].trim().is_empty() {
        return None;
    }
    let yaml_start = lead + "---".len() + first_break + 1;
    let mut cursor = yaml_start;
    while cursor <= text.len() {
        let rest = &text[cursor..];
        let (line, step) = match rest.find('\n') {
            Some(position) => (&rest[..position], position + 1),
            None => (rest, rest.len()),
        };
        if line.trim() == "---" {
            return Some(Bounds {
                yaml_start,
                yaml_end: cursor,
                body_start: cursor + step,
            });
        }
        if step == 0 {
            break;
        }
        cursor += step;
    }
    None
}

pub fn body(text: &str) -> &str {
    bounds(text).map_or(text, |found| &text[found.body_start..])
}

pub fn yaml_block(text: &str) -> Option<&str> {
    block(text).map(|(yaml, _)| yaml)
}

#[derive(Clone, Debug, PartialEq)]
pub enum FieldValue {
    Scalar(String),
    List(Vec<String>),
    Remove,
}

pub fn set(text: &str, updates: &[(String, FieldValue)]) -> Result<String, String> {
    if updates.is_empty() {
        return Ok(text.to_owned());
    }
    let Some(found) = bounds(text) else {
        if text.trim_start().starts_with("---") {
            return Err(
                "Блок frontmatter открыт, но не закрыт разделителем «---» — исправьте заметку вручную"
                    .to_owned(),
            );
        }
        let mut created = Vec::new();
        for (key, value) in updates {
            created.extend(render(key, value)?);
        }
        if created.is_empty() {
            return Ok(text.to_owned());
        }
        return Ok(format!("---\n{}\n---\n{text}", created.join("\n")));
    };

    let line_ending = if text[found.yaml_start..found.yaml_end].contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines = text[found.yaml_start..found.yaml_end]
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for (key, value) in updates {
        match lines.iter().position(|line| declares(line, key)) {
            Some(index) => {
                let existing = lines[index]
                    .split_once(':')
                    .map_or_else(|| key.clone(), |(name, _)| name.trim().to_owned());
                let end = value_end(&lines, index);
                let replacement = render(&existing, value)?;
                lines.splice(index..end, replacement);
            }
            None => lines.extend(render(key, value)?),
        }
    }

    let mut yaml = lines.join(line_ending);
    if !yaml.is_empty() {
        yaml.push_str(line_ending);
    }
    Ok(format!(
        "{}{yaml}{}",
        &text[..found.yaml_start],
        &text[found.yaml_end..]
    ))
}

fn render(key: &str, value: &FieldValue) -> Result<Vec<String>, String> {
    match value {
        FieldValue::Scalar(value) => Ok(vec![entry(key, value)]),
        FieldValue::Remove => Ok(Vec::new()),
        FieldValue::List(items) if items.is_empty() => Ok(vec![format!("{key}: []")]),
        FieldValue::List(items) => {
            let mut lines = Vec::with_capacity(items.len() + 1);
            lines.push(format!("{key}:"));
            for item in items {
                let quoted = serde_json::to_string(item).map_err(|error| error.to_string())?;
                lines.push(format!("  - {quoted}"));
            }
            Ok(lines)
        }
    }
}

fn value_end(lines: &[String], start: usize) -> usize {
    let mut end = start + 1;
    let mut cursor = start + 1;
    while cursor < lines.len() {
        if lines[cursor].trim().is_empty() {
            cursor += 1;
            continue;
        }
        if !continues(&lines[cursor]) {
            break;
        }
        end = cursor + 1;
        cursor += 1;
    }
    end
}

fn continues(line: &str) -> bool {
    let trimmed = line.trim_start();
    line.starts_with([' ', '\t']) || trimmed == "-" || trimmed.starts_with("- ")
}

fn entry(key: &str, value: &str) -> String {
    format!("{key}: {value}")
}

fn declares(line: &str, key: &str) -> bool {
    !line.starts_with([' ', '\t'])
        && line
            .split_once(':')
            .is_some_and(|(name, _)| same_key(name, key))
}

fn same_key(left: &str, right: &str) -> bool {
    left.trim().to_lowercase() == right.trim().to_lowercase()
}

pub fn field(text: &str, wanted: &str) -> Option<String> {
    extract(block(text)?.0, wanted)
}

fn extract_author(yaml: &str) -> Option<String> {
    extract(yaml, "author")
}

fn extract(yaml: &str, wanted: &str) -> Option<String> {
    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case(wanted) {
            continue;
        }
        let value = unquote(value.trim());
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

pub fn unquote(value: &str) -> String {
    if (value.starts_with('"') && value.ends_with('"') && value.len() >= 2)
        || (value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2)
    {
        value[1..value.len() - 1].trim().to_owned()
    } else {
        value.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::{set, strip_frontmatter, FieldValue};
    use crate::search::fields::note_fields;

    fn keys(text: &str) -> Vec<String> {
        note_fields(text)
            .into_iter()
            .map(|field| field.key)
            .collect()
    }

    fn value_of(text: &str, key: &str) -> String {
        note_fields(text)
            .into_iter()
            .find(|field| field.key == key)
            .map(|field| field.text)
            .unwrap_or_default()
    }

    const BOOK: &str = "---\ncreated: 31-08-2026 | (19:31)\ncover: true\ntype: book\nauthor: Иван Ефремов\nПуть к файлу: \n---\nТело заметки.\n";

    fn update(key: &str, value: &str) -> Vec<(String, FieldValue)> {
        vec![(key.to_owned(), FieldValue::Scalar(value.to_owned()))]
    }

    #[test]
    fn rewrites_a_field_in_place_and_leaves_the_body_alone() {
        let updated = set(BOOK, &update("author", "Рэй Брэдбери")).unwrap();
        assert!(updated.contains("author: Рэй Брэдбери"));
        assert!(!updated.contains("Иван Ефремов"));
        assert!(
            updated.ends_with("---\nТело заметки.\n"),
            "тело заметки не тронуто: {updated}"
        );
        assert_eq!(keys(&updated).len(), 5, "новых ключей не появилось");
    }

    #[test]
    fn appends_an_unknown_field_after_the_existing_ones() {
        let updated = set(BOOK, &update("rating", "5")).unwrap();
        let found = keys(&updated);
        assert_eq!(
            found.first().unwrap(),
            "created",
            "порядок прежних ключей сохранён"
        );
        assert_eq!(found.last().unwrap(), "rating");
    }

    #[test]
    fn finds_the_key_regardless_of_case_and_keeps_its_original_spelling() {
        let updated = set(BOOK, &update("ПУТЬ К ФАЙЛУ", "Files/книга.epub")).unwrap();
        assert!(
            updated.contains("Путь к файлу: Files/книга.epub"),
            "написание ключа осталось прежним: {updated}"
        );
        assert_eq!(keys(&updated).len(), 5, "дубликат ключа не создан");
    }

    #[test]
    fn creates_the_block_for_a_note_that_had_none() {
        let updated = set("Только текст.\n", &update("type", "book")).unwrap();
        assert_eq!(updated, "---\ntype: book\n---\nТолько текст.\n");
    }

    #[test]
    fn refuses_to_touch_an_unclosed_block() {
        let broken = "---\ntype: book\nтело без закрывающего разделителя\n";
        assert!(
            set(broken, &update("type", "note")).is_err(),
            "второй блок поверх сломанного не создаётся"
        );
    }

    #[test]
    fn keeps_neighbouring_values_with_colons_untouched() {
        let note = "---\nsource: https://example.com/page\n---\nтекст";
        assert_eq!(value_of(note, "source"), "https://example.com/page");
        let updated = set(note, &update("author", "О. Генри")).unwrap();
        assert!(updated.contains("source: https://example.com/page"));
        assert!(updated.contains("author: О. Генри"));
    }

    #[test]
    fn setting_a_root_field_does_not_replace_a_nested_field_with_the_same_name() {
        let note = "---\nplugin:\n  title: nested\n---\nbody";

        let updated = set(note, &update("title", "root")).unwrap();

        assert_eq!(
            updated,
            "---\nplugin:\n  title: nested\ntitle: root\n---\nbody"
        );
    }

    #[test]
    fn updating_a_field_preserves_crlf_frontmatter() {
        let note = "---\r\ntitle: old\r\nplugin:\r\n  title: nested\r\n---\r\nbody";

        let updated = set(note, &update("title", "new")).unwrap();

        assert_eq!(
            updated,
            "---\r\ntitle: new\r\nplugin:\r\n  title: nested\r\n---\r\nbody"
        );
    }

    fn list(key: &str, items: &[&str]) -> Vec<(String, FieldValue)> {
        vec![(
            key.to_owned(),
            FieldValue::List(items.iter().map(|item| (*item).to_owned()).collect()),
        )]
    }

    fn remove(key: &str) -> Vec<(String, FieldValue)> {
        vec![(key.to_owned(), FieldValue::Remove)]
    }

    #[test]
    fn writing_a_list_over_a_scalar_turns_the_value_into_a_block_list() {
        let note = "---\ntype: book\nauthor: Ефремов\ntags: old\nstatus: draft\n---\nтело\n";

        let updated = set(note, &list("tags", &["a", "b"])).unwrap();

        assert_eq!(
            updated,
            "---\ntype: book\nauthor: Ефремов\ntags:\n  - \"a\"\n  - \"b\"\nstatus: draft\n---\nтело\n"
        );
    }

    #[test]
    fn replacing_a_block_list_removes_every_old_item() {
        let note = "---\ntags:\n  - old1\n  - old2\nauthor: X\n---\nтело\n";

        let updated = set(note, &update("tags", "\"single\"")).unwrap();

        assert_eq!(updated, "---\ntags: \"single\"\nauthor: X\n---\nтело\n");
    }

    #[test]
    fn replacing_an_inline_list_keeps_comments_blank_lines_and_order() {
        let note = "---\n# комментарий\ntags: [old, other]\n\nstatus: draft\n---\nтело\n";

        let updated = set(note, &list("tags", &["new"])).unwrap();

        assert_eq!(
            updated,
            "---\n# комментарий\ntags:\n  - \"new\"\n\nstatus: draft\n---\nтело\n"
        );
    }

    #[test]
    fn removing_a_key_deletes_its_whole_value_and_keeps_the_body() {
        let note = "---\ntags:\n  - a\n  - b\nauthor: X\n---\nтело\n";

        let updated = set(note, &remove("tags")).unwrap();

        assert_eq!(updated, "---\nauthor: X\n---\nтело\n");
        assert_eq!(set(note, &remove("нет такого")).unwrap(), note);
    }

    #[test]
    fn a_list_written_into_crlf_frontmatter_keeps_the_line_ending() {
        let note = "---\r\ntags: old\r\nauthor: X\r\n---\r\nbody\r\n";

        let updated = set(note, &list("tags", &["a"])).unwrap();

        assert_eq!(
            updated,
            "---\r\ntags:\r\n  - \"a\"\r\nauthor: X\r\n---\r\nbody\r\n"
        );
    }

    #[test]
    fn an_empty_list_stays_a_list() {
        let note = "---\ntags: old\n---\nтело\n";

        let updated = set(note, &list("tags", &[])).unwrap();

        assert_eq!(updated, "---\ntags: []\n---\nтело\n");
        assert_eq!(
            note_fields(&updated)[0].kind,
            crate::search::fields::FieldKind::List
        );
    }

    const SAMPLE: &str = r#"---
type: book
author: Isaac Asimov
status: to-read
pages: 0/0
tags: []
rating: 0
cover_url: https://cdn.example.com/cover.jpg
page_cover_url: 
---
# Foundation

Actual note body."#;

    #[test]
    fn keeps_only_author_from_frontmatter() {
        let cleaned = strip_frontmatter(SAMPLE);
        assert!(cleaned.contains("Isaac Asimov"));
        assert!(cleaned.contains("Actual note body"));
        assert!(!cleaned.contains("type:"));
        assert!(!cleaned.contains("to-read"));
        assert!(!cleaned.contains("cover_url"));
        assert!(!cleaned.contains("tags:"));
    }

    #[test]
    fn notes_without_frontmatter_pass_through() {
        let text = "plain note without yaml";
        assert_eq!(strip_frontmatter(text), text);
    }

    #[test]
    fn empty_author_yields_body_only() {
        let text = "---\ntype: book\nauthor:\nstatus: x\n---\nbody";
        let cleaned = strip_frontmatter(text);
        assert_eq!(cleaned, "body");
        assert!(!cleaned.contains("type"));
    }
}
