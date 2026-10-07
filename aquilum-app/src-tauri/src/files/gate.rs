use super::attachments::forget_attachments_if_touched;
use super::deletions::deletion_files;
use super::document::{
    copy_file_impl, create_binary_file_impl, create_file_impl, rename_file_impl,
    write_file_atomic_impl,
};
use super::error::FileCommandError;
use super::models::{FileRenameResult, FileWriteResult};
use super::rename::rename_with_links;
use super::trash::{move_to_trash_impl, restore_from_trash_impl};
use crate::documents::DocumentHub;
use crate::history::{HistoryService, NoteWrite, Source};
use crate::search::paths::is_markdown;
use crate::search::SearchService;
use crate::ui_state::UiStateService;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const NOTES_RELOCATED_EVENT: &str = "notes-relocated";
const NOTE_HISTORY_EVENT: &str = "note-history-changed";

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Relocation {
    moves: Vec<NoteMove>,
    removed: Vec<String>,
}

#[derive(Clone, Serialize)]
struct NoteHistoryChanged {
    path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NoteMove {
    from: String,
    to: String,
}

pub(crate) fn write(
    app: &AppHandle,
    path: &Path,
    content: &str,
    expected_hash: Option<&str>,
    source: Source,
    version_name: Option<&str>,
) -> Result<FileWriteResult, FileCommandError> {
    let history = history(app);
    let before = history.disk_before(path, expected_hash);
    let result = write_file_atomic_impl(path, content, expected_hash)?;
    let write = NoteWrite { disk_before: before, text: content, hash: &result.hash, source, name: version_name };
    if history.saved(&|| known_roots(app), path, write) {
        announce_history(app, path);
    }
    search(app).notify_content_path(path.to_path_buf());
    Ok(result)
}

pub(crate) fn create(
    app: &AppHandle,
    path: &Path,
    content: &str,
    source: Source,
    version_name: Option<&str>,
) -> Result<FileWriteResult, FileCommandError> {
    let result = create_file_impl(path, content)?;
    if is_markdown(path) {
        let write = NoteWrite {
            disk_before: Some((String::new(), SystemTime::now())),
            text: content,
            hash: &result.hash,
            source,
            name: version_name,
        };
        if history(app).saved(&|| known_roots(app), path, write) {
            announce_history(app, path);
        }
    }
    paths_changed(app, vec![path.to_path_buf()]);
    Ok(result)
}

pub(crate) fn create_binary(
    app: &AppHandle,
    path: &Path,
    bytes: &[u8],
) -> Result<FileWriteResult, FileCommandError> {
    let result = create_binary_file_impl(path, bytes)?;
    paths_changed(app, vec![path.to_path_buf()]);
    Ok(result)
}

pub(crate) fn copy(app: &AppHandle, from: &Path, to: &Path) -> Result<(), FileCommandError> {
    copy_file_impl(from, to)?;
    paths_changed(app, vec![to.to_path_buf()]);
    Ok(())
}

pub(crate) fn rename(
    app: &AppHandle,
    from: &Path,
    to: &Path,
) -> Result<FileRenameResult, FileCommandError> {
    app.state::<DocumentHub>().moving(app, from, || rename_now(app, from, to))
}

fn rename_now(app: &AppHandle, from: &Path, to: &Path) -> Result<FileRenameResult, FileCommandError> {
    let notes = notes_under(from);
    let renamed = rename_with_links(&search(app), from, to)?;
    let relocation = relocated(&notes, from, to);
    follow_moves(app, &relocation);
    let history = history(app);
    for rewrite in &renamed.rewritten {
        let write = NoteWrite {
            disk_before: Some((rewrite.before.clone(), SystemTime::now())),
            text: &rewrite.after,
            hash: &rewrite.hash,
            source: Source::Links,
            name: None,
        };
        if history.saved(&|| known_roots(app), &rewrite.path, write) {
            announce_history(app, &rewrite.path);
        }
    }
    let mut changed = vec![from.to_path_buf(), to.to_path_buf()];
    changed.extend(renamed.result.updated_paths.iter().map(PathBuf::from));
    let rewritten: Vec<PathBuf> = renamed.result.updated_paths.iter().map(PathBuf::from).collect();
    paths_changed(app, changed);
    announce(app, relocation);
    app.state::<DocumentHub>().reconcile_paths(app, &rewritten);
    Ok(renamed.result)
}

pub(crate) fn move_across(app: &AppHandle, from: &Path, to: &Path) -> Result<(), FileCommandError> {
    app.state::<DocumentHub>().moving(app, from, || move_across_now(app, from, to))
}

fn move_across_now(app: &AppHandle, from: &Path, to: &Path) -> Result<(), FileCommandError> {
    let notes = notes_under(from);
    rename_file_impl(from, to)?;
    let relocation = relocated(&notes, from, to);
    follow_moves(app, &relocation);
    paths_changed(app, vec![from.to_path_buf(), to.to_path_buf()]);
    announce(app, relocation);
    Ok(())
}

pub(crate) fn trash(
    app: &AppHandle,
    workspace: &Path,
    path: &Path,
) -> Result<PathBuf, FileCommandError> {
    app.state::<DocumentHub>().moving(app, path, || trash_now(app, workspace, path))
}

fn trash_now(app: &AppHandle, workspace: &Path, path: &Path) -> Result<PathBuf, FileCommandError> {
    let moved = move_to_trash_impl(workspace, path)?;
    let notes = markdown_moves(&moved.files);
    let history = history(app);
    for (note, trashed_at) in &notes {
        history.trashed(&|| known_roots(app), note, trashed_at);
    }
    paths_changed(app, vec![path.to_path_buf(), moved.root.clone()]);
    announce(app, removed(notes.iter().map(|(note, _)| note)));
    Ok(moved.root)
}

pub(crate) fn restore(
    app: &AppHandle,
    workspace: &Path,
    trashed: &Path,
) -> Result<PathBuf, FileCommandError> {
    let mut roots = restore_all(app, workspace, &[trashed.to_path_buf()])?;
    Ok(roots.remove(0))
}

pub(crate) fn restore_deletion(
    app: &AppHandle,
    workspace: &Path,
    id: &str,
) -> Result<(), FileCommandError> {
    restore_all(app, workspace, &deletion_files(workspace, id)).map(|_| ())
}

fn restore_all(
    app: &AppHandle,
    workspace: &Path,
    trashed: &[PathBuf],
) -> Result<Vec<PathBuf>, FileCommandError> {
    let history = history(app);
    let mut roots = Vec::new();
    let mut failure = None;
    for path in trashed {
        match restore_from_trash_impl(workspace, path) {
            Ok(restored) => {
                for (trashed_note, back) in markdown_moves(&restored.files) {
                    history.restored(&|| known_roots(app), &trashed_note, &back);
                }
                roots.push(restored.root);
            }
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
    }
    paths_changed(app, trashed.iter().chain(&roots).cloned().collect());
    failure.map_or(Ok(roots), Err)
}

pub(crate) fn name_version(
    app: &AppHandle,
    path: &Path,
    version: Option<&str>,
    name: &str,
) -> Option<String> {
    let named = history(app).name(&|| known_roots(app), path, version, name);
    if named.is_some() {
        announce_history(app, path);
    }
    named
}

fn paths_changed(app: &AppHandle, paths: Vec<PathBuf>) {
    forget_attachments_if_touched(&paths);
    search(app).notify_paths(paths);
}

fn search(app: &AppHandle) -> tauri::State<'_, SearchService> {
    app.state::<SearchService>()
}

fn history(app: &AppHandle) -> tauri::State<'_, HistoryService> {
    app.state::<HistoryService>()
}

pub(crate) fn known_roots(app: &AppHandle) -> Vec<PathBuf> {
    app.state::<UiStateService>()
        .workspace_roots()
        .unwrap_or_default()
}

fn follow_moves(app: &AppHandle, relocation: &Relocation) {
    let history = history(app);
    for step in &relocation.moves {
        history.moved(&|| known_roots(app), Path::new(&step.from), Path::new(&step.to));
    }
}

fn markdown_moves(files: &[(PathBuf, PathBuf)]) -> Vec<(PathBuf, PathBuf)> {
    files
        .iter()
        .filter(|(from, _)| is_markdown(from))
        .cloned()
        .collect()
}

fn announce(app: &AppHandle, relocation: Relocation) {
    if relocation.moves.is_empty() && relocation.removed.is_empty() {
        return;
    }
    let moves: Vec<(String, String)> =
        relocation.moves.iter().map(|step| (step.from.clone(), step.to.clone())).collect();
    app.state::<DocumentHub>().relocated(&moves, &relocation.removed);
    if let Err(error) = app.emit(NOTES_RELOCATED_EVENT, relocation) {
        eprintln!("[aquilum:gate] событие о переносе заметок не отправлено: {error}");
    }
}

fn announce_history(app: &AppHandle, note: &Path) {
    let changed = NoteHistoryChanged {
        path: note.to_string_lossy().into_owned(),
    };
    if let Err(error) = app.emit(NOTE_HISTORY_EVENT, changed) {
        eprintln!("[aquilum:gate] событие об истории заметки не отправлено: {error}");
    }
}

fn notes_under(path: &Path) -> Vec<PathBuf> {
    WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_markdown(entry.path()))
        .map(|entry| entry.into_path())
        .collect()
}

fn relocated(notes: &[PathBuf], from: &Path, to: &Path) -> Relocation {
    let moves = notes
        .iter()
        .filter_map(|note| {
            let inside = note.strip_prefix(from).ok()?;
            let target = if inside.as_os_str().is_empty() {
                to.to_path_buf()
            } else {
                to.join(inside)
            };
            Some(NoteMove {
                from: note.to_string_lossy().into_owned(),
                to: target.to_string_lossy().into_owned(),
            })
        })
        .collect();
    Relocation {
        moves,
        removed: Vec::new(),
    }
}

fn removed<'a>(notes: impl Iterator<Item = &'a PathBuf>) -> Relocation {
    Relocation {
        moves: Vec::new(),
        removed: notes.map(|note| note.to_string_lossy().into_owned()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::{notes_under, relocated, removed, NoteMove};
    use std::fs;

    #[test]
    fn a_note_moves_as_itself() {
        let directory = tempfile::tempdir().unwrap();
        let note = directory.path().join("Идея.md");
        fs::write(&note, "текст").unwrap();
        let target = directory.path().join("Проекты").join("Идея.md");

        let relocation = relocated(&notes_under(&note), &note, &target);

        assert_eq!(
            relocation.moves,
            vec![NoteMove {
                from: note.to_string_lossy().into_owned(),
                to: target.to_string_lossy().into_owned(),
            }]
        );
    }

    #[test]
    fn a_folder_moves_as_every_note_inside_it() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("Проекты");
        fs::create_dir_all(folder.join("Глубже")).unwrap();
        fs::write(folder.join("А.md"), "").unwrap();
        fs::write(folder.join("Глубже").join("Б.md"), "").unwrap();
        fs::write(folder.join("картинка.png"), "").unwrap();
        let target = directory.path().join("Архив");

        let mut relocation = relocated(&notes_under(&folder), &folder, &target);
        relocation.moves.sort_by(|left, right| left.from.cmp(&right.from));

        let targets = relocation
            .moves
            .iter()
            .map(|entry| entry.to.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            targets,
            vec![
                target.join("А.md").to_string_lossy().into_owned(),
                target.join("Глубже").join("Б.md").to_string_lossy().into_owned(),
            ],
            "только заметки, вложенность сохраняется"
        );
    }

    #[test]
    fn a_deleted_folder_reports_the_notes_it_held() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("Старое");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("А.md"), "").unwrap();

        let relocation = removed(notes_under(&folder).iter());

        assert_eq!(relocation.removed, vec![folder.join("А.md").to_string_lossy().into_owned()]);
        assert!(relocation.moves.is_empty());
    }
}
