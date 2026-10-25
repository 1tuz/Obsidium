use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

const CACHE_BUDGET: usize = 8 * 1024 * 1024;
const FILE_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
}

impl Stamp {
    fn of(path: &Path) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        if !metadata.is_file() {
            return None;
        }
        Some(Self {
            modified: metadata.modified().ok(),
            len: metadata.len(),
        })
    }
}

struct Entry {
    stamp: Stamp,
    tick: u64,
    text: Arc<str>,
}

#[derive(Default)]
struct State {
    entries: HashMap<PathBuf, Entry>,
    bytes: usize,
    tick: u64,
}

pub struct ContentCache {
    state: Mutex<State>,
}

impl Default for ContentCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ContentCache {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
        }
    }

    pub fn read(&self, path: &Path) -> Option<Arc<str>> {
        let stamp = Stamp::of(path)?;
        if let Some(text) = self.fresh(path, stamp) {
            return Some(text);
        }
        if stamp.len > FILE_LIMIT {
            return None;
        }
        let text = crate::files::document::read_text(path).ok()?;
        if text.len() as u64 > FILE_LIMIT {
            return None;
        }
        let text: Arc<str> = Arc::from(text);
        let mut state = self.state.lock().ok()?;
        state.tick = state.tick.saturating_add(1);
        let tick = state.tick;
        if let Some(previous) = state.entries.remove(path) {
            state.bytes = state.bytes.saturating_sub(previous.text.len());
        }
        if text.len() <= CACHE_BUDGET {
            state.bytes = state.bytes.saturating_add(text.len());
            state.entries.insert(
                path.to_path_buf(),
                Entry {
                    stamp,
                    tick,
                    text: Arc::clone(&text),
                },
            );
            evict(&mut state);
        }
        Some(text)
    }

    fn fresh(&self, path: &Path, stamp: Stamp) -> Option<Arc<str>> {
        let mut state = self.state.lock().ok()?;
        state.tick = state.tick.saturating_add(1);
        let tick = state.tick;
        let text = state
            .entries
            .get_mut(path)
            .filter(|entry| entry.stamp == stamp)
            .map(|entry| {
                entry.tick = tick;
                Arc::clone(&entry.text)
            });
        if text.is_none() {
            if let Some(evicted) = state.entries.remove(path) {
                state.bytes = state.bytes.saturating_sub(evicted.text.len());
            }
        }
        text
    }

    #[cfg(test)]
    pub(crate) fn tracked_bytes(&self) -> usize {
        self.state.lock().map(|state| state.bytes).unwrap_or(0)
    }
}

fn evict(state: &mut State) {
    while state.bytes > CACHE_BUDGET {
        let Some(oldest) = state
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.tick)
            .map(|(path, _)| path.clone())
        else {
            break;
        };
        if let Some(entry) = state.entries.remove(&oldest) {
            state.bytes = state.bytes.saturating_sub(entry.text.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ContentCache, CACHE_BUDGET, FILE_LIMIT};
    use std::fs;
    use std::time::{Duration, SystemTime};

    #[test]
    fn a_missing_file_reads_as_none() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ContentCache::new();
        assert!(cache.read(&directory.path().join("absent.md")).is_none());
    }

    #[test]
    fn a_directory_reads_as_none() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ContentCache::new();
        assert!(cache.read(directory.path()).is_none());
    }

    #[test]
    fn a_repeated_read_hits_the_cache_and_keeps_the_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, "первая версия").unwrap();
        let cache = ContentCache::new();
        let first = cache.read(&path).unwrap();
        let second = cache.read(&path).unwrap();
        assert_eq!(&*first, "первая версия");
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert_eq!(cache.tracked_bytes(), first.len());
    }

    #[test]
    fn a_changed_size_invalidates_the_entry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, "короткая").unwrap();
        let cache = ContentCache::new();
        assert_eq!(&*cache.read(&path).unwrap(), "короткая");
        fs::write(&path, "значительно более длинная версия текста").unwrap();
        assert_eq!(
            &*cache.read(&path).unwrap(),
            "значительно более длинная версия текста"
        );
    }

    #[test]
    fn a_changed_timestamp_with_the_same_size_invalidates_the_entry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, "aaaa").unwrap();
        let cache = ContentCache::new();
        assert_eq!(&*cache.read(&path).unwrap(), "aaaa");
        fs::write(&path, "bbbb").unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(30))
            .unwrap();
        drop(file);
        assert_eq!(&*cache.read(&path).unwrap(), "bbbb");
    }

    #[test]
    fn a_file_above_the_limit_is_not_cached() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("big.md");
        fs::write(&path, "x".repeat(FILE_LIMIT as usize + 1)).unwrap();
        let cache = ContentCache::new();
        assert!(cache.read(&path).is_none());
        assert_eq!(cache.tracked_bytes(), 0);
    }

    #[test]
    fn the_cache_stays_within_its_byte_budget_and_keeps_the_latest_file() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ContentCache::new();
        let chunk = "y".repeat(1024 * 1024);
        let mut paths = Vec::new();
        for offset in 0..(CACHE_BUDGET / chunk.len() + 4) {
            let path = directory.path().join(format!("note-{offset}.md"));
            fs::write(&path, &chunk).unwrap();
            cache.read(&path);
            paths.push(path);
        }
        assert!(cache.tracked_bytes() <= CACHE_BUDGET);
        assert!(cache.read(paths.last().unwrap()).is_some());
    }
}
