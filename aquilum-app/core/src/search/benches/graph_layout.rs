use super::support::record;
use crate::search::graph::layout::{compute, compute_incremental};
use std::collections::HashMap;
use std::process::Command;
use std::time::Instant;

const SIZES: [usize; 4] = [100, 1_000, 10_000, 100_000];

#[test]
#[ignore = "run with cargo test -p aquilum-core --lib benchmark_graph_layout -- --ignored --nocapture"]
fn benchmark_graph_layout() {
    let default_sizes = SIZES
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let sizes = std::env::var("OBSIDIUM_GRAPH_BENCH_SIZES").unwrap_or(default_sizes);
    for count in sizes
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
    {
        for (name, edges) in [
            ("sparse", sparse_graph(count)),
            ("clustered", clustered_graph(count)),
        ] {
            run_case(name, count, &edges);
        }
    }
}

fn run_case(graph: &str, count: usize, edges: &[u32]) {
    let paths = (0..count)
        .map(|node| format!("notes/{node:06}.md"))
        .collect::<Vec<_>>();
    let cached_count = count.saturating_sub((count / 100).max(1));
    let cached = paths
        .iter()
        .take(cached_count)
        .enumerate()
        .map(|(node, path)| {
            (
                path.clone(),
                (node as f32 * 0.25, (node % 997) as f32 * 0.25),
            )
        })
        .collect::<HashMap<_, _>>();
    let rss_before = process_rss_bytes();

    let started = Instant::now();
    let positions = compute(count, edges, 1.0);
    let full_us = started.elapsed().as_micros();
    assert_eq!(positions.len(), count * 2);
    drop(positions);
    let rss_after_full = process_rss_bytes();

    let started = Instant::now();
    let positions = compute_incremental(&paths, edges, 1.0, &cached);
    let incremental_us = started.elapsed().as_micros();
    assert_eq!(positions.len(), count * 2);
    assert!(positions.iter().all(|value| value.is_finite()));
    let rss_after_incremental = process_rss_bytes();

    let line = format!(
        "graph={graph} nodes={count} edges={} cached_nodes={cached_count} full_layout_us={full_us} incremental_seed_us={incremental_us} rss_before_bytes={} rss_after_full_bytes={} rss_after_incremental_bytes={}",
        edges.len() / 2,
        rss_before.map_or_else(|| "unavailable".to_owned(), |value| value.to_string()),
        rss_after_full.map_or_else(|| "unavailable".to_owned(), |value| value.to_string()),
        rss_after_incremental.map_or_else(|| "unavailable".to_owned(), |value| value.to_string()),
    );
    println!("BENCH-GRAPH {line}");
    record("graph_layout", &line);
}

fn sparse_graph(count: usize) -> Vec<u32> {
    let mut edges = Vec::with_capacity(count * 4);
    if count < 2 {
        return edges;
    }
    for node in 0..count {
        edges.extend([node as u32, ((node + 1) % count) as u32]);
        if count > 17 {
            edges.extend([node as u32, ((node + 17) % count) as u32]);
        }
    }
    edges
}

fn clustered_graph(count: usize) -> Vec<u32> {
    const CLUSTER_SIZE: usize = 64;
    let mut edges = Vec::with_capacity(count * 5);
    if count < 2 {
        return edges;
    }
    for node in 0..count {
        let cluster_start = node / CLUSTER_SIZE * CLUSTER_SIZE;
        let cluster_len = (count - cluster_start).min(CLUSTER_SIZE);
        for distance in [1, 3] {
            edges.extend([
                node as u32,
                (cluster_start + (node - cluster_start + distance) % cluster_len) as u32,
            ]);
        }
        if (node + 1) % CLUSTER_SIZE == 0 && node + 1 < count {
            edges.extend([node as u32, (node + 1) as u32]);
        }
    }
    edges
}

fn process_rss_bytes() -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(|kilobytes| kilobytes.saturating_mul(1024))
}

#[cfg(test)]
mod tests {
    use super::{clustered_graph, sparse_graph};

    #[test]
    fn generated_bench_graphs_have_valid_endpoints_and_distinct_shapes() {
        for count in [2, 17, 64, 65, 100] {
            for edges in [sparse_graph(count), clustered_graph(count)] {
                assert!(edges
                    .chunks_exact(2)
                    .all(|edge| { (edge[0] as usize) < count && (edge[1] as usize) < count }));
            }
            assert_ne!(sparse_graph(count), clustered_graph(count));
        }
    }
}
