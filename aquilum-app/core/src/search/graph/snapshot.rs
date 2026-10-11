use super::cluster;
use super::layout;
use super::model::GraphModel;
use super::rank;
use crate::search::error::SearchError;
use crate::search::wiki;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

const NANOS_PER_DAY: f64 = 86_400_000_000_000.0;
pub struct RenderSnapshot {
    pub paths: Vec<String>,
    pub node_ids: Vec<u64>,
    pub cluster_ids: Vec<u32>,
    pub positions: Vec<f32>,
    pub created_days: Vec<f32>,
    pub modified_days: Vec<f32>,
    pub degrees: Vec<u32>,
    pub edges: Vec<u32>,
    pub edge_directions: Vec<u32>,
    pub edge_types: Vec<u32>,
}

struct NodeRow {
    path: String,
    relative_key: String,
    title_key: String,
    created_ns: i64,
    modified_ns: i64,
}

impl RenderSnapshot {
    pub fn build(connection: &Connection, root: &Path) -> Result<Self, SearchError> {
        Self::build_with_layout(
            connection,
            root,
            &HashMap::new(),
            layout::Options::default(),
        )
    }

    pub fn build_with_layout(
        connection: &Connection,
        root: &Path,
        cached_positions: &HashMap<String, (f32, f32)>,
        options: layout::Options,
    ) -> Result<Self, SearchError> {
        let nodes = read_nodes(connection)?;
        let typed_edges = read_directed_edges(connection, root, &nodes)?;
        Self::build_from_parts(nodes, typed_edges, cached_positions, options)
    }

    pub fn build_from_model(
        model: &GraphModel,
        cached_positions: &HashMap<String, (f32, f32)>,
        options: layout::Options,
    ) -> Result<Self, SearchError> {
        let nodes = model
            .notes
            .values()
            .map(|note| NodeRow {
                path: note.path.clone(),
                relative_key: note.relative_key.clone(),
                title_key: note.title_key.clone(),
                created_ns: note.created_ns,
                modified_ns: note.modified_ns,
            })
            .collect::<Vec<_>>();
        let identity_of_path = nodes
            .iter()
            .enumerate()
            .map(|(identity, node)| (node.path.as_str(), identity as u32))
            .collect::<HashMap<_, _>>();
        let mut typed_edges = Vec::new();
        model.for_each_directed_edge(|source, target, link_type| {
            if let (Some(source), Some(target)) =
                (identity_of_path.get(source), identity_of_path.get(target))
            {
                typed_edges.push((*source, *target, link_type));
            }
        });
        Self::build_from_parts(nodes, typed_edges, cached_positions, options)
    }

    fn build_from_parts(
        nodes: Vec<NodeRow>,
        typed_edges: Vec<(u32, u32, u32)>,
        cached_positions: &HashMap<String, (f32, f32)>,
        options: layout::Options,
    ) -> Result<Self, SearchError> {
        let directed = typed_edges
            .iter()
            .map(|(source, target, _)| (*source, *target))
            .collect::<Vec<_>>();
        let links = rank::out_links(nodes.len(), &directed);
        let ranks = rank::pagerank(nodes.len(), &links);
        let render_of_identity = render_order(&ranks);
        let cluster_edges = typed_edges
            .iter()
            .map(|(source, target, _)| ((*source).min(*target), (*source).max(*target)))
            .collect::<Vec<_>>();
        let identity_clusters = cluster::louvain(nodes.len(), &cluster_edges, 1.0);
        let (edges, edge_directions, edge_types) = ordered_edges(&typed_edges, &render_of_identity);
        let degrees = degrees(nodes.len(), &edges);
        let identity_paths = nodes
            .iter()
            .map(|node| node.path.clone())
            .collect::<Vec<_>>();
        let identity_positions = layout::compute_incremental_with_options(
            &identity_paths,
            &cluster_edges
                .iter()
                .flat_map(|(left, right)| [*left, *right])
                .collect::<Vec<_>>(),
            options,
            cached_positions,
        );
        let mut positions = vec![0.0f32; nodes.len() * 2];
        for identity in 0..nodes.len() {
            let slot = render_of_identity[identity] as usize;
            positions[slot * 2] = identity_positions[identity * 2];
            positions[slot * 2 + 1] = identity_positions[identity * 2 + 1];
        }

        let mut paths = vec![String::new(); nodes.len()];
        let mut node_ids = vec![0u64; nodes.len()];
        let mut cluster_ids = vec![0u32; nodes.len()];
        let mut created_days = vec![f32::NAN; nodes.len()];
        let mut modified_days = vec![f32::NAN; nodes.len()];
        for (identity, node) in nodes.into_iter().enumerate() {
            let slot = render_of_identity[identity] as usize;
            created_days[slot] = days(node.created_ns);
            modified_days[slot] = days(node.modified_ns);
            node_ids[slot] = stable_node_id(&node.path);
            cluster_ids[slot] = identity_clusters[identity];
            paths[slot] = node.path;
        }

        Ok(Self {
            paths,
            node_ids,
            cluster_ids,
            positions,
            created_days,
            modified_days,
            degrees,
            edges,
            edge_directions,
            edge_types,
        })
    }

    pub fn node_count(&self) -> usize {
        self.paths.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len() / 2
    }
}

fn stable_node_id(path: &str) -> u64 {
    path.bytes().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

pub fn paths_at(paths: &[String], indices: &[u32]) -> Vec<String> {
    indices
        .iter()
        .map(|index| paths.get(*index as usize).cloned().unwrap_or_default())
        .collect()
}

fn read_nodes(connection: &Connection) -> Result<Vec<NodeRow>, SearchError> {
    let mut statement = connection.prepare(
        "SELECT wiki_documents.path, wiki_documents.relative_key, wiki_documents.title_key,
                COALESCE(documents.created_ns, 0), COALESCE(documents.modified_ns, 0)
         FROM wiki_documents LEFT JOIN documents ON documents.path = wiki_documents.path
         ORDER BY wiki_documents.path",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(NodeRow {
            path: row.get(0)?,
            relative_key: row.get(1)?,
            title_key: row.get(2)?,
            created_ns: row.get(3)?,
            modified_ns: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn read_directed_edges(
    connection: &Connection,
    root: &Path,
    nodes: &[NodeRow],
) -> Result<Vec<(u32, u32, u32)>, SearchError> {
    let mut identity_of_path = HashMap::<&str, u32>::with_capacity(nodes.len());
    for (identity, node) in nodes.iter().enumerate() {
        identity_of_path.insert(node.path.as_str(), identity as u32);
    }
    let mut directed = Vec::new();
    wiki::for_each_typed_link(
        connection,
        root,
        nodes.iter().map(|node| {
            (
                node.path.as_str(),
                node.relative_key.as_str(),
                node.title_key.as_str(),
            )
        }),
        |source, target, link_type| {
            let Some(from) = identity_of_path.get(source).copied() else {
                return;
            };
            let Some(to) = identity_of_path.get(target).copied() else {
                return;
            };
            if from != to {
                let link_type = if link_type == "markdown" { 2 } else { 1 };
                directed.push((from, to, link_type));
            }
        },
    )?;
    append_structural_edges(connection, root, nodes, &identity_of_path, &mut directed)?;
    directed.sort_unstable();
    directed.dedup();
    Ok(directed)
}

fn append_structural_edges(
    connection: &Connection,
    root: &Path,
    nodes: &[NodeRow],
    identity_of_path: &HashMap<&str, u32>,
    directed: &mut Vec<(u32, u32, u32)>,
) -> Result<(), SearchError> {
    let mut statement = connection.prepare(
        "SELECT path, key_lower, text, items FROM note_fields
         WHERE key_lower IN ('parent', 'related', 'depends_on', 'blocks')
         ORDER BY path, ordinal",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut by_title = HashMap::<&str, Vec<&str>>::new();
    let mut by_relative = HashMap::<&str, Vec<&str>>::new();
    for node in nodes {
        by_title
            .entry(&node.title_key)
            .or_default()
            .push(&node.path);
        by_relative
            .entry(&node.relative_key)
            .or_default()
            .push(&node.path);
    }
    for row in rows {
        let (source, field, text, items) = row?;
        let Some(source_index) = identity_of_path.get(source.as_str()).copied() else {
            continue;
        };
        let values = items
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| vec![text]);
        for value in values {
            let clean = structural_target(&value);
            if clean.is_empty() || clean.eq_ignore_ascii_case("null") {
                continue;
            }
            let (key, kind) = wiki::target::target_key(&clean);
            let candidates = if kind == "path" {
                by_relative.get(key.as_str())
            } else {
                by_title.get(key.as_str())
            };
            let Some(target) = candidates
                .and_then(|paths| wiki::target::pick_candidate(root, Path::new(&source), paths))
            else {
                continue;
            };
            let Some(target_index) = identity_of_path.get(target).copied() else {
                continue;
            };
            if source_index == target_index {
                continue;
            }
            let mask = structural_type_mask(&field);
            directed.push((source_index, target_index, mask));
            if field == "related" {
                directed.push((target_index, source_index, mask));
            }
        }
    }
    Ok(())
}

fn structural_target(value: &str) -> String {
    let value = value.trim();
    let value = if value.starts_with("[[") && value.ends_with("]]") {
        &value[2..value.len() - 2]
    } else {
        value
            .strip_prefix('[')
            .and_then(|target| target.strip_suffix(']'))
            .unwrap_or(value)
    };
    value
        .split('|')
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn structural_type_mask(field: &str) -> u32 {
    match field {
        "parent" => 4,
        "related" => 8,
        "depends_on" => 16,
        "blocks" => 32,
        _ => 0,
    }
}

fn render_order(ranks: &[f32]) -> Vec<u32> {
    let mut identities = (0..ranks.len() as u32).collect::<Vec<_>>();
    identities.sort_unstable_by(|left, right| {
        ranks[*right as usize]
            .total_cmp(&ranks[*left as usize])
            .then_with(|| left.cmp(right))
    });
    let mut render_of_identity = vec![0u32; ranks.len()];
    for (slot, identity) in identities.into_iter().enumerate() {
        render_of_identity[identity as usize] = slot as u32;
    }
    render_of_identity
}

fn ordered_edges(
    directed: &[(u32, u32, u32)],
    render_of_identity: &[u32],
) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    let mut pairs = HashMap::<(u32, u32), (u32, u32)>::with_capacity(directed.len());
    for (source, target, link_type) in directed {
        let source = render_of_identity[*source as usize];
        let target = render_of_identity[*target as usize];
        let pair = (source.min(target), source.max(target));
        let direction = if source < target {
            *link_type
        } else {
            *link_type << 6
        };
        let masks = pairs.entry(pair).or_default();
        masks.0 |= direction;
        masks.1 |= link_type;
    }
    let mut pairs = pairs.into_iter().collect::<Vec<_>>();
    pairs.sort_unstable_by_key(|(pair, _)| *pair);
    let mut edges = Vec::with_capacity(pairs.len() * 2);
    let mut edge_directions = Vec::with_capacity(pairs.len());
    let mut edge_types = Vec::with_capacity(pairs.len());
    for ((left, right), (direction, link_type)) in pairs {
        edges.push(left);
        edges.push(right);
        edge_directions.push(direction);
        edge_types.push(link_type);
    }
    (edges, edge_directions, edge_types)
}

fn degrees(node_count: usize, edges: &[u32]) -> Vec<u32> {
    let mut degrees = vec![0u32; node_count];
    for endpoint in edges {
        degrees[*endpoint as usize] += 1;
    }
    degrees
}

fn days(nanos: i64) -> f32 {
    if nanos <= 0 {
        return f32::NAN;
    }
    (nanos as f64 / NANOS_PER_DAY) as f32
}

#[cfg(test)]
mod tests {
    use super::{ordered_edges, paths_at, stable_node_id, RenderSnapshot};
    use crate::search::{fields, wiki};
    use rusqlite::Connection;
    use std::path::Path;

    #[test]
    fn stable_ids_follow_paths_and_distinguish_case() {
        assert_eq!(
            stable_node_id("notes/alpha.md"),
            stable_node_id("notes/alpha.md")
        );
        assert_ne!(
            stable_node_id("notes/alpha.md"),
            stable_node_id("notes/Alpha.md")
        );
    }

    #[test]
    fn edge_masks_keep_each_link_direction() {
        assert_eq!(
            ordered_edges(&[(0, 1, 1)], &[0, 1]),
            (vec![0, 1], vec![1], vec![1])
        );
        assert_eq!(
            ordered_edges(&[(1, 0, 2)], &[0, 1]),
            (vec![0, 1], vec![128], vec![2])
        );
        assert_eq!(
            ordered_edges(&[(0, 1, 1), (1, 0, 2)], &[0, 1]),
            (vec![0, 1], vec![129], vec![3]),
        );
    }

    fn vault() -> (Connection, &'static Path) {
        let root = Path::new("C:/vault");
        let mut connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "CREATE TABLE documents (
                   path TEXT PRIMARY KEY,
                   modified_ns INTEGER NOT NULL,
                   size INTEGER NOT NULL,
                   content_hash BLOB NOT NULL,
                   analyzer_version INTEGER NOT NULL DEFAULT 0,
                   created_ns INTEGER NOT NULL DEFAULT 0,
                   created_source INTEGER NOT NULL DEFAULT 0
                 ) WITHOUT ROWID",
            )
            .expect("documents table");
        wiki::open_schema(&connection).expect("wiki schema");
        fields::open_schema(&connection).expect("fields schema");
        let transaction = connection.transaction().expect("transaction");
        for (name, body) in [
            ("Hub", "[[Leaf]] and [[Other]]"),
            ("Leaf", "[[Hub]]"),
            ("Other", ""),
            ("Lonely", "no links at all"),
        ] {
            let path = root.join(format!("{name}.md"));
            wiki::index_document(&transaction, root, &path, body).expect("wiki row");
            transaction
                .execute(
                    "INSERT INTO documents(path, modified_ns, size, content_hash, created_ns)
                     VALUES(?1, 200, 10, x'00', 100)",
                    [path.to_string_lossy().as_ref()],
                )
                .expect("document row");
        }
        transaction.commit().expect("commit");
        (connection, root)
    }

    #[test]
    fn notes_without_links_stay_in_the_snapshot() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert_eq!(snapshot.node_count(), 4);
        assert_eq!(snapshot.cluster_ids.len(), snapshot.node_count());
        let lonely = snapshot
            .paths
            .iter()
            .position(|path| path.ends_with("Lonely.md"))
            .unwrap();
        let hub = snapshot
            .paths
            .iter()
            .position(|path| path.ends_with("Hub.md"))
            .unwrap();
        assert_ne!(snapshot.cluster_ids[lonely], snapshot.cluster_ids[hub]);
    }

    #[test]
    fn mutual_links_collapse_into_a_single_edge() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert_eq!(snapshot.edge_count(), 2);
    }

    #[test]
    fn markdown_and_wiki_links_keep_separate_type_bits_on_the_same_edge() {
        let (mut connection, root) = vault();
        let source = root.join("Source.md");
        let target = root.join("Target.md");
        let transaction = connection.transaction().unwrap();
        wiki::index_document(
            &transaction,
            root,
            &source,
            "[[Target]] and [target](Target.md)",
        )
        .unwrap();
        wiki::index_document(&transaction, root, &target, "target").unwrap();
        transaction.commit().unwrap();

        let snapshot = RenderSnapshot::build(&connection, root).unwrap();

        let edge = snapshot
            .edges
            .chunks_exact(2)
            .position(|pair| {
                let left = &snapshot.paths[pair[0] as usize];
                let right = &snapshot.paths[pair[1] as usize];
                (left.ends_with("Source.md") && right.ends_with("Target.md"))
                    || (right.ends_with("Source.md") && left.ends_with("Target.md"))
            })
            .unwrap();
        assert_eq!(snapshot.edge_types[edge], 3);
    }

    #[test]
    fn frontmatter_relations_form_typed_edges_and_related_is_bidirectional() {
        let (mut connection, root) = vault();
        let hub = root.join("Hub.md");
        let transaction = connection.transaction().unwrap();
        fields::index_document(
            &transaction,
            &hub,
            "---\nparent: [[Leaf]]\nrelated: [Other, Lonely]\ndepends_on: Other\nblocks: Lonely\n---\n",
        )
        .unwrap();
        transaction.commit().unwrap();
        let snapshot = RenderSnapshot::build(&connection, root).unwrap();
        let index = |suffix: &str| {
            snapshot
                .paths
                .iter()
                .position(|path| path.ends_with(suffix))
                .unwrap() as u32
        };
        let edge = |left: u32, right: u32| {
            snapshot
                .edges
                .chunks_exact(2)
                .position(|pair| pair.contains(&left) && pair.contains(&right))
                .unwrap()
        };
        let hub = index("Hub.md");
        let leaf = index("Leaf.md");
        let other = index("Other.md");
        let lonely = index("Lonely.md");

        assert_eq!(snapshot.edge_types[edge(hub, leaf)], 5);
        assert_eq!(snapshot.edge_types[edge(hub, other)], 25);
        assert_eq!(snapshot.edge_types[edge(hub, lonely)], 40);
        let related_directions = 8 | (8 << 6);
        assert_eq!(
            snapshot.edge_directions[edge(hub, lonely)] & related_directions,
            related_directions
        );
    }

    #[test]
    fn markdown_links_resolve_relative_to_the_source_note() {
        let (mut connection, root) = vault();
        let source = root.join("Folder/Source.md");
        let target = root.join("Folder/Target.md");
        let transaction = connection.transaction().expect("transaction");
        wiki::index_document(
            &transaction,
            root,
            &source,
            "[Target](Target.md#section) and [web](https://example.com)",
        )
        .expect("source row");
        wiki::index_document(&transaction, root, &target, "target").expect("target row");
        transaction.commit().expect("commit");

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert_eq!(snapshot.edge_count(), 3);
        let linked = paths_at(
            &snapshot.paths,
            &(0..snapshot.node_count() as u32).collect::<Vec<_>>(),
        );
        let source_index = linked
            .iter()
            .position(|path| path.ends_with("Folder/Source.md"))
            .unwrap() as u32;
        let target_index = linked
            .iter()
            .position(|path| path.ends_with("Folder/Target.md"))
            .unwrap() as u32;
        assert!(snapshot
            .edges
            .chunks_exact(2)
            .any(|pair| { pair.contains(&source_index) && pair.contains(&target_index) }));
    }

    #[test]
    fn the_most_linked_note_takes_the_first_slot() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert!(paths_at(&snapshot.paths, &[0])[0].ends_with("Hub.md"));
    }

    #[test]
    fn edges_are_ordered_by_their_most_important_endpoint() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");
        let leading = snapshot
            .edges
            .chunks_exact(2)
            .map(|pair| pair[0])
            .collect::<Vec<_>>();
        let mut sorted = leading.clone();
        sorted.sort_unstable();

        assert_eq!(leading, sorted);
        assert!(snapshot.edges.chunks_exact(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn every_node_gets_a_finite_position_and_a_degree() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert_eq!(snapshot.positions.len(), snapshot.node_count() * 2);
        assert_eq!(snapshot.degrees.len(), snapshot.node_count());
        assert!(snapshot.positions.iter().all(|value| value.is_finite()));
        assert_eq!(snapshot.degrees.iter().sum::<u32>(), 4);
    }

    #[test]
    fn dates_reach_the_snapshot_as_days() {
        let (connection, root) = vault();

        let snapshot = RenderSnapshot::build(&connection, root).expect("snapshot");

        assert!(snapshot.created_days.iter().all(|value| *value > 0.0));
        assert!(snapshot.modified_days.iter().all(|value| *value > 0.0));
    }

    #[test]
    fn an_unindexed_workspace_yields_an_empty_snapshot() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "CREATE TABLE documents (path TEXT PRIMARY KEY, modified_ns INTEGER NOT NULL,
                   size INTEGER NOT NULL, content_hash BLOB NOT NULL,
                   analyzer_version INTEGER NOT NULL DEFAULT 0,
                   created_ns INTEGER NOT NULL DEFAULT 0,
                   created_source INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID",
            )
            .expect("documents table");
        wiki::open_schema(&connection).expect("wiki schema");
        fields::open_schema(&connection).expect("fields schema");

        let snapshot = RenderSnapshot::build(&connection, Path::new("C:/vault")).expect("snapshot");

        assert_eq!(snapshot.node_count(), 0);
        assert_eq!(snapshot.edge_count(), 0);
        assert!(snapshot.positions.is_empty());
    }
}
