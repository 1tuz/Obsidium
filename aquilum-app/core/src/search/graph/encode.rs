use super::snapshot::RenderSnapshot;

const HEADER_BYTES: usize = 16;

pub fn encode(snapshot: &RenderSnapshot, epoch: u64) -> Vec<u8> {
    let nodes = snapshot.node_count();
    let edges = snapshot.edge_count();
    let mut bytes = Vec::with_capacity(HEADER_BYTES + nodes * 32 + edges * 16);
    bytes.extend_from_slice(&(nodes as u32).to_le_bytes());
    bytes.extend_from_slice(&(edges as u32).to_le_bytes());
    bytes.extend_from_slice(&((epoch & 0xffff_ffff) as u32).to_le_bytes());
    bytes.extend_from_slice(&((epoch >> 32) as u32).to_le_bytes());
    for value in &snapshot.positions {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.created_days {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.modified_days {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.degrees {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.node_ids {
        bytes.extend_from_slice(&(*value as u32).to_le_bytes());
        bytes.extend_from_slice(&((*value >> 32) as u32).to_le_bytes());
    }
    for value in &snapshot.cluster_ids {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.edges {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.edge_directions {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in &snapshot.edge_types {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::{encode, HEADER_BYTES};
    use crate::search::graph::snapshot::RenderSnapshot;

    fn snapshot() -> RenderSnapshot {
        RenderSnapshot {
            paths: vec!["a".to_owned(), "b".to_owned()],
            node_ids: vec![1, 2],
            cluster_ids: vec![4, 5],
            positions: vec![1.0, 2.0, 3.0, 4.0],
            created_days: vec![10.0, 11.0],
            modified_days: vec![12.0, 13.0],
            degrees: vec![1, 1],
            edges: vec![0, 1],
            edge_directions: vec![129],
            edge_types: vec![5],
        }
    }

    #[test]
    fn every_section_lands_at_a_four_byte_boundary() {
        let bytes = encode(&snapshot(), 1);

        assert_eq!(HEADER_BYTES % 4, 0);
        assert_eq!(bytes.len() % 4, 0);
        assert_eq!(bytes.len(), HEADER_BYTES + 2 * 32 + 16);
    }

    #[test]
    fn header_carries_the_counts() {
        let bytes = encode(&snapshot(), 1);

        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 1);
    }

    #[test]
    fn header_carries_the_epoch_in_two_halves() {
        let epoch = 0x0000_0007_dead_beefu64;
        let bytes = encode(&snapshot(), epoch);
        let low = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as u64;
        let high = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as u64;

        assert_eq!(low | (high << 32), epoch);
    }

    #[test]
    fn positions_follow_the_header_in_order() {
        let bytes = encode(&snapshot(), 1);

        assert_eq!(
            f32::from_le_bytes(bytes[HEADER_BYTES..HEADER_BYTES + 4].try_into().unwrap()),
            1.0
        );
        assert_eq!(
            f32::from_le_bytes(
                bytes[HEADER_BYTES + 4..HEADER_BYTES + 8]
                    .try_into()
                    .unwrap()
            ),
            2.0
        );
    }

    #[test]
    fn direction_masks_follow_the_edge_section() {
        let bytes = encode(&snapshot(), 1);
        let offset = HEADER_BYTES + 2 * 32 + 8;

        assert_eq!(
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
            129
        );
    }

    #[test]
    fn type_masks_follow_direction_masks() {
        let bytes = encode(&snapshot(), 1);
        let offset = HEADER_BYTES + 2 * 32 + 12;

        assert_eq!(
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
            5
        );
    }

    #[test]
    fn cluster_ids_follow_stable_node_ids() {
        let bytes = encode(&snapshot(), 1);
        let offset = HEADER_BYTES + 2 * 28;

        assert_eq!(
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
            4
        );
        assert_eq!(
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()),
            5
        );
    }
}
