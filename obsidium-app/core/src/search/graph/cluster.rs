use std::collections::HashMap;

const MAX_LEVELS: usize = 16;
const MAX_PASSES: usize = 20;
const MOVE_EPSILON: f64 = 1e-12;

pub fn louvain(node_count: usize, edges: &[(u32, u32)], resolution: f64) -> Vec<u32> {
    if node_count == 0 {
        return Vec::new();
    }
    let mut weighted_edges = edges
        .iter()
        .filter_map(|(left, right)| {
            let left = *left as usize;
            let right = *right as usize;
            (left < node_count && right < node_count && left != right).then_some((
                left.min(right) as u32,
                left.max(right) as u32,
                1.0,
            ))
        })
        .collect::<Vec<_>>();
    weighted_edges.sort_unstable_by_key(|(left, right, _)| (*left, *right));
    weighted_edges.dedup_by_key(|(left, right, _)| (*left, *right));

    let mut original_nodes = (0..node_count).collect::<Vec<_>>();
    let mut current_count = node_count;
    let resolution = if resolution.is_finite() && resolution > 0.0 {
        resolution
    } else {
        1.0
    };

    for _ in 0..MAX_LEVELS {
        let communities = local_move(current_count, &weighted_edges, resolution);
        let community_count = communities.iter().copied().max().unwrap_or(0) as usize + 1;
        if community_count == current_count {
            break;
        }
        for node in &mut original_nodes {
            *node = communities[*node] as usize;
        }
        weighted_edges = aggregate_edges(&weighted_edges, &communities);
        current_count = community_count;
    }

    repair_connectivity(node_count, edges, &original_nodes)
}

fn local_move(node_count: usize, edges: &[(u32, u32, f64)], resolution: f64) -> Vec<u32> {
    let mut adjacency = vec![Vec::<(usize, f64)>::new(); node_count];
    let mut degrees = vec![0.0; node_count];
    for (left, right, weight) in edges {
        let left = *left as usize;
        let right = *right as usize;
        if left == right {
            adjacency[left].push((left, weight * 2.0));
            degrees[left] += weight * 2.0;
        } else {
            adjacency[left].push((right, *weight));
            adjacency[right].push((left, *weight));
            degrees[left] += weight;
            degrees[right] += weight;
        }
    }
    let total_weight = degrees.iter().sum::<f64>();
    if total_weight == 0.0 {
        return (0..node_count as u32).collect();
    }

    let mut communities = (0..node_count as u32).collect::<Vec<_>>();
    let mut totals = degrees.clone();
    let mut neighbor_weights = HashMap::<u32, f64>::new();
    for _ in 0..MAX_PASSES {
        let mut changed = false;
        for node in 0..node_count {
            let current = communities[node];
            let degree = degrees[node];
            totals[current as usize] -= degree;
            neighbor_weights.clear();
            for (neighbor, weight) in &adjacency[node] {
                *neighbor_weights.entry(communities[*neighbor]).or_default() += weight;
            }
            let mut best = current;
            let mut best_gain = neighbor_weights.get(&current).copied().unwrap_or(0.0)
                - resolution * degree * totals[current as usize] / total_weight;
            for (candidate, weight) in &neighbor_weights {
                let gain =
                    *weight - resolution * degree * totals[*candidate as usize] / total_weight;
                if gain > best_gain + MOVE_EPSILON
                    || ((gain - best_gain).abs() <= MOVE_EPSILON
                        && gain > MOVE_EPSILON
                        && *candidate < best)
                {
                    best = *candidate;
                    best_gain = gain;
                }
            }
            communities[node] = best;
            totals[best as usize] += degree;
            changed |= best != current;
        }
        if !changed {
            break;
        }
    }
    normalize_communities(&communities)
}

fn aggregate_edges(edges: &[(u32, u32, f64)], communities: &[u32]) -> Vec<(u32, u32, f64)> {
    let mut weights = HashMap::<(u32, u32), f64>::new();
    for (left, right, weight) in edges {
        let left = communities[*left as usize];
        let right = communities[*right as usize];
        *weights
            .entry((left.min(right), left.max(right)))
            .or_default() += weight;
    }
    let mut aggregated = weights
        .into_iter()
        .map(|((left, right), weight)| (left, right, weight))
        .collect::<Vec<_>>();
    aggregated.sort_unstable_by_key(|(left, right, _)| (*left, *right));
    aggregated
}

fn repair_connectivity(node_count: usize, edges: &[(u32, u32)], communities: &[usize]) -> Vec<u32> {
    let mut parents = (0..node_count).collect::<Vec<_>>();
    for (left, right) in edges {
        let left = *left as usize;
        let right = *right as usize;
        if left < node_count && right < node_count && communities[left] == communities[right] {
            union(&mut parents, left, right);
        }
    }
    let mut labels = HashMap::<usize, usize>::new();
    for node in 0..node_count {
        let root = find(&mut parents, node);
        labels
            .entry(root)
            .and_modify(|first| *first = (*first).min(node))
            .or_insert(node);
    }
    let mut roots = labels
        .iter()
        .map(|(root, first)| (*first, *root))
        .collect::<Vec<_>>();
    roots.sort_unstable();
    let ids = roots
        .iter()
        .enumerate()
        .map(|(id, (_, root))| (*root, id as u32))
        .collect::<HashMap<_, _>>();
    (0..node_count)
        .map(|node| ids[&find(&mut parents, node)])
        .collect()
}

fn normalize_communities(communities: &[u32]) -> Vec<u32> {
    let mut first_nodes = HashMap::<u32, usize>::new();
    for (node, community) in communities.iter().enumerate() {
        first_nodes
            .entry(*community)
            .and_modify(|first| *first = (*first).min(node))
            .or_insert(node);
    }
    let mut ordered = first_nodes
        .iter()
        .map(|(community, first)| (*first, *community))
        .collect::<Vec<_>>();
    ordered.sort_unstable();
    let ids = ordered
        .iter()
        .enumerate()
        .map(|(id, (_, community))| (*community, id as u32))
        .collect::<HashMap<_, _>>();
    communities.iter().map(|community| ids[community]).collect()
}

fn find(parents: &mut [usize], node: usize) -> usize {
    if parents[node] != node {
        parents[node] = find(parents, parents[node]);
    }
    parents[node]
}

fn union(parents: &mut [usize], left: usize, right: usize) {
    let left = find(parents, left);
    let right = find(parents, right);
    if left != right {
        let (first, second) = if left < right {
            (left, right)
        } else {
            (right, left)
        };
        parents[second] = first;
    }
}

#[cfg(test)]
mod tests {
    use super::louvain;

    #[test]
    fn separates_dense_communities_and_keeps_an_isolate_alone() {
        let edges = [
            (0, 1),
            (0, 2),
            (0, 3),
            (1, 2),
            (1, 3),
            (2, 3),
            (3, 4),
            (4, 5),
            (4, 6),
            (4, 7),
            (5, 6),
            (5, 7),
            (6, 7),
        ];

        let communities = louvain(9, &edges, 1.0);

        assert_eq!(communities[0], communities[3]);
        assert_eq!(communities[4], communities[7]);
        assert_ne!(communities[0], communities[4]);
        assert_ne!(communities[8], communities[0]);
        assert_ne!(communities[8], communities[4]);
    }

    #[test]
    fn ignores_duplicate_and_invalid_edges_deterministically() {
        let edges = [(0, 1), (0, 1), (1, 0), (8, 9), (2, 2)];

        assert_eq!(louvain(3, &edges, 1.0), vec![0, 0, 1]);
    }

    #[test]
    fn returns_one_cluster_id_per_node_at_target_graph_sizes() {
        for node_count in [100, 1_000, 10_000, 100_000] {
            let edges = (1..node_count)
                .map(|node| ((node - 1) as u32, node as u32))
                .collect::<Vec<_>>();

            let communities = louvain(node_count, &edges, 1.0);

            assert_eq!(communities.len(), node_count);
            assert!(communities
                .iter()
                .all(|community| (*community as usize) < node_count));
        }
    }
}
