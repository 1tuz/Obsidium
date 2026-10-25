use super::edit::{self, Selector, Status};
use crate::files::document::{read_file_snapshot_impl, write_file_atomic_impl};
use crate::files::error::FileCommandError;
use std::path::Path;

pub fn update_task_status(
    path: &Path,
    task_id: &str,
    new_status: &str,
) -> Result<bool, FileCommandError> {
    let status = Status::parse(new_status).map_err(task_error)?;
    let snapshot = read_file_snapshot_impl(path)?;
    let selector = Selector {
        task_id: Some(task_id.to_owned()),
        line: None,
    };
    let next = edit::set_status(&snapshot.content, &selector, status).map_err(task_error)?;
    if next == snapshot.content {
        return Ok(false);
    }
    write_file_atomic_impl(path, &next, Some(&snapshot.hash))?;
    Ok(true)
}

fn task_error(message: String) -> FileCommandError {
    FileCommandError::Task { message }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn note_file(directory: &Path, body: &str) -> PathBuf {
        let path = directory.join("note.md");
        std::fs::write(&path, body).unwrap();
        path
    }

    fn bytes(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn only_the_marker_changes() {
        let directory = tempfile::tempdir().unwrap();
        let body = "# Заголовок\n\nАбзац с текстом.\n\n- [ ] первая\n- [ ] вторая\n\n```md\n- [ ] пример\n```\n\nКонец.\n";
        let path = note_file(directory.path(), body);
        let target = edit::tasks_with_ids(body)[1].1.clone();

        assert!(update_task_status(&path, &target, "doing").unwrap());
        assert_eq!(
            bytes(&path),
            "# Заголовок\n\nАбзац с текстом.\n\n- [ ] первая\n- [/] вторая\n\n```md\n- [ ] пример\n```\n\nКонец.\n"
        );
    }

    #[test]
    fn indentation_and_numbering_survive() {
        let directory = tempfile::tempdir().unwrap();
        let body = "# Дела\n\n  1) [ ] пункт\n\t- [x] вложенная\n";
        let path = note_file(directory.path(), body);
        let found = edit::tasks_with_ids(body);

        assert!(update_task_status(&path, &found[1].1, "doing").unwrap());
        assert_eq!(
            bytes(&path),
            "# Дела\n\n  1) [ ] пункт\n\t- [/] вложенная\n"
        );

        assert!(update_task_status(&path, &found[0].1, "done").unwrap());
        assert_eq!(
            bytes(&path),
            "# Дела\n\n  1) [x] пункт\n\t- [/] вложенная\n"
        );
    }

    #[test]
    fn the_same_status_is_a_no_op() {
        let directory = tempfile::tempdir().unwrap();
        let body = "- [ ] первая\n- [x] вторая\n";
        let path = note_file(directory.path(), body);
        let target = edit::tasks_with_ids(body)[0].1.clone();

        assert!(update_task_status(&path, &target, "done").unwrap());
        let untouched = bytes(&path);
        assert!(!update_task_status(&path, &target, "done").unwrap());
        assert_eq!(bytes(&path), untouched);
        assert_eq!(untouched, "- [x] первая\n- [x] вторая\n");
    }

    #[test]
    fn an_unknown_task_leaves_the_file_alone() {
        let directory = tempfile::tempdir().unwrap();
        let body = "- [ ] первая\n";
        let path = note_file(directory.path(), body);

        let error = update_task_status(&path, "нет такой задачи", "done").unwrap_err();
        assert!(error.to_string().contains("Задача не найдена"), "{error}");
        assert_eq!(bytes(&path), body);
    }

    #[test]
    fn an_unknown_status_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let body = "- [ ] первая\n";
        let path = note_file(directory.path(), body);
        let target = edit::tasks_with_ids(body)[0].1.clone();

        let error = update_task_status(&path, &target, "готово").unwrap_err();
        assert!(
            error.to_string().contains("допустимо todo, doing или done"),
            "{error}"
        );
        assert_eq!(bytes(&path), body);
    }

    #[test]
    fn crlf_line_endings_survive() {
        let directory = tempfile::tempdir().unwrap();
        let body = "- [ ] первая\r\n- [x] вторая\r\n";
        let path = note_file(directory.path(), body);
        let target = edit::tasks_with_ids(body)[1].1.clone();

        assert!(update_task_status(&path, &target, "doing").unwrap());
        assert_eq!(bytes(&path), "- [ ] первая\r\n- [/] вторая\r\n");
    }

    #[test]
    fn a_missing_file_reports_the_io_error() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("absent.md");

        let error = update_task_status(&path, "любая", "done").unwrap_err();
        assert!(matches!(error, FileCommandError::Io { .. }), "{error}");
    }
}
