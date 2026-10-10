export interface GraphEpoch {
  low: number;
  high: number;
}

export interface GraphTopologyDelta {
  baseEpochLow: number;
  baseEpochHigh: number;
  revision: number;
  edgeSlotCount: number;
  edgeCount: number;
  metricsStale: boolean;
  nodeUpdates: Array<{ index: number; degree: number; modifiedDay?: number }>;
  edgeUpdates: Array<{
    slot: number;
    source: number;
    target: number;
    directionMask: number;
    typeMask: number;
  }>;
}

export interface GraphSnapshot {
  nodeCount: number;
  edgeCount: number;
  edgeSlotCount?: number;
  metricsStale?: boolean;
  epoch: GraphEpoch;
  positions: Float32Array;
  createdDays: Float32Array;
  modifiedDays: Float32Array;
  degrees: Uint32Array;
  nodeIds: Uint32Array;
  clusterIds: Uint32Array;
  edges: Uint32Array;
  edgeDirections: Uint32Array;
  edgeTypes: Uint32Array;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function graphBounds(snapshot: GraphSnapshot): GraphBounds {
  if (snapshot.nodeCount === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    const x = snapshot.positions[node * 2];
    const y = snapshot.positions[node * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = Math.max((maxX - minX) * 0.05, 1);
  const padY = Math.max((maxY - minY) * 0.05, 1);
  return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}
