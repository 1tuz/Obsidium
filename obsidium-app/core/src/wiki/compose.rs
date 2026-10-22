use crate::search::analyzer::frontmatter::{self, FieldValue};
use crate::search::fields::note_fields;
use crate::search::wiki::parser::extract;
use crate::search::wiki::target::target_key;

pub fn append_link(content: &str, target: &str) -> Option<String> {
    if links_target(content, target) {
        return None;
    }
    let link = format!("[[{target}]]");
    if content.is_empty() {
        return Some(link);
    }
    let eol = line_ending(content);
    Some(if content.ends_with('\n') {
        format!("{content}{link}{eol}")
    } else {
        format!("{content}{eol}{link}")
    })
}

pub fn remove_link(content: &str, target: &str) -> Option<String> {
    let (wanted, _) = target_key(target);
    let link = extract(content)
        .into_iter()
        .find(|link| target_key(&link.target).0 == wanted)?;
    let start = link.target_range.start.checked_sub(2)?;
    let close = link.target_range.end + content[link.target_range.end..].find("]]")? + 2;
    let mut next = String::with_capacity(content.len());
    next.push_str(&content[..start]);
    next.push_str(&content[close..]);
    Some(without_blank_line(next, start))
}

pub fn frontmatter_links(content: &str, key: &str) -> Vec<String> {
    current_items(content, key)
}

pub fn add_frontmatter_link(
    content: &str,
    key: &str,
    target: &str,
) -> Result<Option<String>, String> {
    let value = format!("[[{target}]]");
    let mut items = current_items(content, key);
    if items.iter().any(|item| same_target(item, &value)) {
        return Ok(None);
    }
    items.push(value);
    let next = frontmatter::set(content, &[(key.to_owned(), FieldValue::List(items))])?;
    Ok((next != content).then_some(next))
}

pub fn remove_frontmatter_link(
    content: &str,
    key: &str,
    target: &str,
) -> Result<Option<String>, String> {
    let mut items = current_items(content, key);
    let Some(position) = items.iter().position(|item| same_target(item, target)) else {
        return Ok(None);
    };
    items.remove(position);
    let next = frontmatter::set(content, &[(key.to_owned(), FieldValue::List(items))])?;
    Ok((next != content).then_some(next))
}

fn current_items(content: &str, key: &str) -> Vec<String> {
    if let Some(value) = frontmatter::field(content, key) {
        if value.starts_with('[') && value.ends_with(']') && !value.starts_with("[[") {
            return value[1..value.len() - 1]
                .split(',')
                .map(|item| frontmatter::unquote(item.trim()))
                .filter(|item| !item.is_empty())
                .collect();
        }
        return vec![value];
    }
    note_fields(content)
        .into_iter()
        .find(|field| field.key.eq_ignore_ascii_case(key))
        .map(|field| field.items)
        .unwrap_or_default()
}

fn links_target(content: &str, target: &str) -> bool {
    let (wanted, _) = target_key(target);
    extract(content)
        .iter()
        .any(|link| target_key(&link.target).0 == wanted)
}

fn line_ending(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn link_target(value: &str) -> &str {
    let value = value.trim();
    let value = value
        .strip_prefix("[[")
        .and_then(|rest| rest.strip_suffix("]]"))
        .unwrap_or(value);
    value.split('|').next().unwrap_or_default().trim()
}

fn same_target(left: &str, right: &str) -> bool {
    target_key(link_target(left)).0 == target_key(link_target(right)).0
}

fn without_blank_line(mut text: String, at: usize) -> String {
    let start = text[..at.min(text.len())]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let end = text[start..]
        .find('\n')
        .map_or(text.len(), |index| start + index);
    if !text[start..end].trim().is_empty() {
        return text;
    }
    if end < text.len() {
        text.replace_range(start..end + 1, "");
    } else {
        text.truncate(start);
        if text.ends_with('\n') {
            text.pop();
            if text.ends_with('\r') {
                text.pop();
            }
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::{
        add_frontmatter_link, append_link, frontmatter_links, remove_frontmatter_link, remove_link,
    };

    #[test]
    fn a_note_that_already_links_the_target_gains_nothing() {
        assert_eq!(append_link("текст [[A]]\n", "A"), None);
        assert_eq!(append_link("текст [[A|псевдоним]]\n", "A"), None);
        assert_eq!(append_link("текст [[A.md]]\n", "A"), None);
    }

    #[test]
    fn the_link_is_appended_on_its_own_line() {
        assert_eq!(
            append_link("текст\n", "B"),
            Some("текст\n[[B]]\n".to_owned())
        );
    }

    #[test]
    fn a_crlf_note_keeps_crlf() {
        assert_eq!(
            append_link("строка\r\n", "B"),
            Some("строка\r\n[[B]]\r\n".to_owned())
        );
    }

    #[test]
    fn a_note_without_a_trailing_newline_stays_without_one() {
        assert_eq!(append_link("текст", "B"), Some("текст\n[[B]]".to_owned()));
        assert_eq!(append_link("", "B"), Some("[[B]]".to_owned()));
    }

    #[test]
    fn removal_takes_exactly_one_link_and_keeps_the_rest_of_the_text() {
        assert_eq!(
            remove_link("до [[A]] после\n", "A"),
            Some("до  после\n".to_owned())
        );
        assert_eq!(
            remove_link("[[A|псевдоним]] хвост\n", "A"),
            Some(" хвост\n".to_owned())
        );
        assert_eq!(
            remove_link("[[A]] и [[A]]\n", "A"),
            Some(" и [[A]]\n".to_owned())
        );
        assert_eq!(
            remove_link("[[A]] и [[B]]\n", "A"),
            Some(" и [[B]]\n".to_owned())
        );
        assert_eq!(remove_link("нет ссылки\n", "A"), None);
    }

    #[test]
    fn a_line_left_empty_by_removal_disappears() {
        assert_eq!(remove_link("[[A]]\n", "A"), Some(String::new()));
        assert_eq!(remove_link("текст\n[[A]]", "A"), Some("текст".to_owned()));
    }

    #[test]
    fn a_structural_link_is_added_as_a_list_entry() {
        let note = "---\ntype: note\n---\nтело\n";
        let linked = add_frontmatter_link(note, "related", "Проекты/B")
            .unwrap()
            .unwrap();
        assert_eq!(
            linked,
            "---\ntype: note\nrelated:\n  - \"[[Проекты/B]]\"\n---\nтело\n"
        );
        assert_eq!(
            frontmatter_links(&linked, "related"),
            vec!["[[Проекты/B]]".to_owned()]
        );
        assert_eq!(
            add_frontmatter_link(&linked, "related", "Проекты/B").unwrap(),
            None
        );
    }

    #[test]
    fn a_block_list_gains_one_entry_and_removal_drops_it() {
        let note = "---\nrelated:\n  - \"[[A]]\"\n---\nтело";
        let linked = add_frontmatter_link(note, "related", "B").unwrap().unwrap();
        assert_eq!(
            linked,
            "---\nrelated:\n  - \"[[A]]\"\n  - \"[[B]]\"\n---\nтело"
        );
        let unlinked = remove_frontmatter_link(&linked, "related", "A")
            .unwrap()
            .unwrap();
        assert_eq!(unlinked, "---\nrelated:\n  - \"[[B]]\"\n---\nтело");
        let emptied = remove_frontmatter_link(&unlinked, "related", "B")
            .unwrap()
            .unwrap();
        assert_eq!(emptied, "---\nrelated: []\n---\nтело");
        assert_eq!(frontmatter_links(&emptied, "related"), Vec::<String>::new());
    }

    #[test]
    fn an_inline_list_turns_into_a_block_list() {
        let note = "---\nrelated: [\"[[A]]\"]\n---\nтело";
        let linked = add_frontmatter_link(note, "related", "B").unwrap().unwrap();
        assert_eq!(
            linked,
            "---\nrelated:\n  - \"[[A]]\"\n  - \"[[B]]\"\n---\nтело"
        );
    }

    #[test]
    fn a_scalar_value_becomes_the_first_list_entry() {
        let note = "---\nparent: \"[[A]]\"\n---\nтело";
        let linked = add_frontmatter_link(note, "parent", "B").unwrap().unwrap();
        assert_eq!(
            linked,
            "---\nparent:\n  - \"[[A]]\"\n  - \"[[B]]\"\n---\nтело"
        );
        assert_eq!(
            remove_frontmatter_link(note, "parent", "A").unwrap(),
            Some("---\nparent: []\n---\nтело".to_owned())
        );
    }

    #[test]
    fn a_note_without_frontmatter_gains_the_block() {
        let linked = add_frontmatter_link("тело\n", "related", "B")
            .unwrap()
            .unwrap();
        assert_eq!(linked, "---\nrelated:\n  - \"[[B]]\"\n---\nтело\n");
        assert_eq!(
            remove_frontmatter_link("тело\n", "related", "B").unwrap(),
            None
        );
    }

    #[test]
    fn crlf_frontmatter_stays_crlf() {
        let note = "---\r\nrelated:\r\n  - \"[[A]]\"\r\n---\r\nтело";
        let linked = add_frontmatter_link(note, "related", "B").unwrap().unwrap();
        assert_eq!(
            linked,
            "---\r\nrelated:\r\n  - \"[[A]]\"\r\n  - \"[[B]]\"\r\n---\r\nтело"
        );
        assert_eq!(
            remove_frontmatter_link(&linked, "related", "B").unwrap(),
            Some(note.to_owned())
        );
    }
}
