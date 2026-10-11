use super::adjacency::{components, Adjacency};
use super::force;
use super::separate;
use std::collections::HashMap;
use std::f64::consts::PI;

const GOLDEN_ANGLE: f64 = 2.399_963_229_728_653;
const POWER_ITERATIONS: usize = 96;
const ORPHAN_SPACING: f64 = 1.2;
const NODE_SPACING: f64 = 1.0;
const REFINEMENT_TICKS: usize = 120;
const MIN_NODE_GAP: f64 = 0.6;
const SEPARATION_PASSES: usize = 96;
const LARGE_COMPONENT: usize = 20_000;
const MIN_SPREAD: f64 = 0.6;
const MAX_SPREAD: f64 = 2.5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Force,
    Hierarchical,
    Ring,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Force => "force",
            Self::Hierarchical => "hierarchical",
            Self::Ring => "ring",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "force" => Some(Self::Force),
            "hierarchical" => Some(Self::Hierarchical),
            "ring" => Some(Self::Ring),
            _ => None,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub mode: Mode,
    pub attraction: f64,
    pub repulsion: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            mode: Mode::Force,
            attraction: 1.0,
            repulsion: 1.0,
        }
    }
}

pub fn compute_incremental(
    paths: &[String],
    edges: &[u32],
    repulsion: f64,
    cached: &HashMap<String, (f32, f32)>,
) -> Vec<f32> {
    compute_incremental_with_options(
        paths,
        edges,
        Options {
            repulsion,
            ..Options::default()
        },
        cached,
    )
}

pub fn compute_incremental_with_options(
    paths: &[String],
    edges: &[u32],
    options: Options,
    cached: &HashMap<String, (f32, f32)>,
) -> Vec<f32> {
    let mut positions = vec![f32::NAN; paths.len() * 2];
    let mut missing = Vec::new();
    for (node, path) in paths.iter().enumerate() {
        if let Some((x, y)) = cached
            .get(path)
            .filter(|(x, y)| x.is_finite() && y.is_finite())
        {
            positions[node * 2] = *x;
            positions[node * 2 + 1] = *y;
        } else {
            missing.push(node);
        }
    }
    if missing.is_empty() {
        return positions;
    }
    if missing.len() == paths.len() {
        return compute_with_options(paths.len(), edges, options);
    }

    let adjacency = Adjacency::build(paths.len(), edges);
    let mut outer_radius = positions
        .chunks_exact(2)
        .filter(|pair| pair[0].is_finite() && pair[1].is_finite())
        .map(|pair| f64::from(pair[0]).hypot(f64::from(pair[1])))
        .fold(0.0f64, f64::max);
    for node in missing {
        let neighbors = adjacency.neighbours(node as u32);
        let mut center_x = 0.0f64;
        let mut center_y = 0.0f64;
        let mut count = 0usize;
        for neighbor in neighbors {
            let slot = *neighbor as usize * 2;
            if positions[slot].is_finite() && positions[slot + 1].is_finite() {
                center_x += f64::from(positions[slot]);
                center_y += f64::from(positions[slot + 1]);
                count += 1;
            }
        }
        let seed = paths[node]
            .bytes()
            .fold(0xcbf29ce484222325u64, |hash, byte| {
                (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
            });
        let angle = (seed as f64) * GOLDEN_ANGLE;
        let distance = NODE_SPACING * (1.0 + (seed % 7) as f64 * 0.15);
        if count > 0 {
            center_x /= count as f64;
            center_y /= count as f64;
            center_x += distance * angle.cos();
            center_y += distance * angle.sin();
        } else {
            outer_radius += distance;
            center_x = outer_radius * angle.cos();
            center_y = outer_radius * angle.sin();
        }
        positions[node * 2] = center_x as f32;
        positions[node * 2 + 1] = center_y as f32;
    }
    positions
}

pub fn compute(node_count: usize, edges: &[u32], repulsion: f64) -> Vec<f32> {
    compute_with_options(
        node_count,
        edges,
        Options {
            repulsion,
            ..Options::default()
        },
    )
}

pub fn compute_with_options(node_count: usize, edges: &[u32], options: Options) -> Vec<f32> {
    let mut positions = vec![0.0f32; node_count * 2];
    if node_count == 0 {
        return positions;
    }
    if options.mode != Mode::Force {
        return compute_non_force(node_count, edges, options);
    }
    let repulsion = options.repulsion;
    let adjacency = Adjacency::build(node_count, edges);
    let groups = group_by_component(node_count, edges);
    let (core, rest) = groups.split_first().expect("at least one component");
    let (orphans, clusters): (Vec<_>, Vec<_>) = rest.iter().partition(|members| members.len() == 1);
    let core_radius = place_core(
        core,
        &adjacency,
        repulsion,
        options.attraction,
        &mut positions,
    );
    place_belt(
        &clusters,
        &orphans,
        &adjacency,
        repulsion,
        options.attraction,
        core_radius,
        &mut positions,
    );
    clear_the_promised_gap(&mut positions);
    let spread = repulsion.clamp(MIN_SPREAD, MAX_SPREAD) as f32;
    for value in positions.iter_mut() {
        *value *= spread;
    }
    positions
}

fn compute_non_force(node_count: usize, edges: &[u32], options: Options) -> Vec<f32> {
    let groups = group_by_component(node_count, edges);
    let mut positions = vec![0.0f32; node_count * 2];
    match options.mode {
        Mode::Force => unreachable!(),
        Mode::Ring => {
            let spread = options
                .repulsion
                .clamp(MIN_SPREAD, MAX_SPREAD)
                .max(MIN_NODE_GAP);
            let radius = node_count.max(1) as f64 * NODE_SPACING / (2.0 * PI * spread);
            place_ring(
                &(0..node_count as u32).collect::<Vec<_>>(),
                0.0,
                0.0,
                radius,
                &mut positions,
            );
        }
        Mode::Hierarchical => {
            let adjacency = Adjacency::build(node_count, edges);
            let mut component_x = 0.0;
            let mut depth = vec![usize::MAX; node_count];
            for members in groups {
                let root = members[0];
                let mut queue = std::collections::VecDeque::from([root]);
                depth[root as usize] = 0;
                while let Some(node) = queue.pop_front() {
                    for neighbour in adjacency.neighbours(node) {
                        if depth[*neighbour as usize] == usize::MAX {
                            depth[*neighbour as usize] = depth[node as usize] + 1;
                            queue.push_back(*neighbour);
                        }
                    }
                }
                let max_depth = members
                    .iter()
                    .map(|node| depth[*node as usize])
                    .max()
                    .unwrap_or(0);
                let mut rows = vec![Vec::new(); max_depth + 1];
                for node in members {
                    rows[depth[node as usize]].push(node);
                }
                let max_width = rows.iter().map(Vec::len).max().unwrap_or(1);
                for (level, row) in rows.iter_mut().enumerate() {
                    row.sort_unstable();
                    let width = row.len() as f64;
                    let left = component_x + (max_width as f64 - width) * NODE_SPACING * 0.5;
                    for (slot, node) in row.iter().enumerate() {
                        let index = *node as usize * 2;
                        positions[index] = (left + slot as f64 * NODE_SPACING) as f32;
                        positions[index + 1] = (level as f64 * NODE_SPACING) as f32;
                    }
                }
                component_x += (max_width as f64 + 2.0) * NODE_SPACING;
            }
        }
    }
    for value in &mut positions {
        *value *= options.repulsion.clamp(MIN_SPREAD, MAX_SPREAD) as f32;
    }
    positions
}

fn clear_the_promised_gap(positions: &mut [f32]) {
    let mut relaxed = positions
        .iter()
        .map(|value| f64::from(*value))
        .collect::<Vec<_>>();
    separate::separate(&mut relaxed, MIN_NODE_GAP, SEPARATION_PASSES);
    for (slot, value) in relaxed.iter().enumerate() {
        positions[slot] = *value as f32;
    }
}

fn group_by_component(node_count: usize, edges: &[u32]) -> Vec<Vec<u32>> {
    let labels = components(node_count, edges);
    let mut groups = HashMap::<u32, Vec<u32>>::new();
    for (node, label) in labels.iter().enumerate() {
        groups.entry(*label).or_default().push(node as u32);
    }
    let mut groups = groups.into_values().collect::<Vec<_>>();
    groups.sort_unstable_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left[0].cmp(&right[0]))
    });
    groups
}

fn place_core(
    members: &[u32],
    adjacency: &Adjacency,
    repulsion: f64,
    attraction: f64,
    positions: &mut [f32],
) -> f64 {
    if members.len() < 3 {
        return place_ring(members, 0.0, 0.0, NODE_SPACING, positions);
    }
    let spread = NODE_SPACING * (members.len() as f64).sqrt() * 0.75;
    let Some(coordinates) = shaped_component(members, adjacency, spread, repulsion, attraction)
    else {
        return place_ring(members, 0.0, 0.0, spread, positions);
    };
    let mut radius = 0.0f64;
    for (slot, node) in members.iter().enumerate() {
        let (x, y) = (coordinates[slot * 2], coordinates[slot * 2 + 1]);
        positions[*node as usize * 2] = x as f32;
        positions[*node as usize * 2 + 1] = y as f32;
        radius = radius.max(x.hypot(y));
    }
    radius
}

fn shaped_component(
    members: &[u32],
    adjacency: &Adjacency,
    spread: f64,
    repulsion: f64,
    attraction: f64,
) -> Option<Vec<f64>> {
    let mut coordinates = pivot_mds(members, adjacency)?;
    let scale = spread / rms_radius(&coordinates).max(f64::EPSILON);
    for value in coordinates.iter_mut() {
        *value *= scale;
    }
    let ticks = if members.len() > LARGE_COMPONENT {
        REFINEMENT_TICKS / 4
    } else {
        REFINEMENT_TICKS
    };
    let edges = local_edges(members, adjacency);
    force::refine(
        &mut coordinates,
        &edges,
        &force::Settings {
            ticks,
            spacing: NODE_SPACING,
            repulsion,
            attraction,
        },
    );
    normalize_spacing(&mut coordinates, &edges);
    separate::separate(&mut coordinates, MIN_NODE_GAP, SEPARATION_PASSES);
    recenter(&mut coordinates);
    Some(coordinates)
}

fn normalize_spacing(coordinates: &mut [f64], edges: &[(u32, u32)]) {
    let mut lengths = edges
        .iter()
        .map(|(left, right)| {
            let dx = coordinates[*left as usize * 2] - coordinates[*right as usize * 2];
            let dy = coordinates[*left as usize * 2 + 1] - coordinates[*right as usize * 2 + 1];
            dx.hypot(dy)
        })
        .filter(|length| *length > f64::EPSILON)
        .collect::<Vec<_>>();
    if lengths.is_empty() {
        return;
    }
    lengths.sort_by(f64::total_cmp);
    let scale = NODE_SPACING / lengths[lengths.len() / 2];
    for value in coordinates.iter_mut() {
        *value *= scale;
    }
}

fn local_edges(members: &[u32], adjacency: &Adjacency) -> Vec<(u32, u32)> {
    let mut local = HashMap::<u32, u32>::with_capacity(members.len());
    for (slot, node) in members.iter().enumerate() {
        local.insert(*node, slot as u32);
    }
    let mut edges = Vec::new();
    for (slot, node) in members.iter().enumerate() {
        for neighbour in adjacency.neighbours(*node) {
            let Some(other) = local.get(neighbour).copied() else {
                continue;
            };
            if other as usize > slot {
                edges.push((slot as u32, other));
            }
        }
    }
    edges
}

fn recenter(coordinates: &mut [f64]) {
    let count = (coordinates.len() / 2).max(1) as f64;
    let mut center_x = 0.0;
    let mut center_y = 0.0;
    for pair in coordinates.chunks_exact(2) {
        center_x += pair[0];
        center_y += pair[1];
    }
    center_x /= count;
    center_y /= count;
    for pair in coordinates.chunks_exact_mut(2) {
        pair[0] -= center_x;
        pair[1] -= center_y;
    }
}

fn place_belt(
    clusters: &[&Vec<u32>],
    orphans: &[&Vec<u32>],
    adjacency: &Adjacency,
    repulsion: f64,
    attraction: f64,
    core_radius: f64,
    positions: &mut [f32],
) {
    let inner = core_radius + MIN_NODE_GAP;
    let mut filled = 0.0;
    let mut seat = 0usize;
    for members in clusters {
        let spread = NODE_SPACING * (members.len() as f64).sqrt() * 0.6;
        let shape = shaped_component(members, adjacency, spread, repulsion, attraction);
        let own = match &shape {
            Some(coordinates) => outer_radius(coordinates),
            None => spread.max(NODE_SPACING),
        };
        let radius = seat_radius(inner, &mut filled, own);
        let angle = seat as f64 * GOLDEN_ANGLE;
        let center_x = radius * angle.cos();
        let center_y = radius * angle.sin();
        seat += 1;
        match shape {
            Some(coordinates) => {
                for (index, node) in members.iter().enumerate() {
                    positions[*node as usize * 2] = (center_x + coordinates[index * 2]) as f32;
                    positions[*node as usize * 2 + 1] =
                        (center_y + coordinates[index * 2 + 1]) as f32;
                }
            }
            None => {
                place_ring(members, center_x, center_y, own, positions);
            }
        }
    }
    for members in orphans {
        let radius = seat_radius(inner, &mut filled, 0.0);
        let angle = seat as f64 * GOLDEN_ANGLE;
        let node = members[0] as usize;
        positions[node * 2] = (radius * angle.cos()) as f32;
        positions[node * 2 + 1] = (radius * angle.sin()) as f32;
        seat += 1;
    }
}

fn outer_radius(coordinates: &[f64]) -> f64 {
    coordinates
        .chunks_exact(2)
        .map(|pair| pair[0].hypot(pair[1]))
        .fold(0.0f64, f64::max)
}

fn seat_radius(inner: f64, filled: &mut f64, own: f64) -> f64 {
    let footprint = (own * 2.0 + ORPHAN_SPACING).powi(2);
    let packed = (inner * inner + (*filled + footprint * 0.5) / PI).sqrt();
    let radius = packed.max(inner + own);
    *filled = PI * (radius * radius - inner * inner) + footprint * 0.5;
    radius
}

fn place_ring(
    members: &[u32],
    center_x: f64,
    center_y: f64,
    radius: f64,
    positions: &mut [f32],
) -> f64 {
    if members.len() == 1 {
        positions[members[0] as usize * 2] = center_x as f32;
        positions[members[0] as usize * 2 + 1] = center_y as f32;
        return radius;
    }
    for (slot, node) in members.iter().enumerate() {
        let angle = slot as f64 / members.len() as f64 * PI * 2.0;
        positions[*node as usize * 2] = (center_x + radius * angle.cos()) as f32;
        positions[*node as usize * 2 + 1] = (center_y + radius * angle.sin()) as f32;
    }
    radius
}

fn rms_radius(coordinates: &[f64]) -> f64 {
    let squares: f64 = coordinates.iter().map(|value| value * value).sum();
    (squares / (coordinates.len() / 2).max(1) as f64).sqrt()
}

fn pivot_mds(members: &[u32], adjacency: &Adjacency) -> Option<Vec<f64>> {
    let size = members.len();
    if size < 3 {
        return None;
    }
    let pivot_count = if size > 200_000 { 16 } else { 32 }.min(size);
    let mut local = HashMap::<u32, u32>::with_capacity(size);
    for (slot, node) in members.iter().enumerate() {
        local.insert(*node, slot as u32);
    }

    let mut distances = vec![0u32; pivot_count * size];
    let mut spacing = vec![u32::MAX; size];
    let mut pivot = 0usize;
    for round in 0..pivot_count {
        let slice = &mut distances[round * size..(round + 1) * size];
        breadth_first(members[pivot], adjacency, &local, slice);
        for (nearest, distance) in spacing.iter_mut().zip(slice.iter()) {
            *nearest = (*nearest).min(*distance);
        }
        if round + 1 < pivot_count {
            pivot = farthest_slot(&spacing);
        }
    }

    let squared = distances
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .collect::<Vec<_>>();
    let column_means = (0..pivot_count)
        .map(|round| {
            squared[round * size..(round + 1) * size]
                .iter()
                .sum::<f64>()
                / size as f64
        })
        .collect::<Vec<_>>();
    let grand_mean = column_means.iter().sum::<f64>() / pivot_count as f64;

    let mut gram = vec![0.0f64; pivot_count * pivot_count];
    let mut row = vec![0.0f64; pivot_count];
    for slot in 0..size {
        centered_row(
            &squared,
            size,
            pivot_count,
            slot,
            &column_means,
            grand_mean,
            &mut row,
        );
        for left in 0..pivot_count {
            for right in left..pivot_count {
                gram[left * pivot_count + right] += row[left] * row[right];
            }
        }
    }
    for left in 0..pivot_count {
        for right in 0..left {
            gram[left * pivot_count + right] = gram[right * pivot_count + left];
        }
    }

    let (first, dominant) = leading_eigenpair(&gram, pivot_count)?;
    let second = leading_eigenpair(&deflate(&gram, pivot_count, &first, dominant), pivot_count)
        .map(|(vector, _)| orthogonalize(vector, &first))
        .unwrap_or_else(|| perpendicular(&first));

    let mut coordinates = vec![0.0f64; size * 2];
    for slot in 0..size {
        centered_row(
            &squared,
            size,
            pivot_count,
            slot,
            &column_means,
            grand_mean,
            &mut row,
        );
        let mut x = 0.0;
        let mut y = 0.0;
        for round in 0..pivot_count {
            x += row[round] * first[round];
            y += row[round] * second[round];
        }
        coordinates[slot * 2] = x;
        coordinates[slot * 2 + 1] = y;
    }
    Some(coordinates)
}

fn centered_row(
    squared: &[f64],
    size: usize,
    pivot_count: usize,
    slot: usize,
    column_means: &[f64],
    grand_mean: f64,
    row: &mut [f64],
) {
    let mut row_mean = 0.0;
    for round in 0..pivot_count {
        row_mean += squared[round * size + slot];
    }
    row_mean /= pivot_count as f64;
    for round in 0..pivot_count {
        row[round] =
            -0.5 * (squared[round * size + slot] - row_mean - column_means[round] + grand_mean);
    }
}

fn farthest_slot(spacing: &[u32]) -> usize {
    spacing
        .iter()
        .enumerate()
        .max_by_key(|(slot, distance)| (**distance, usize::MAX - slot))
        .map(|(slot, _)| slot)
        .unwrap_or_default()
}

fn breadth_first(
    source: u32,
    adjacency: &Adjacency,
    local: &HashMap<u32, u32>,
    distances: &mut [u32],
) {
    distances.fill(u32::MAX);
    let mut queue = Vec::with_capacity(distances.len());
    distances[local[&source] as usize] = 0;
    queue.push(source);
    let mut head = 0;
    let mut depth = 0;
    while head < queue.len() {
        let node = queue[head];
        head += 1;
        let node_depth = distances[local[&node] as usize];
        for neighbour in adjacency.neighbours(node) {
            let Some(slot) = local.get(neighbour) else {
                continue;
            };
            if distances[*slot as usize] != u32::MAX {
                continue;
            }
            distances[*slot as usize] = node_depth + 1;
            depth = depth.max(node_depth + 1);
            queue.push(*neighbour);
        }
    }
    let unreachable = depth + 1;
    for distance in distances.iter_mut() {
        if *distance == u32::MAX {
            *distance = unreachable;
        }
    }
}

fn leading_eigenpair(matrix: &[f64], size: usize) -> Option<(Vec<f64>, f64)> {
    let mut vector = (0..size)
        .map(|index| (index as f64 * 0.6180339887).fract() + 0.5)
        .collect::<Vec<_>>();
    normalize(&mut vector)?;
    let mut product = vec![0.0f64; size];
    for _ in 0..POWER_ITERATIONS {
        multiply(matrix, size, &vector, &mut product);
        std::mem::swap(&mut vector, &mut product);
        normalize(&mut vector)?;
    }
    multiply(matrix, size, &vector, &mut product);
    let value = vector
        .iter()
        .zip(&product)
        .map(|(left, right)| left * right)
        .sum::<f64>();
    Some((vector, value))
}

fn multiply(matrix: &[f64], size: usize, vector: &[f64], product: &mut [f64]) {
    for row in 0..size {
        product[row] = (0..size)
            .map(|column| matrix[row * size + column] * vector[column])
            .sum();
    }
}

fn deflate(matrix: &[f64], size: usize, vector: &[f64], value: f64) -> Vec<f64> {
    let mut deflated = matrix.to_vec();
    for row in 0..size {
        for column in 0..size {
            deflated[row * size + column] -= value * vector[row] * vector[column];
        }
    }
    deflated
}

fn orthogonalize(mut vector: Vec<f64>, basis: &[f64]) -> Vec<f64> {
    let projection: f64 = vector
        .iter()
        .zip(basis)
        .map(|(value, base)| value * base)
        .sum();
    for (value, base) in vector.iter_mut().zip(basis) {
        *value -= projection * base;
    }
    if normalize(&mut vector).is_none() {
        return perpendicular(basis);
    }
    vector
}

fn perpendicular(basis: &[f64]) -> Vec<f64> {
    let mut vector = (0..basis.len())
        .map(|index| if index % 2 == 0 { 1.0 } else { -1.0 })
        .collect::<Vec<f64>>();
    let projection: f64 = vector
        .iter()
        .zip(basis)
        .map(|(value, base)| value * base)
        .sum();
    for (value, base) in vector.iter_mut().zip(basis) {
        *value -= projection * base;
    }
    normalize(&mut vector);
    vector
}

fn normalize(vector: &mut [f64]) -> Option<()> {
    let length = vector.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !length.is_finite() || length < 1e-12 {
        return None;
    }
    for value in vector.iter_mut() {
        *value /= length;
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::{
        compute, compute_with_options, Mode, Options, MIN_NODE_GAP, NODE_SPACING, ORPHAN_SPACING,
    };

    fn distance(positions: &[f32], left: usize, right: usize) -> f32 {
        let dx = positions[left * 2] - positions[right * 2];
        let dy = positions[left * 2 + 1] - positions[right * 2 + 1];
        dx.hypot(dy)
    }

    fn closest(positions: &[f32]) -> f32 {
        let count = positions.len() / 2;
        let mut closest = f32::INFINITY;
        for left in 0..count {
            for right in (left + 1)..count {
                closest = closest.min(distance(positions, left, right));
            }
        }
        closest
    }

    #[test]
    fn the_promised_gap_clears_the_widest_node_the_renderer_draws() {
        let min_spread = 0.6;
        let node_gap_share = 0.49;
        let tightest_gap = MIN_NODE_GAP * min_spread;
        let widest_node_diameter = tightest_gap * node_gap_share * 2.0;

        assert!(
            tightest_gap > widest_node_diameter,
            "the renderer caps a node at MIN_NODE_GAP * spread * NODE_GAP_SHARE from
             nodeMetrics.ts, so two of them ({widest_node_diameter}) must stay inside
             the promised gap at the tightest spread ({tightest_gap})"
        );
    }

    #[test]
    fn a_dense_hub_never_lets_its_notes_land_on_each_other() {
        let mut edges = Vec::new();
        for note in 1..60u32 {
            edges.push(0);
            edges.push(note);
        }

        let positions = compute(60, &edges, 1.0);

        assert!(
            closest(&positions) as f64 > MIN_NODE_GAP * 0.9,
            "notes overlap: {} against a promised gap of {}",
            closest(&positions),
            MIN_NODE_GAP
        );
    }

    #[test]
    fn a_tight_mesh_keeps_the_promised_gap() {
        let mut edges = Vec::new();
        for note in 0..40u32 {
            for other in (note + 1)..40u32 {
                if (note + other) % 3 == 0 {
                    edges.push(note);
                    edges.push(other);
                }
            }
        }

        let positions = compute(40, &edges, 1.0);

        assert!(
            closest(&positions) as f64 > MIN_NODE_GAP * 0.9,
            "notes overlap: {}",
            closest(&positions)
        );
    }

    #[test]
    fn a_path_keeps_its_ends_further_apart_than_its_neighbours() {
        let edges = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7];

        let positions = compute(8, &edges, 1.0);

        assert!(distance(&positions, 0, 7) > distance(&positions, 0, 1));
    }

    #[test]
    fn layout_is_reproducible() {
        let edges = [0, 1, 1, 2, 2, 3, 3, 0, 3, 4];

        assert_eq!(compute(6, &edges, 1.0), compute(6, &edges, 1.0));
    }

    #[test]
    fn every_node_receives_a_finite_position() {
        let edges = [0, 1, 1, 2, 5, 6];

        let positions = compute(9, &edges, 1.0);

        assert_eq!(positions.len(), 18);
        assert!(positions.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn disconnected_groups_do_not_overlap_the_core() {
        let edges = [0, 1, 1, 2, 2, 3, 3, 0, 0, 2];

        let positions = compute(6, &edges, 1.0);
        let core = (0..4)
            .map(|node| positions[node * 2].hypot(positions[node * 2 + 1]))
            .fold(0.0f32, f32::max);
        let satellite = positions[8].hypot(positions[9]);

        assert!(satellite > core);
    }

    #[test]
    fn notes_without_links_stay_next_to_the_core() {
        let edges = grid(6);
        let linked = 36;
        let orphans = 200;

        let positions = compute(linked + orphans, &edges, 1.0);
        let core = (0..linked)
            .map(|node| positions[node * 2].hypot(positions[node * 2 + 1]))
            .fold(0.0f32, f32::max);
        let farthest = (linked..linked + orphans)
            .map(|node| positions[node * 2].hypot(positions[node * 2 + 1]))
            .fold(0.0f32, f32::max);

        let mut lonely = 0;
        for node in linked..linked + orphans {
            let closest = (linked..linked + orphans)
                .filter(|other| *other != node)
                .map(|other| distance(&positions, node, other))
                .fold(f32::INFINITY, f32::min);
            if closest > ORPHAN_SPACING as f32 * 2.0 {
                lonely += 1;
            }
        }

        assert!(farthest > core);
        assert!(
            farthest < core + ORPHAN_SPACING as f32 * 10.0,
            "orphans reached {farthest} while the core ends at {core}"
        );
        assert_eq!(
            lonely, 0,
            "some notes without links ended up far from the rest"
        );
    }

    #[test]
    fn small_islands_sit_inside_the_belt_of_lonely_notes() {
        let mut edges = grid(4);
        edges.extend_from_slice(&[16, 17, 18, 19]);
        let total = 60;

        let positions = compute(total, &edges, 1.0);
        let radius = |node: usize| positions[node * 2].hypot(positions[node * 2 + 1]);
        let islands = (16..20).map(radius).sum::<f32>() / 4.0;
        let lonely = (20..total).map(radius).sum::<f32>() / (total - 20) as f32;

        assert!(
            islands < lonely,
            "islands sit at {islands} on average while lonely notes sit at {lonely}"
        );
    }

    #[test]
    fn the_belt_never_lets_two_groups_collide() {
        let mut edges = grid(8);
        let mut next = 64u32;
        for island in 0..9u32 {
            let size = 2 + island % 8;
            for member in 1..size {
                edges.push(next);
                edges.push(next + member);
            }
            next += size;
        }
        let total = next as usize + 120;

        let positions = compute(total, &edges, 1.0);

        assert!(
            closest(&positions) > MIN_NODE_GAP as f32,
            "the belt packed two notes {} apart, closer than the promised {MIN_NODE_GAP}",
            closest(&positions)
        );
    }

    #[test]
    fn an_empty_graph_yields_no_positions() {
        assert!(compute(0, &[], 1.0).is_empty());
    }

    fn grid(side: u32) -> Vec<u32> {
        let mut edges = Vec::new();
        for row in 0..side {
            for column in 0..side {
                let node = row * side + column;
                if column + 1 < side {
                    edges.push(node);
                    edges.push(node + 1);
                }
                if row + 1 < side {
                    edges.push(node);
                    edges.push(node + side);
                }
            }
        }
        edges
    }

    #[test]
    fn a_grid_graph_spreads_in_both_directions() {
        let side = 8;
        let count = (side * side) as usize;

        let positions = compute(count, &grid(side), 1.0);
        let width = extent(&positions, 0);
        let height = extent(&positions, 1);

        assert!(
            width / height < 3.0 && height / width < 3.0,
            "layout collapsed towards a line: {width} by {height}"
        );
    }

    #[test]
    fn no_two_nodes_end_up_on_top_of_each_other() {
        let side = 6;
        let count = (side * side) as usize;

        let positions = compute(count, &grid(side), 1.0);
        let mut closest = f32::INFINITY;
        for left in 0..count {
            for right in (left + 1)..count {
                closest = closest.min(distance(&positions, left, right));
            }
        }

        assert!(closest > 0.3, "nodes are only {closest} apart");
    }

    #[test]
    fn edge_length_is_normalized_regardless_of_graph_size() {
        let small = compute(36, &grid(6), 1.0);
        let large = compute(144, &grid(12), 1.0);

        let small_spacing = median_neighbour_gap(&small, &grid(6));
        let large_spacing = median_neighbour_gap(&large, &grid(12));

        assert!((small_spacing - NODE_SPACING as f32).abs() < 0.2);
        assert!((large_spacing - NODE_SPACING as f32).abs() < 0.2);
    }

    #[test]
    fn repulsion_widens_the_gap_between_neighbours() {
        let edges = grid(6);

        let tight = median_neighbour_gap(&compute(36, &edges, 0.6), &edges);
        let loose = median_neighbour_gap(&compute(36, &edges, 2.5), &edges);

        assert!(loose > tight * 3.0, "{tight} against {loose}");
        assert!(
            tight > 0.5,
            "neighbours must never collapse onto each other: {tight}"
        );
    }

    #[test]
    fn hierarchical_layout_is_deterministic_for_chains_cycles_and_orphans() {
        let edges = [0, 1, 1, 2, 3, 4, 4, 5, 5, 3];
        let options = Options {
            mode: Mode::Hierarchical,
            ..Options::default()
        };
        let first = compute_with_options(8, &edges, options);
        assert_eq!(first, compute_with_options(8, &edges, options));
        assert_eq!(first[0], 0.0);
        assert_eq!(first[1], 0.0);
        assert_eq!(first[3], 1.0);
        assert_eq!(first[5], 2.0);
        assert!(first[12] > first[8]);
        assert!(first[14] > first[12]);
    }

    #[test]
    fn ring_layout_places_all_nodes_on_one_deterministic_ring() {
        let positions = compute_with_options(
            6,
            &[0, 1, 2, 3],
            Options {
                mode: Mode::Ring,
                ..Options::default()
            },
        );
        let radius = positions[0].hypot(positions[1]);
        for pair in positions.chunks_exact(2) {
            assert!((pair[0].hypot(pair[1]) - radius).abs() < 1e-5);
        }
        assert_eq!(
            positions,
            compute_with_options(
                6,
                &[0, 1, 2, 3],
                Options {
                    mode: Mode::Ring,
                    ..Options::default()
                }
            )
        );
    }

    #[test]
    fn default_force_options_preserve_the_original_layout() {
        let edges = [0, 1, 1, 2, 2, 3, 3, 0, 1, 3];
        assert_eq!(
            compute(4, &edges, 1.0),
            compute_with_options(4, &edges, Options::default())
        );
    }

    #[test]
    fn attraction_changes_link_spacing_independently_from_repulsion() {
        let edges = [0, 1, 1, 2, 2, 3, 3, 4];
        let weak = compute_with_options(
            5,
            &edges,
            Options {
                attraction: 0.5,
                ..Options::default()
            },
        );
        let strong = compute_with_options(
            5,
            &edges,
            Options {
                attraction: 2.0,
                ..Options::default()
            },
        );
        let mean_link_length = |positions: &[f32]| {
            edges
                .chunks_exact(2)
                .map(|edge| distance(positions, edge[0] as usize, edge[1] as usize))
                .sum::<f32>()
                / (edges.len() / 2) as f32
        };
        assert_ne!(mean_link_length(&weak), mean_link_length(&strong));
    }

    fn median_neighbour_gap(positions: &[f32], edges: &[u32]) -> f32 {
        let mut lengths = edges
            .chunks_exact(2)
            .map(|pair| distance(positions, pair[0] as usize, pair[1] as usize))
            .collect::<Vec<_>>();
        lengths.sort_by(f32::total_cmp);
        lengths[lengths.len() / 2]
    }

    fn extent(positions: &[f32], axis: usize) -> f32 {
        let values = positions.iter().skip(axis).step_by(2);
        let min = values
            .clone()
            .fold(f32::INFINITY, |left, right| left.min(*right));
        let max = values.fold(f32::NEG_INFINITY, |left, right| left.max(*right));
        (max - min).max(1e-6)
    }
}

#[cfg(test)]
mod repulsion {
    use super::compute;

    fn two_stars() -> Vec<u32> {
        let mut edges = Vec::new();
        for hub in [0u32, 10] {
            for leaf in 1..=9 {
                edges.push(hub);
                edges.push(hub + leaf);
            }
        }
        edges.push(0);
        edges.push(10);
        edges
    }

    fn spread_relative_to_links(strength: f64) -> f32 {
        let edges = two_stars();
        let positions = compute(20, &edges, strength);
        let mut extent = 0.0f32;
        for left in 0..20 {
            for right in (left + 1)..20 {
                let dx = positions[left * 2] - positions[right * 2];
                let dy = positions[left * 2 + 1] - positions[right * 2 + 1];
                extent = extent.max(dx.hypot(dy));
            }
        }
        let mut lengths = edges
            .chunks_exact(2)
            .map(|pair| {
                let dx = positions[pair[0] as usize * 2] - positions[pair[1] as usize * 2];
                let dy = positions[pair[0] as usize * 2 + 1] - positions[pair[1] as usize * 2 + 1];
                dx.hypot(dy)
            })
            .collect::<Vec<_>>();
        lengths.sort_by(f32::total_cmp);
        extent / lengths[lengths.len() / 2]
    }

    #[test]
    fn stronger_repulsion_spreads_the_graph_relative_to_its_links() {
        let weak = spread_relative_to_links(0.2);
        let strong = spread_relative_to_links(1.5);

        assert!(
            strong > weak * 1.1,
            "repulsion has no visible effect: {weak} against {strong}"
        );
    }
}

#[cfg(test)]
mod incremental {
    use super::compute_incremental;
    use std::collections::HashMap;

    #[test]
    fn preserves_existing_coordinates_and_places_only_new_nodes() {
        let paths = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let cached = HashMap::from([
            ("a".to_owned(), (10.0, 11.0)),
            ("b".to_owned(), (20.0, 21.0)),
        ]);

        let positions = compute_incremental(&paths, &[1, 2], 1.0, &cached);

        assert_eq!(&positions[0..2], &[10.0, 11.0]);
        assert_eq!(&positions[2..4], &[20.0, 21.0]);
        assert!(positions[4].is_finite() && positions[5].is_finite());
        assert_ne!(&positions[4..6], &[20.0, 21.0]);
    }

    #[test]
    fn cached_positions_follow_stable_paths_when_node_order_changes() {
        let paths = vec!["b".to_owned(), "a".to_owned()];
        let cached = HashMap::from([
            ("a".to_owned(), (10.0, 11.0)),
            ("b".to_owned(), (20.0, 21.0)),
        ]);

        let positions = compute_incremental(&paths, &[0, 1], 1.0, &cached);

        assert_eq!(&positions[0..2], &[20.0, 21.0]);
        assert_eq!(&positions[2..4], &[10.0, 11.0]);
    }
}
