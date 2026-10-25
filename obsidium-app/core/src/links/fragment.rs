use crate::search::blocks;
use crate::search::headings;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FragmentKind {
    Heading(String),
    Block(String),
}

pub fn parse(fragment: &str) -> Option<FragmentKind> {
    let trimmed = fragment.trim().trim_start_matches('#').trim();
    if trimmed.is_empty() {
        return None;
    }
    match trimmed.strip_prefix('^') {
        Some(id) if block_id(id) => Some(FragmentKind::Block(id.to_owned())),
        Some(_) => None,
        None => Some(FragmentKind::Heading(trimmed.to_owned())),
    }
}

pub fn offset(body: &str, fragment: &str) -> Option<usize> {
    if fragment.trim().is_empty() {
        return Some(0);
    }
    match parse(fragment)? {
        FragmentKind::Block(id) => blocks::block_offset(body, &id),
        FragmentKind::Heading(title) => headings::matching(&headings::headings(body), &title)
            .first()
            .map(|heading| heading.start),
    }
}

fn block_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[cfg(test)]
mod tests {
    use super::{offset, parse, FragmentKind};

    const NOTE: &str = "# Top\n\nbody\n\n## Part two\n\nline ^block-1\n";

    #[test]
    fn reads_the_fragment_kind_and_value() {
        assert_eq!(
            parse("#^block-1"),
            Some(FragmentKind::Block("block-1".to_owned()))
        );
        assert_eq!(
            parse("^block-1"),
            Some(FragmentKind::Block("block-1".to_owned()))
        );
        assert_eq!(
            parse("#Part two"),
            Some(FragmentKind::Heading("Part two".to_owned()))
        );
        assert_eq!(
            parse("Part two"),
            Some(FragmentKind::Heading("Part two".to_owned()))
        );
        assert_eq!(parse("^"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn resolves_headings_and_blocks_to_offsets() {
        assert_eq!(offset(NOTE, "Part two"), Some(13));
        assert_eq!(offset(NOTE, "^block-1"), Some(26));
        assert_eq!(offset(NOTE, "Missing"), None);
        assert_eq!(offset(NOTE, "^missing"), None);
    }

    #[test]
    fn opens_the_top_for_an_empty_fragment() {
        assert_eq!(offset(NOTE, ""), Some(0));
        assert_eq!(offset(NOTE, "   "), Some(0));
    }

    #[test]
    fn a_multi_line_paragraph_resolves_to_its_first_line() {
        let body = "Первый абзац\nвторая строка ^risks\n";
        assert_eq!(offset(body, "^risks"), Some(0));
    }

    #[test]
    fn a_block_id_inside_code_does_not_resolve() {
        let body = "```md\nтекст ^block\n```\n";
        assert_eq!(offset(body, "^block"), None);
    }
}
