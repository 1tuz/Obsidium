use crate::search::analysis::graph::GraphSnapshot;
use crate::search::paths::{identity, relative_slash_path};
use std::collections::{HashMap, VecDeque};
use std::path::Path;

pub const MIN_DEPTH: usize = 1;
pub const MAX_DEPTH: usize = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    Both,
    In,
    Out,
}

impl Direction {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "both" => Ok(Self::Both),
            "in" => Ok(Self::In),
            "out" => Ok(Self::Out),
            other => Err(format!(
                "Неизвестное направление «{other}»: допустимы both, in, out"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Both => "both",
            Self::In => "in",
            Self::Out => "out",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Node {
    pub path: String,
    pub distance: usize,
    pub via: &'static str,
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Clone, Debug, Default)]
pub struct Neighborhood {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

pub fn build(
    graph: &GraphSnapshot,
    root: &Path,
    note: &Path,
    depth: usize,
    direction: Direction,
    limit: usize,
) -> Neighborhood {
    let depth = depth.clamp(MIN_DEPTH, MAX_DEPTH);
    let limit = limit.max(1);
    let start = identity(note);
    let mut outgoing = HashMap::<String, Vec<(String, &'static str)>>::new();
    let mut incoming = HashMap::<String, Vec<(String, &'static str)>>::new();
    for (source, target, labels) in graph.edges() {
        let label = labels.iter().next().copied().unwrap_or("wiki");
        outgoing
            .entry(source.to_owned())
            .or_default()
            .push((target.to_owned(), label));
        incoming
            .entry(target.to_owned())
            .or_default()
            .push((source.to_owned(), label));
    }

    let mut distances = HashMap::<String, usize>::from([(start.clone(), 0)]);
    let mut nodes = vec![Node {
        path: relative_slash_path(root, note),
        distance: 0,
        via: "self",
    }];
    let mut queue = VecDeque::from([start]);
    while let Some(current) = queue.pop_front() {
        let distance = distances.get(&current).copied().unwrap_or_default();
        if distance >= depth {
            continue;
        }
        let mut found = Vec::new();
        if direction != Direction::In {
            if let Some(targets) = outgoing.get(&current) {
                found.extend(targets.iter().cloned());
            }
        }
        if direction != Direction::Out {
            if let Some(sources) = incoming.get(&current) {
                found.extend(sources.iter().cloned());
            }
        }
        found.sort();
        found.dedup();
        for (neighbour, label) in found {
            if distances.contains_key(&neighbour) {
                continue;
            }
            if nodes.len() >= limit {
                break;
            }
            distances.insert(neighbour.clone(), distance + 1);
            nodes.push(Node {
                path: graph.path_of(&neighbour).map_or_else(
                    || neighbour.clone(),
                    |path| relative_slash_path(root, Path::new(path)),
                ),
                distance: distance + 1,
                via: label,
            });
            queue.push_back(neighbour);
        }
    }

    let mut edges = graph
        .edges()
        .filter(|(source, target, _)| {
            distances.contains_key(*source) && distances.contains_key(*target)
        })
        .map(|(source, target, labels)| Edge {
            source: graph.path_of(source).map_or_else(
                || source.to_owned(),
                |path| relative_slash_path(root, Path::new(path)),
            ),
            target: graph.path_of(target).map_or_else(
                || target.to_owned(),
                |path| relative_slash_path(root, Path::new(path)),
            ),
            kind: labels.iter().copied().collect::<Vec<_>>().join(","),
        })
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| {
        left.source
            .cmp(&right.source)
            .then_with(|| left.target.cmp(&right.target))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    Neighborhood { nodes, edges }
}
