use super::markdown::lines_outside_fences;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockId {
    pub id: String,
    pub line: usize,
    pub offset: usize,
}

pub fn block_ids(text: &str) -> Vec<BlockId> {
    let lines = text.lines().collect::<Vec<_>>();
    let starts = line_starts(text);
    let mut visible = vec![false; lines.len()];
    for (index, _) in lines_outside_fences(text) {
        visible[index] = true;
    }
    let mut found = Vec::new();
    for index in 0..lines.len() {
        if !visible[index] {
            continue;
        }
        let Some(id) = marker(lines[index]) else {
            continue;
        };
        if heading(lines[index]) || !ends_block(&lines, &visible, index) {
            continue;
        }
        found.push(BlockId {
            id: id.to_owned(),
            line: index + 1,
            offset: starts[block_start(&lines, &visible, index)],
        });
    }
    found
}

pub fn block_offset(text: &str, id: &str) -> Option<usize> {
    block_ids(text)
        .into_iter()
        .find(|block| block.id == id)
        .map(|block| block.offset)
}

fn marker(line: &str) -> Option<&str> {
    let trimmed = line.trim_end();
    let at = trimmed.rfind('^')?;
    if at == 0
        || !trimmed[..at]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace)
    {
        return None;
    }
    if open_code_span(&trimmed[..at]) {
        return None;
    }
    let id = &trimmed[at + 1..];
    let valid = !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    valid.then_some(id)
}

fn open_code_span(prefix: &str) -> bool {
    let bytes = prefix.as_bytes();
    let mut index = 0;
    let mut runs = 0;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            runs += 1;
            while index < bytes.len() && bytes[index] == b'`' {
                index += 1;
            }
        } else {
            index += 1;
        }
    }
    runs % 2 == 1
}

fn heading(line: &str) -> bool {
    let trimmed = line.trim_start();
    let level = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    (1..=6).contains(&level) && trimmed[level..].starts_with(' ')
}

fn list_item(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        return true;
    }
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    let rest = &trimmed[digits..];
    rest.starts_with(". ") || rest.starts_with(") ")
}

fn ends_block(lines: &[&str], visible: &[bool], index: usize) -> bool {
    let Some(next) = lines.get(index + 1) else {
        return true;
    };
    if next.trim().is_empty() || !visible[index + 1] || heading(next) {
        return true;
    }
    list_item(lines[index]) && !next.starts_with(' ') && !next.starts_with('\t')
}

fn block_start(lines: &[&str], visible: &[bool], index: usize) -> usize {
    if list_item(lines[index]) {
        return index;
    }
    let mut start = index;
    while start > 0 && visible[start - 1] && !lines[start - 1].trim().is_empty() {
        if heading(lines[start - 1]) {
            break;
        }
        start -= 1;
        if list_item(lines[start]) {
            break;
        }
    }
    start
}

fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, byte) in text.bytes().enumerate() {
        if byte == b'\n' && index + 1 < text.len() {
            starts.push(index + 1);
        }
    }
    starts
}

#[cfg(test)]
mod tests {
    use super::{block_ids, block_offset};

    fn ids(text: &str) -> Vec<String> {
        block_ids(text).into_iter().map(|block| block.id).collect()
    }

    #[test]
    fn finds_ids_at_the_end_of_paragraphs() {
        let text = "Первый абзац ^first\n\nВторой\nабзац ^second\n";
        let found = block_ids(text);
        assert_eq!(ids(text), ["first", "second"]);
        assert_eq!(found[0].line, 1);
        assert_eq!(found[0].offset, 0);
        assert_eq!(found[1].line, 4);
        assert_eq!(found[1].offset, text.find("Второй").unwrap());
    }

    #[test]
    fn ignores_ids_in_fences_and_inline_code() {
        let text = "```\nкод ^fenced\n```\n\nТекст `незакрытый ^inline\n\nРеальный ^real\n";
        assert_eq!(ids(text), ["real"]);
        assert_eq!(block_offset(text, "fenced"), None);
        assert_eq!(block_offset(text, "inline"), None);
        assert_eq!(
            block_offset(text, "real"),
            Some(text.find("Реальный").unwrap())
        );
    }

    #[test]
    fn a_marker_inside_a_paragraph_is_not_an_id() {
        assert!(block_ids("начало ^mid\nпродолжение\n").is_empty());
    }

    #[test]
    fn a_heading_is_not_a_block_id() {
        assert!(block_ids("## Раздел ^heading\n").is_empty());
    }

    #[test]
    fn a_heading_interrupts_a_paragraph() {
        let after = "## Раздел\nтекст ^after\n";
        assert_eq!(
            block_offset(after, "after"),
            Some(after.find("текст").unwrap())
        );
        let before = "текст ^before\n## Раздел\n";
        assert_eq!(block_offset(before, "before"), Some(0));
    }

    #[test]
    fn a_list_item_is_its_own_block() {
        let text = "- один\n- два ^item\n- три\n";
        let found = block_ids(text);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "item");
        assert_eq!(found[0].offset, text.find("- два").unwrap());
    }

    #[test]
    fn requires_a_space_before_the_marker_and_a_known_id() {
        assert!(block_ids("слово^joined\n").is_empty());
        assert!(block_ids("конец ^bad_id\n").is_empty());
        assert!(block_ids("конец ^\n").is_empty());
    }
}
