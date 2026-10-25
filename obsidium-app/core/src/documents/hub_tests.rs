use super::*;
use crate::app_core::EventSink;
use crate::documents::resolve::SyncPointLookup;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Barrier};

fn note(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("obsidium-legacy-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("directory");
    let path = directory.join(format!("{name}.md"));
    std::fs::write(&path, "текст\n").expect("note");
    path
}

fn open_core() -> (tempfile::TempDir, Arc<Core>) {
    let directory = tempfile::tempdir().expect("directory");
    let core = Core::open(
        &directory.path().join("data"),
        Arc::new(|_: CoreEvent| {}) as Arc<dyn EventSink>,
    );
    (directory, core)
}

fn notes_in_distinct_shards(directory: &Path, count: usize) -> Vec<PathBuf> {
    assert!(count <= SHARDS);
    let mut chosen: Vec<Option<PathBuf>> = (0..SHARDS).map(|_| None).collect();
    let mut found = 0;
    for index in 0..10_000 {
        let path = directory.join(format!("заметка-{index}.md"));
        let slot = shard_of(&identity(&path));
        if chosen[slot].is_none() {
            chosen[slot] = Some(path);
            found += 1;
            if found == count {
                break;
            }
        }
    }
    assert_eq!(found, count, "не удалось разложить заметки по шардам");
    let notes: Vec<PathBuf> = chosen.into_iter().flatten().collect();
    for path in &notes {
        std::fs::write(path, "текст\n").expect("note");
    }
    notes
}

#[test]
fn opening_another_shard_does_not_wait_for_a_locked_shard() {
    let (directory, core) = open_core();
    let notes = notes_in_distinct_shards(directory.path(), 2);
    let locked = &notes[0];
    let other = &notes[1];
    let locked_shard = shard_of(&identity(locked));
    assert_ne!(locked_shard, shard_of(&identity(other)));

    let guard = core.documents.shards[locked_shard].lock().expect("shard");
    let (sender, receiver) = mpsc::channel();
    let worker = {
        let core = Arc::clone(&core);
        let path = other.clone();
        std::thread::spawn(move || {
            sender
                .send(core.documents.open(&core, &path, 0))
                .expect("send");
        })
    };

    let opened = receiver
        .recv_timeout(Duration::from_secs(10))
        .expect("открытие в другом шарде не должно ждать заблокированный шард")
        .expect("документ открылся");
    assert_eq!(opened.text, "текст\n");
    drop(guard);
    worker.join().expect("worker");
}

#[test]
fn closes_a_session_in_one_shard_without_touching_another() {
    let (directory, core) = open_core();
    let notes = notes_in_distinct_shards(directory.path(), 2);
    let kept = &notes[0];
    let closed = &notes[1];

    core.documents.open(&core, kept, 0).expect("kept");
    core.documents.open(&core, closed, 0).expect("closed");
    core.documents.release(&core, closed);

    assert_eq!(
        core.documents.read(&core, kept).expect("read").text,
        "текст\n"
    );
    let listed = core.documents.list();
    assert!(listed.contains(&kept.to_string_lossy().into_owned()));
    assert!(!listed.contains(&closed.to_string_lossy().into_owned()));
}

#[test]
fn lists_documents_from_every_shard() {
    let (directory, core) = open_core();
    let notes = notes_in_distinct_shards(directory.path(), SHARDS);
    for path in &notes {
        core.documents.open(&core, path, 0).expect("open");
    }

    let mut expected: Vec<String> = notes
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    expected.sort();
    assert_eq!(core.documents.list(), expected);

    let mut covered: Vec<usize> = notes.iter().map(|path| shard_of(&identity(path))).collect();
    covered.sort_unstable();
    assert_eq!(covered, (0..SHARDS).collect::<Vec<_>>());
}

#[test]
fn opens_documents_in_parallel_across_shards() {
    let (directory, core) = open_core();
    let notes = notes_in_distinct_shards(directory.path(), SHARDS);
    let barrier = Arc::new(Barrier::new(SHARDS));
    let opened = Arc::new(AtomicUsize::new(0));

    let workers: Vec<_> = notes
        .into_iter()
        .map(|path| {
            let core = Arc::clone(&core);
            let barrier = Arc::clone(&barrier);
            let opened = Arc::clone(&opened);
            std::thread::spawn(move || {
                barrier.wait();
                core.documents.open(&core, &path, 0).expect("open");
                opened.fetch_add(1, Ordering::SeqCst);
            })
        })
        .collect();

    for worker in workers {
        worker.join().expect("worker");
    }
    assert_eq!(opened.load(Ordering::SeqCst), SHARDS);
    assert_eq!(core.documents.list().len(), SHARDS);
}

#[test]
fn keeps_a_key_on_a_stable_shard() {
    let key = identity(Path::new("/notes/Заметка.md"));
    assert_eq!(shard_of(&key), shard_of(key.as_str()));
    assert!(shard_of(&key) < SHARDS);
}

#[test]
fn spreads_similar_paths_over_every_shard() {
    let mut covered = std::collections::BTreeSet::new();
    for index in 0..256 {
        let key = identity(Path::new(&format!("/база/заметка-{index}.md")));
        covered.insert(shard_of(&key));
    }
    assert_eq!(covered.len(), SHARDS);
}

#[test]
fn moves_an_open_document_between_shards() {
    let (directory, core) = open_core();
    let notes = notes_in_distinct_shards(directory.path(), 1);
    let from = &notes[0];
    let to = (0..10_000)
        .map(|index| directory.path().join(format!("перенесённая-{index}.md")))
        .find(|path| shard_of(&identity(path)) != shard_of(&identity(from)))
        .expect("шард для нового пути");

    core.documents.open(&core, from, 0).expect("open");
    std::fs::rename(from, &to).expect("rename");
    core.documents.relocated(
        &[(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )],
        &[],
    );

    let listed = core.documents.list();
    assert!(!listed.contains(&from.to_string_lossy().into_owned()));
    assert!(listed.contains(&to.to_string_lossy().into_owned()));
    assert_eq!(
        core.documents.read(&core, &to).expect("read").text,
        "текст\n"
    );
}

fn replica(path: &Path, point: Option<LegacyPoint>) -> LegacyReplica {
    LegacyReplica {
        path: path.to_string_lossy().into_owned(),
        updates: vec![b"update".to_vec()],
        point,
    }
}

#[test]
fn moves_a_legacy_replica_with_its_sync_point_into_the_store() {
    let store = DocumentStore::memory().expect("store");
    let path = note("moved");
    let point = LegacyPoint {
        file_hash: "f".into(),
        text_hash: "t".into(),
    };
    assert!(import_one(&store, &replica(&path, Some(point))));
    let key = identity(&path);
    assert_eq!(store.load(&key).expect("load"), vec![b"update".to_vec()]);
    assert_eq!(
        store.sync_point(&key),
        SyncPointLookup::Found(SyncPoint {
            file_hash: "f".into(),
            text_hash: "t".into()
        }),
    );
}

#[test]
fn never_overrides_a_replica_the_core_already_keeps() {
    let mut store = DocumentStore::memory().expect("store");
    let path = note("kept");
    store
        .compact(&identity(&path), b"current")
        .expect("compact");
    assert!(!import_one(&store, &replica(&path, None)));
    assert_eq!(
        store.load(&identity(&path)).expect("load"),
        vec![b"current".to_vec()]
    );
}

#[test]
fn skips_a_note_that_no_longer_exists() {
    let store = DocumentStore::memory().expect("store");
    let path = note("gone");
    std::fs::remove_file(&path).expect("remove");
    assert!(!import_one(&store, &replica(&path, None)));
    assert!(!store.has_replica(&identity(&path)).expect("query"));
}
