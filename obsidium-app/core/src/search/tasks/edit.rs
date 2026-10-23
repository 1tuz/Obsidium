use super::parse::{note_tasks, Task};
use crate::search::headings;
use std::collections::HashMap;

const ID_HASH_LENGTH: usize = 16;

#[derive(Clone, Debug, Default)]
pub struct Selector {
    pub task_id: Option<String>,
    pub line: Option<usize>,
}

struct Located {
    task: Task,
}

pub fn tasks_with_ids(body: &str) -> Vec<(Task, String)> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    note_tasks(body)
        .into_iter()
        .map(|task| {
            let occurrence = seen.entry(task.text.clone()).or_default();
            let id = task_id(&task.text, *occurrence);
            *occurrence += 1;
            (task, id)
        })
        .collect()
}

pub fn task_id(text: &str, occurrence: usize) -> String {
    format!("{}:{occurrence}", text_hash(text))
}

pub fn create(
    body: &str,
    text: &str,
    under_heading: Option<&str>,
) -> Result<(String, usize), String> {
    let body = normalized(body);
    let text = clean_text(text)?;
    let line = if text.is_empty() {
        "- [ ]".to_owned()
    } else {
        format!("- [ ] {text}")
    };
    let offset = match under_heading
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(heading) => heading_offset(&body, heading)?,
        None => body.len(),
    };
    Ok(insert_at(&body, offset, &line))
}

pub fn update(body: &str, selector: &Selector, new_text: &str) -> Result<String, String> {
    let body = normalized(body);
    let new_text = clean_text(new_text)?;
    let located = locate(&body, selector)?;
    let mut lines = body.split('\n').collect::<Vec<_>>();
    let index = located.task.line - 1;
    let line = lines[index];
    let (_, close) = checkbox_bounds(line)?;
    let after = &line[close + 1..];
    let spacing = after
        .chars()
        .take_while(|symbol| *symbol == ' ' || *symbol == '\t')
        .collect::<String>();
    let mut rebuilt = String::with_capacity(line.len() + new_text.len());
    rebuilt.push_str(&line[..=close]);
    if !new_text.is_empty() {
        rebuilt.push_str(if spacing.is_empty() {
            " "
        } else {
            spacing.as_str()
        });
        rebuilt.push_str(&new_text);
    }
    lines[index] = &rebuilt;
    Ok(lines.join("\n"))
}

pub fn toggle(body: &str, selector: &Selector, done: Option<bool>) -> Result<String, String> {
    let body = normalized(body);
    let located = locate(&body, selector)?;
    let mut lines = body.split('\n').collect::<Vec<_>>();
    let index = located.task.line - 1;
    let line = lines[index];
    let (open, _) = checkbox_bounds(line)?;
    let state_start = open + 1;
    let state = line[state_start..]
        .chars()
        .next()
        .ok_or_else(|| "У задачи нет отметки в квадратных скобках".to_owned())?;
    let state_end = state_start + state.len_utf8();
    let wanted = match done {
        Some(value) => value,
        None => state.is_whitespace(),
    };
    let mark = if wanted { 'x' } else { ' ' };
    let rebuilt = format!("{}{}{}", &line[..state_start], mark, &line[state_end..]);
    lines[index] = &rebuilt;
    Ok(lines.join("\n"))
}

pub fn delete(body: &str, selector: &Selector) -> Result<String, String> {
    let body = normalized(body);
    let located = locate(&body, selector)?;
    let mut lines = body.split('\n').collect::<Vec<_>>();
    lines.remove(located.task.line - 1);
    Ok(lines.join("\n"))
}

fn normalized(body: &str) -> String {
    crate::files::document::normalize_line_endings(body.to_owned())
}

fn clean_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("Текст задачи не может содержать перевод строки".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn heading_offset(body: &str, wanted: &str) -> Result<usize, String> {
    let outline = headings::headings(body);
    let found = headings::matching(&outline, wanted);
    match found.len() {
        0 => Err(format!("Заголовок не найден: {wanted}")),
        1 => Ok(found[0].content.start),
        count => Err(format!(
            "Заголовок «{wanted}» встречается в заметке больше одного раза (всего: {count}) — уточните раздел"
        )),
    }
}

fn insert_at(body: &str, offset: usize, line: &str) -> (String, usize) {
    let mut next = String::with_capacity(body.len() + line.len() + 2);
    next.push_str(&body[..offset]);
    let separator = offset > 0 && !body[..offset].ends_with('\n');
    if separator {
        next.push('\n');
    }
    next.push_str(line);
    next.push('\n');
    next.push_str(&body[offset..]);
    let number = next[..offset + usize::from(separator)]
        .matches('\n')
        .count()
        + 1;
    (next, number)
}

fn checkbox_bounds(line: &str) -> Result<(usize, usize), String> {
    let open = line
        .find('[')
        .ok_or_else(|| "У задачи нет отметки в квадратных скобках".to_owned())?;
    let close = line[open..]
        .find(']')
        .map(|index| open + index)
        .ok_or_else(|| "У задачи нет отметки в квадратных скобках".to_owned())?;
    Ok((open, close))
}

fn locate(body: &str, selector: &Selector) -> Result<Located, String> {
    let found = tasks_with_ids(body);
    if let Some(raw) = selector
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some((task, _)) = found.iter().find(|(_, id)| id == raw) {
            return Ok(located(task));
        }
        if let Some(hash) = id_hash(raw) {
            if let Some(line) = selector.line {
                if let Some((task, _)) = found.iter().find(|(task, _)| task.line == line) {
                    if text_hash(&task.text) == hash {
                        return Ok(located(task));
                    }
                }
            }
            let matches = found
                .iter()
                .filter(|(task, _)| text_hash(&task.text) == hash)
                .collect::<Vec<_>>();
            return match matches.len() {
                1 => Ok(located(&matches[0].0)),
                0 => Err(not_found(raw)),
                count => Err(ambiguous(raw, count, &matches)),
            };
        }
        if let Some(line) = selector.line {
            if let Some((task, _)) = found.iter().find(|(task, _)| task.line == line) {
                if task.text == raw {
                    return Ok(located(task));
                }
            }
        }
        let matches = found
            .iter()
            .filter(|(task, _)| task.text == raw)
            .collect::<Vec<_>>();
        return match matches.len() {
            1 => Ok(located(&matches[0].0)),
            0 => Err(not_found(raw)),
            count => Err(ambiguous(raw, count, &matches)),
        };
    }
    if let Some(line) = selector.line {
        return found
            .iter()
            .find(|(task, _)| task.line == line)
            .map(|(task, _)| located(task))
            .ok_or_else(|| format!("На строке {line} нет задачи"));
    }
    Err("Укажите taskId или line — без них непонятно, какую задачу менять".to_owned())
}

fn located(task: &Task) -> Located {
    Located { task: task.clone() }
}

fn text_hash(text: &str) -> String {
    let hex = blake3::hash(text.trim().as_bytes()).to_hex().to_string();
    hex[..ID_HASH_LENGTH].to_owned()
}

fn id_hash(value: &str) -> Option<&str> {
    let (hash, ordinal) = value.rsplit_once(':')?;
    if hash.len() != ID_HASH_LENGTH
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || ordinal.is_empty()
        || !ordinal.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(hash)
}

fn not_found(selector: &str) -> String {
    format!("Задача не найдена: {selector}")
}

fn ambiguous(selector: &str, count: usize, matches: &[&(Task, String)]) -> String {
    let ids = matches
        .iter()
        .map(|(_, id)| id.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    format!("Несколько задач подходят под «{selector}» (всего: {count}) — укажите taskId: {ids}")
}

#[cfg(test)]
mod tests {
    use super::{create, delete, tasks_with_ids, toggle, update, Selector};

    fn ids(body: &str) -> Vec<String> {
        tasks_with_ids(body).into_iter().map(|(_, id)| id).collect()
    }

    #[test]
    fn editing_above_a_task_keeps_its_id_resolvable() {
        let body = "- [ ] первая\n- [x] вторая\n";
        let target = ids(body)[1].clone();
        let moved = format!("# Заголовок\n\nНовая строка\n\n{body}");
        let updated = update(
            &moved,
            &Selector {
                task_id: Some(target),
                line: Some(2),
            },
            "изменённая",
        )
        .unwrap();
        assert_eq!(
            updated,
            "# Заголовок\n\nНовая строка\n\n- [ ] первая\n- [x] изменённая\n"
        );
    }

    #[test]
    fn a_stale_id_falls_back_to_the_line_hint() {
        let body = "- [ ] первая\n- [ ] вторая\n";
        let target = ids(body)[1].clone();
        let hash = target.split_once(':').unwrap().0;
        let stale = format!("{hash}:9");
        let updated = update(
            body,
            &Selector {
                task_id: Some(stale),
                line: Some(2),
            },
            "изменённая",
        )
        .unwrap();
        assert_eq!(updated, "- [ ] первая\n- [ ] изменённая\n");
    }

    #[test]
    fn a_text_selector_searches_the_whole_note() {
        let body = "- [ ] первая\n- [ ] вторая\n";
        let updated = update(
            body,
            &Selector {
                task_id: Some("вторая".to_owned()),
                line: Some(1),
            },
            "другая",
        )
        .unwrap();
        assert_eq!(updated, "- [ ] первая\n- [ ] другая\n");
    }

    #[test]
    fn duplicate_texts_get_distinct_ids_and_ambiguous_text_errors() {
        let body = "- [ ] одно\n- [ ] одно\n";
        let found = tasks_with_ids(body);
        assert_ne!(found[0].1, found[1].1);
        let updated = update(
            body,
            &Selector {
                task_id: Some(found[1].1.clone()),
                line: None,
            },
            "второе",
        )
        .unwrap();
        assert_eq!(updated, "- [ ] одно\n- [ ] второе\n");

        let error = update(
            body,
            &Selector {
                task_id: Some("одно".to_owned()),
                line: None,
            },
            "третье",
        )
        .unwrap_err();
        assert!(error.contains("Несколько задач"), "{error}");

        let error = update(
            body,
            &Selector {
                task_id: None,
                line: None,
            },
            "третье",
        )
        .unwrap_err();
        assert!(error.contains("taskId"), "{error}");
    }

    #[test]
    fn toggle_flips_only_the_checkbox() {
        let body = "# Список\n\n  1. [ ] вложенная\n- [/] в работе\n- [x] готово\n";
        let found = ids(body);
        let toggled = toggle(
            body,
            &Selector {
                task_id: Some(found[0].clone()),
                line: None,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            toggled,
            "# Список\n\n  1. [x] вложенная\n- [/] в работе\n- [x] готово\n"
        );
        let reopened = toggle(
            &toggled,
            &Selector {
                task_id: Some(found[2].clone()),
                line: None,
            },
            Some(false),
        )
        .unwrap();
        assert_eq!(
            reopened,
            "# Список\n\n  1. [x] вложенная\n- [/] в работе\n- [ ] готово\n"
        );
        let forced = toggle(
            body,
            &Selector {
                task_id: Some(found[1].clone()),
                line: None,
            },
            Some(true),
        )
        .unwrap();
        assert_eq!(
            forced,
            "# Список\n\n  1. [ ] вложенная\n- [x] в работе\n- [x] готово\n"
        );
    }

    #[test]
    fn delete_removes_the_line_and_keeps_neighbours() {
        let body = "# Заголовок\n\n- [ ] первая\n- [x] вторая\n\nКонец.\n";
        let target = ids(body)[0].clone();
        let removed = delete(
            body,
            &Selector {
                task_id: Some(target),
                line: None,
            },
        )
        .unwrap();
        assert_eq!(removed, "# Заголовок\n\n- [x] вторая\n\nКонец.\n");

        let last = delete(
            "- [ ] единственная\n",
            &Selector {
                task_id: None,
                line: Some(1),
            },
        )
        .unwrap();
        assert_eq!(last, "");
    }

    #[test]
    fn a_task_inside_a_fence_is_untouched() {
        let body = "```md\n- [ ] пример\n```\n- [ ] настоящая\n";
        let real = ids(body)[0].clone();
        let toggled = toggle(
            body,
            &Selector {
                task_id: Some(real),
                line: None,
            },
            Some(true),
        )
        .unwrap();
        assert_eq!(toggled, "```md\n- [ ] пример\n```\n- [x] настоящая\n");
        let error = update(
            body,
            &Selector {
                task_id: Some("пример".to_owned()),
                line: None,
            },
            "другое",
        )
        .unwrap_err();
        assert!(error.contains("не найдена"), "{error}");
    }

    #[test]
    fn create_appends_or_inserts_under_a_heading() {
        let body = "# Дела\n\n- [ ] старая\n\n## Идеи\n\nтекст\n";
        let (appended, line) = create(body, "новая", None).unwrap();
        assert_eq!(
            appended,
            "# Дела\n\n- [ ] старая\n\n## Идеи\n\nтекст\n- [ ] новая\n"
        );
        assert_eq!(line, 8);

        let (inserted, line) = create(body, "идея", Some("Идеи")).unwrap();
        assert_eq!(
            inserted,
            "# Дела\n\n- [ ] старая\n\n## Идеи\n- [ ] идея\n\nтекст\n"
        );
        assert_eq!(line, 6);

        let error = create(body, "идея", Some("Нет раздела")).unwrap_err();
        assert!(error.contains("Заголовок не найден"), "{error}");

        let (empty, line) = create("", "первая", None).unwrap();
        assert_eq!(empty, "- [ ] первая\n");
        assert_eq!(line, 1);

        let (no_newline, line) = create("- [ ] старая", "новая", None).unwrap();
        assert_eq!(no_newline, "- [ ] старая\n- [ ] новая\n");
        assert_eq!(line, 2);
    }

    #[test]
    fn update_keeps_indentation_and_the_list_marker() {
        let body = "\t1) [x]   старое\n";
        let target = ids(body)[0].clone();
        let updated = update(
            body,
            &Selector {
                task_id: Some(target),
                line: None,
            },
            "новое",
        )
        .unwrap();
        assert_eq!(updated, "\t1) [x]   новое\n");
    }

    #[test]
    fn a_crlf_note_is_normalized_before_editing() {
        let body = "- [ ] первая\r\n- [x] вторая\r\n";
        let target = ids(body)[1].clone();
        let updated = update(
            body,
            &Selector {
                task_id: Some(target),
                line: None,
            },
            "изменённая",
        )
        .unwrap();
        assert_eq!(updated, "- [ ] первая\n- [x] изменённая\n");
    }
}
