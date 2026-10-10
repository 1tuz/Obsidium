use super::error::SearchError;
use super::paths::{identity, markdown_files};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const STORE_VERSION: u32 = 2;
const MODEL_RETRY_INTERVAL: Duration = Duration::from_secs(300);
const DOCUMENT_CHAR_LIMIT: usize = 8_000;
const EMBED_BATCH: usize = 32;

#[derive(Clone, Debug)]
pub struct SemanticHit {
    pub path: String,
    pub score: f32,
}

#[derive(Default)]
pub struct SemanticSearch {
    base_directory: PathBuf,
    stores: Mutex<HashMap<String, LoadedStore>>,
    model: Mutex<ModelState>,
}

#[derive(Default)]
enum ModelState {
    #[default]
    Empty,
    Ready(TextEmbedding),
    Failed {
        at: Option<Instant>,
        message: String,
    },
}

#[derive(Default)]
struct LoadedStore {
    data: SemanticStore,
    indexed_revision: Option<u64>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticStore {
    version: u32,
    model: String,
    documents: Vec<SemanticDocument>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticDocument {
    path: String,
    modified_ms: u64,
    size: u64,
    vector: Vec<i8>,
}

impl SemanticSearch {
    pub fn new(base_directory: PathBuf) -> Self {
        Self {
            base_directory,
            stores: Mutex::new(HashMap::new()),
            model: Mutex::new(ModelState::Empty),
        }
    }

    pub fn search(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
        index_revision: u64,
    ) -> Result<Vec<SemanticHit>, SearchError> {
        if query.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        {
            let model = self.model.lock().map_err(SearchError::task)?;
            if let ModelState::Failed {
                at: Some(at),
                message,
            } = &*model
            {
                if at.elapsed() < MODEL_RETRY_INTERVAL {
                    return Err(SearchError::task(message));
                }
            }
        }
        let key = identity(root);
        let storage = self.storage(root);
        let mut stores = self.stores.lock().map_err(SearchError::task)?;
        let loaded = stores.entry(key).or_insert_with(|| LoadedStore {
            data: load_store(&storage),
            indexed_revision: None,
        });
        if needs_refresh(loaded.indexed_revision, index_revision) {
            if let Err(error) = self.refresh(root, &storage, &mut loaded.data) {
                loaded.data = load_store(&storage);
                return Err(error);
            }
            loaded.indexed_revision = Some(index_revision);
        }
        if loaded.data.documents.is_empty() {
            return Ok(Vec::new());
        }

        let query_embedding = self
            .embed(vec![format!("query: {}", query.trim())])?
            .into_iter()
            .next()
            .ok_or_else(|| SearchError::task("embedding model returned no query vector"))?;
        let query_vector = quantize(&query_embedding);
        let mut scored = loaded
            .data
            .documents
            .iter()
            .filter_map(|document| {
                let score = cosine(&query_vector, &document.vector);
                score.is_finite().then(|| SemanticHit {
                    path: document.path.clone(),
                    score,
                })
            })
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.path.cmp(&right.path))
        });
        scored.truncate(limit);
        Ok(scored)
    }

    fn refresh(
        &self,
        root: &Path,
        storage: &Path,
        store: &mut SemanticStore,
    ) -> Result<(), SearchError> {
        let mut existing = store
            .documents
            .drain(..)
            .map(|document| (identity(Path::new(&document.path)), document))
            .collect::<HashMap<_, _>>();
        let mut retained = Vec::new();
        let mut pending = Vec::new();
        let mut seen = HashSet::new();

        for path in markdown_files(root) {
            let Ok(metadata) = path.metadata() else {
                continue;
            };
            let path_string = path.to_string_lossy().into_owned();
            let path_key = identity(&path);
            seen.insert(path_key.clone());
            let modified_ms = modified_ms(&metadata);
            let size = metadata.len();
            if let Some(document) = existing.remove(&path_key) {
                if document.modified_ms == modified_ms && document.size == size {
                    retained.push(document);
                    continue;
                }
            }
            pending.push((path_string, modified_ms, size));
        }

        for batch in pending.chunks(EMBED_BATCH) {
            let mut documents = Vec::with_capacity(batch.len());
            let inputs = batch
                .iter()
                .filter_map(|(path, modified_ms, size)| {
                    let file = Path::new(path);
                    let body = crate::files::document::read_text(file).ok()?;
                    let title = file
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default();
                    documents.push((path.clone(), *modified_ms, *size));
                    Some(format!("passage: {}", semantic_text(title, &body)))
                })
                .collect::<Vec<_>>();
            if inputs.is_empty() {
                continue;
            }
            let embeddings = self.embed(inputs)?;
            if embeddings.len() != documents.len() {
                return Err(SearchError::task("embedding batch size mismatch"));
            }
            retained.extend(documents.into_iter().zip(embeddings).map(
                |((path, modified_ms, size), vector)| SemanticDocument {
                    path,
                    modified_ms,
                    size,
                    vector: quantize(&vector),
                },
            ));
        }

        retained.retain(|document| seen.contains(&identity(Path::new(&document.path))));
        retained.sort_by(|left, right| left.path.cmp(&right.path));
        store.version = STORE_VERSION;
        store.model = model_name().to_owned();
        store.documents = retained;
        save_store(storage, store)?;
        Ok(())
    }

    fn embed(&self, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, SearchError> {
        let mut state = self.model.lock().map_err(SearchError::task)?;
        if let ModelState::Failed {
            at: Some(at),
            message,
        } = &*state
        {
            if at.elapsed() < MODEL_RETRY_INTERVAL {
                return Err(SearchError::task(message));
            }
        }
        if !matches!(*state, ModelState::Ready(_)) {
            let options = TextInitOptions::new(EmbeddingModel::ParaphraseMLMiniLML12V2Q)
                .with_cache_dir(self.base_directory.join("models"))
                .with_show_download_progress(false)
                .with_intra_threads(
                    std::thread::available_parallelism()
                        .map(|value| value.get())
                        .unwrap_or(2)
                        .clamp(1, 4),
                );
            match TextEmbedding::try_new(options) {
                Ok(model) => *state = ModelState::Ready(model),
                Err(error) => {
                    let message = format!("semantic model unavailable: {error}");
                    *state = ModelState::Failed {
                        at: Some(Instant::now()),
                        message: message.clone(),
                    };
                    return Err(SearchError::task(message));
                }
            }
        }
        match &mut *state {
            ModelState::Ready(model) => model
                .embed(inputs, Some(EMBED_BATCH))
                .map_err(|error| SearchError::task(format!("semantic embedding failed: {error}"))),
            ModelState::Failed { message, .. } => Err(SearchError::task(message)),
            ModelState::Empty => Err(SearchError::task("semantic model is not initialized")),
        }
    }

    fn storage(&self, root: &Path) -> PathBuf {
        let key = blake3::hash(root.to_string_lossy().as_bytes()).to_hex();
        self.base_directory
            .join(key.as_str())
            .join(format!("semantic-v{STORE_VERSION}.json"))
    }
}

fn needs_refresh(indexed_revision: Option<u64>, current_revision: u64) -> bool {
    indexed_revision != Some(current_revision)
}

fn model_name() -> &'static str {
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2-quantized"
}

fn semantic_text(title: &str, body: &str) -> String {
    let body = body.chars().take(DOCUMENT_CHAR_LIMIT).collect::<String>();
    if title.is_empty() {
        body
    } else {
        format!("{title}\n{body}")
    }
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u64::MAX as u128) as u64
        })
}

fn load_store(path: &Path) -> SemanticStore {
    let Ok(content) = fs::read_to_string(path) else {
        return SemanticStore::default();
    };
    let Ok(store) = serde_json::from_str::<SemanticStore>(&content) else {
        return SemanticStore::default();
    };
    if store.version != STORE_VERSION || store.model != model_name() {
        SemanticStore::default()
    } else {
        store
    }
}

fn save_store(path: &Path, store: &SemanticStore) -> Result<(), SearchError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec(store).map_err(SearchError::task)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, json)?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(_error) if path.exists() => {
            fs::remove_file(path)?;
            fs::rename(temporary, path)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn quantize(vector: &[f32]) -> Vec<i8> {
    let scale = vector
        .iter()
        .filter(|value| value.is_finite())
        .map(|value| value.abs())
        .fold(0.0f32, f32::max);
    if scale <= f32::EPSILON {
        return vec![0; vector.len()];
    }
    vector
        .iter()
        .map(|value| {
            if value.is_finite() {
                (value / scale * i8::MAX as f32).round() as i8
            } else {
                0
            }
        })
        .collect()
}

pub(crate) fn cosine(left: &[i8], right: &[i8]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    let mut dot = 0i64;
    let mut left_norm = 0i64;
    let mut right_norm = 0i64;
    for (&a, &b) in left.iter().zip(right) {
        dot += a as i64 * b as i64;
        left_norm += a as i64 * a as i64;
        right_norm += b as i64 * b as i64;
    }
    let denominator = (left_norm as f32).sqrt() * (right_norm as f32).sqrt();
    if denominator <= f32::EPSILON {
        0.0
    } else {
        dot as f32 / denominator
    }
}

#[cfg(test)]
mod tests {
    use super::{cosine, needs_refresh, quantize, semantic_text};

    #[test]
    fn cosine_orders_close_vectors_above_orthogonal_vectors() {
        let query = quantize(&[1.0, 0.8, 0.0]);
        assert!(
            cosine(&query, &quantize(&[1.0, 0.7, 0.1]))
                > cosine(&query, &quantize(&[0.0, 0.0, 1.0]))
        );
    }

    #[test]
    fn quantized_vectors_use_one_byte_per_dimension() {
        let source = [0.1, -0.2, 0.7, 0.0];
        let vector = quantize(&source);

        assert_eq!(vector.len(), source.len());
        assert!(std::mem::size_of_val(vector.as_slice()) < std::mem::size_of_val(&source));
    }

    #[test]
    fn semantic_text_keeps_title_and_caps_large_bodies() {
        let body = "x".repeat(20_000);
        let text = semantic_text("Title", &body);
        assert!(text.starts_with("Title\n"));
        assert!(text.chars().count() <= 8_006);
    }

    #[test]
    fn semantic_store_refreshes_only_for_a_new_index_revision() {
        assert!(needs_refresh(None, 0));
        assert!(!needs_refresh(Some(3), 3));
        assert!(needs_refresh(Some(3), 4));
    }
}
