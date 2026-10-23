use super::headings;
use super::matching::find_prefix_matches;
use std::collections::HashSet;
use std::ops::Range;

const EXCERPT_CHARS: usize = 600;
const BEFORE_CHARS: usize = 150;

#[derive(Clone, Debug)]
pub struct Fragment {
    pub heading: Option<String>,
    pub line_start: usize,
    pub line_end: usize,
    pub excerpt: String,
}

pub fn fragments(content: &str, terms: &[String], limit: usize) -> Vec<Fragment> {
    if limit == 0 || content.trim().is_empty() {
        return Vec::new();
    }
    let sections = sections(content);
    let mut ranked = sections
        .iter()
        .enumerate()
        .filter(|(_, section)| !content[section.range.clone()].trim().is_empty())
        .map(|(index, section)| {
            let found = find_prefix_matches(&content[section.range.clone()], terms);
            let distinct = found
                .iter()
                .map(|(_, _, term)| *term)
                .collect::<HashSet<_>>()
                .len();
            (distinct, found.len(), section.level, index)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| right.2.cmp(&left.2))
            .then_with(|| left.3.cmp(&right.3))
    });

    let mut picked = ranked
        .iter()
        .filter(|(distinct, _, _, _)| *distinct > 0)
        .map(|(_, _, _, index)| *index)
        .collect::<Vec<_>>();
    if picked.is_empty() {
        if let Some((_, _, _, index)) = ranked.first() {
            picked.push(*index);
        }
    }

    let mut found = Vec::<Fragment>::new();
    let mut covered = Vec::<Range<usize>>::new();
    for index in picked {
        let section = &sections[index];
        if covered
            .iter()
            .any(|range| range.start < section.range.end && section.range.start < range.end)
        {
            continue;
        }
        let matches = find_prefix_matches(&content[section.range.clone()], terms);
        let first = matches
            .first()
            .map_or(section.range.start, |(start, _, _)| {
                section.range.start + *start
            });
        let Some(fragment) = cut(content, &section.range, first, section.title.clone()) else {
            continue;
        };
        if found
            .iter()
            .any(|existing| existing.excerpt == fragment.excerpt)
        {
            continue;
        }
        found.push(fragment);
        covered.push(section.range.clone());
        if found.len() >= limit {
            break;
        }
    }
    found
}

fn sections(content: &str) -> Vec<Section> {
    let found = headings::headings(content);
    let mut sections = Vec::new();
    let body_start = body_offset(content);
    let first = found.first().map_or(content.len(), |heading| heading.start);
    if first > body_start && !content[body_start..first].trim().is_empty() {
        sections.push(Section {
            title: None,
            level: 0,
            range: body_start..first,
        });
    }
    for heading in found {
        sections.push(Section {
            title: Some(heading.title.clone()),
            level: heading.level,
            range: heading.start..heading.content.end,
        });
    }
    sections
}

fn body_offset(content: &str) -> usize {
    let rest = content
        .strip_prefix("---\r\n")
        .or_else(|| content.strip_prefix("---\n"));
    let Some(rest) = rest else {
        return 0;
    };
    let offset = content.len() - rest.len();
    let mut position = offset;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        position += line.len();
        if trimmed == "---" || trimmed == "..." {
            return position;
        }
    }
    0
}

struct Section {
    title: Option<String>,
    level: u8,
    range: Range<usize>,
}

fn cut(
    content: &str,
    range: &Range<usize>,
    at: usize,
    heading: Option<String>,
) -> Option<Fragment> {
    let mut start = at.saturating_sub(BEFORE_CHARS).max(range.start);
    while start < at && !content.is_char_boundary(start) {
        start += 1;
    }
    start = content[..start]
        .rfind('\n')
        .map_or(range.start, |index| index + 1)
        .max(range.start);
    while start < range.end && content[start..].starts_with('\n') {
        start += 1;
    }
    if start >= range.end {
        return None;
    }
    let covered = advance(content, at, 1, range.end);
    let target = advance(content, start, EXCERPT_CHARS, range.end).max(covered);
    let end = content[target..range.end]
        .find('\n')
        .map_or(range.end, |offset| target + offset);
    let excerpt = content[start..end].trim_end().to_owned();
    if excerpt.trim().is_empty() {
        return None;
    }
    let line_start = line_number(content, start);
    let line_end = line_start + excerpt.matches('\n').count();
    Some(Fragment {
        heading,
        line_start,
        line_end,
        excerpt,
    })
}

fn advance(content: &str, start: usize, count: usize, limit: usize) -> usize {
    content[start..limit]
        .char_indices()
        .nth(count)
        .map_or(limit, |(offset, _)| start + offset)
}

fn line_number(content: &str, offset: usize) -> usize {
    content[..offset]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

#[cfg(test)]
mod tests {
    use super::{fragments, line_number};

    fn terms(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn the_frontmatter_block_is_not_a_section() {
        let content = "---\ntype: note\ntags: [kubernetes]\n---\n# TLS\n\nошибка рукопожатия\n";
        let found = fragments(content, &terms(&["kubernetes", "ошибка"]), 2);
        assert!(!found.is_empty());
        for fragment in &found {
            assert!(
                !fragment.excerpt.contains("tags:"),
                "frontmatter попал во фрагмент: {}",
                fragment.excerpt
            );
            assert!(fragment.line_start >= 5, "фрагмент начинается в теле");
        }
    }

    #[test]
    fn picks_the_section_with_the_most_matched_terms() {
        let content = "# Введение\n\nобщий текст\n\n## Установка\n\nпакет ставится командой установка\n\n## Настройка\n\nдругие параметры\n";
        let found = fragments(content, &terms(&["установка"]), 2);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].heading.as_deref(), Some("Установка"));
        assert_eq!(found[0].line_start, 5);
        assert!(found[0].excerpt.contains("установка"));
    }

    #[test]
    fn line_numbers_match_the_file_lines() {
        let content = "# Первый\n\nтекст\n\n## Второй\n\nслово здесь\n\n## Третий\n\nслово снова\n";
        let found = fragments(content, &terms(&["слово"]), 2);
        let lines = content.lines().collect::<Vec<_>>();
        for fragment in &found {
            assert!(fragment.line_start >= 1);
            assert!(fragment.line_end >= fragment.line_start);
            assert!(fragment.line_end <= lines.len());
            let joined = lines[fragment.line_start - 1..fragment.line_end].join("\n");
            assert_eq!(joined, fragment.excerpt);
        }
    }

    #[test]
    fn identical_excerpts_are_returned_once() {
        let content = "# Раздел\n\nслово\n\n# Раздел\n\nслово\n";
        let found = fragments(content, &terms(&["слово"]), 2);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn counts_lines_from_one() {
        assert_eq!(line_number("а\nб\nв", 0), 1);
        assert_eq!(line_number("а\nб\nв", 3), 2);
    }
}
