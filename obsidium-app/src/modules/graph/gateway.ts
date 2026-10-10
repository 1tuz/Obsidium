import { invoke } from '@tauri-apps/api/core';
import type { GraphEpoch, GraphSnapshot, GraphTopologyDelta } from './types';

export interface GraphPositionUpdate {
  index: number;
  x: number;
  y: number;
}

export interface GraphModifiedDateUpdate {
  index: number;
  modifiedDay: number;
}

export interface GraphModifiedDateDelta {
  baseEpochLow: number;
  baseEpochHigh: number;
  revision: number;
  modifiedNewest: number;
  updates: GraphModifiedDateUpdate[];
}

export interface GraphLayoutOptions {
  layoutMode: 'force' | 'hierarchical' | 'ring';
  attraction: number;
  repulsion: number;
}

export interface GraphTimelineRange {
  baselineEvent: number;
  baselineAtNs: number;
  latestEvent: number;
}

export interface GraphTimelineEvent {
  eventId: number;
  atNs: number;
}

const DEFAULT_LAYOUT_OPTIONS: GraphLayoutOptions = {
  layoutMode: 'force',
  attraction: 1,
  repulsion: 1,
};

const HEADER_BYTES = 16;
const MAX_GRAPH_DAY = 110_000;

export async function loadGraphSnapshot(
  workspacePath: string,
  options: GraphLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<GraphSnapshot> {
  const response = await invoke<ArrayBuffer | Uint8Array>('get_graph_snapshot', {
    workspacePath,
    ...options,
  });
  return decodeGraphSnapshot(toArrayBuffer(response));
}

export async function loadGraphModifiedDateDelta(
  workspacePath: string,
  epoch: GraphEpoch,
  sinceRevision: number,
  options: GraphLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<GraphModifiedDateDelta | null> {
  if (!isUint32(epoch.low) || !isUint32(epoch.high)
    || !Number.isSafeInteger(sinceRevision) || sinceRevision < 0) return null;
  const response = await invoke<unknown>('get_graph_modified_date_delta', {
    workspacePath,
    baseEpochLow: epoch.low,
    baseEpochHigh: epoch.high,
    sinceRevision,
    ...options,
  });
  if (response === null) return null;
  if (!isGraphModifiedDateDelta(response, sinceRevision)) return null;
  return response;
}

export async function loadGraphTopologyDelta(
  workspacePath: string,
  epoch: GraphEpoch,
  sinceRevision: number,
  options: GraphLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<GraphTopologyDelta | null> {
  if (!isUint32(epoch.low) || !isUint32(epoch.high)
    || !Number.isSafeInteger(sinceRevision) || sinceRevision < 0) return null;
  const response = await invoke<unknown>('get_graph_topology_delta', {
    workspacePath,
    baseEpochLow: epoch.low,
    baseEpochHigh: epoch.high,
    sinceRevision,
    ...options,
  });
  if (!isGraphTopologyDelta(response, sinceRevision)) return null;
  return response;
}

function isGraphTopologyDelta(value: unknown, sinceRevision: number): value is GraphTopologyDelta {
  if (typeof value !== 'object' || value === null) return false;
  const delta = value as Partial<GraphTopologyDelta>;
  return isUint32(delta.baseEpochLow)
    && isUint32(delta.baseEpochHigh)
    && Number.isSafeInteger(delta.revision)
    && delta.revision! > sinceRevision
    && isUint32(delta.edgeSlotCount)
    && isUint32(delta.edgeCount)
    && delta.edgeCount! <= delta.edgeSlotCount!
    && typeof delta.metricsStale === 'boolean'
    && Array.isArray(delta.nodeUpdates)
    && delta.nodeUpdates.every((update) => typeof update === 'object'
      && update !== null
      && isUint32((update as GraphTopologyDelta['nodeUpdates'][number]).index)
      && isUint32((update as GraphTopologyDelta['nodeUpdates'][number]).degree)
      && ((update as GraphTopologyDelta['nodeUpdates'][number]).modifiedDay === undefined
        || isGraphDay((update as GraphTopologyDelta['nodeUpdates'][number]).modifiedDay)))
    && Array.isArray(delta.edgeUpdates)
    && delta.edgeUpdates.every((update) => typeof update === 'object'
      && update !== null
      && isUint32((update as GraphTopologyDelta['edgeUpdates'][number]).slot)
      && (update as GraphTopologyDelta['edgeUpdates'][number]).slot < delta.edgeSlotCount!
      && isUint32((update as GraphTopologyDelta['edgeUpdates'][number]).source)
      && isUint32((update as GraphTopologyDelta['edgeUpdates'][number]).target)
      && isUint32((update as GraphTopologyDelta['edgeUpdates'][number]).directionMask)
      && isUint32((update as GraphTopologyDelta['edgeUpdates'][number]).typeMask)
      && ((update as GraphTopologyDelta['edgeUpdates'][number]).typeMask !== 0
        || (update as GraphTopologyDelta['edgeUpdates'][number]).directionMask === 0));
}

function isGraphModifiedDateDelta(value: unknown, sinceRevision: number): value is GraphModifiedDateDelta {
  if (typeof value !== 'object' || value === null) return false;
  const delta = value as Partial<GraphModifiedDateDelta>;
  return isUint32(delta.baseEpochLow)
    && isUint32(delta.baseEpochHigh)
    && Number.isSafeInteger(delta.revision)
    && delta.revision! > sinceRevision
    && isGraphDay(delta.modifiedNewest)
    && Array.isArray(delta.updates)
    && delta.updates.every((update) => typeof update === 'object'
      && update !== null
      && isUint32((update as GraphModifiedDateUpdate).index)
      && isGraphDay((update as GraphModifiedDateUpdate).modifiedDay));
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isGraphDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_GRAPH_DAY;
}

export function loadGraphTimelineRange(workspacePath: string): Promise<GraphTimelineRange> {
  return invoke<GraphTimelineRange>('get_graph_timeline_range', { workspacePath });
}

export function loadGraphTimelineEvents(
  workspacePath: string,
  afterEvent: number,
  limit = 500,
): Promise<GraphTimelineEvent[]> {
  return invoke<GraphTimelineEvent[]>('get_graph_timeline_events', {
    workspacePath,
    afterEvent,
    limit,
  });
}

export async function loadGraphTimelineEventsThrough(
  workspacePath: string,
  afterEvent: number,
  latestEvent: number,
  isActive: () => boolean,
): Promise<GraphTimelineEvent[]> {
  const events: GraphTimelineEvent[] = [];
  let cursor = afterEvent;
  while (cursor < latestEvent && isActive()) {
    const page = await loadGraphTimelineEvents(workspacePath, cursor, 500);
    if (!isActive() || page.length === 0) break;
    const latestPageEvent = page[page.length - 1].eventId;
    if (latestPageEvent <= cursor) throw new Error('Graph timeline cursor did not advance');
    events.push(...page);
    cursor = latestPageEvent;
    if (page.length < 500) break;
  }
  return events;
}

export async function loadGraphTimelineSnapshot(
  workspacePath: string,
  eventId: number,
  options: GraphLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<GraphSnapshot> {
  const response = await invoke<ArrayBuffer | Uint8Array>('get_graph_timeline_snapshot', {
    workspacePath,
    eventId,
    ...options,
  });
  return decodeGraphSnapshot(toArrayBuffer(response));
}

export function loadGraphPaths(epoch: GraphEpoch, indices: number[]): Promise<string[]> {
  return invoke<string[]>('get_graph_paths', {
    epochLow: epoch.low,
    epochHigh: epoch.high,
    indices,
  });
}

export function loadGraphFilterNodes(
  workspacePath: string,
  epoch: GraphEpoch,
  filter: { folder: string; tag: string; propertyKey: string; propertyValue: string },
): Promise<number[]> {
  return invoke<number[]>('get_graph_filter_nodes', {
    workspacePath,
    epochLow: epoch.low,
    epochHigh: epoch.high,
    folder: filter.folder || null,
    tag: filter.tag || null,
    propertyKey: filter.propertyKey || null,
    propertyValue: filter.propertyValue || null,
  });
}

export function loadGraphClusterIds(
  workspacePath: string,
  epoch: GraphEpoch,
  resolution: number,
): Promise<number[]> {
  return invoke<number[]>('get_graph_cluster_ids', {
    workspacePath,
    epochLow: epoch.low,
    epochHigh: epoch.high,
    resolution,
  });
}

export function saveGraphPositions(
  workspacePath: string,
  epoch: GraphEpoch,
  updates: GraphPositionUpdate[],
  options: GraphLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<void> {
  return invoke<void>('set_graph_positions', {
    workspacePath,
    epochLow: epoch.low,
    epochHigh: epoch.high,
    updates,
    ...options,
  });
}

export function decodeGraphSnapshot(buffer: ArrayBuffer): GraphSnapshot {
  const header = new DataView(buffer);
  const nodeCount = header.getUint32(0, true);
  const edgeCount = header.getUint32(4, true);
  const epoch = {
    low: header.getUint32(8, true),
    high: header.getUint32(12, true),
  };

  let offset = HEADER_BYTES;
  const positions = new Float32Array(buffer, offset, nodeCount * 2);
  offset += nodeCount * 8;
  const createdDays = new Float32Array(buffer, offset, nodeCount);
  offset += nodeCount * 4;
  const modifiedDays = new Float32Array(buffer, offset, nodeCount);
  offset += nodeCount * 4;
  const degrees = new Uint32Array(buffer, offset, nodeCount);
  offset += nodeCount * 4;
  const nodeIds = new Uint32Array(buffer, offset, nodeCount * 2);
  offset += nodeCount * 8;
  const clusterIds = new Uint32Array(buffer, offset, nodeCount);
  offset += nodeCount * 4;
  const edges = new Uint32Array(buffer, offset, edgeCount * 2);
  offset += edgeCount * 8;
  const edgeDirections = new Uint32Array(buffer, offset, edgeCount);
  offset += edgeCount * 4;
  const edgeTypes = new Uint32Array(buffer, offset, edgeCount);

  return {
    nodeCount,
    edgeCount,
    epoch,
    positions,
    createdDays,
    modifiedDays,
    degrees,
    nodeIds,
    clusterIds,
    edges,
    edgeDirections,
    edgeTypes,
  };
}

function toArrayBuffer(response: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (response instanceof ArrayBuffer) return response;
  if (response.byteOffset === 0 && response.byteLength === response.buffer.byteLength) {
    return response.buffer as ArrayBuffer;
  }
  return response.slice().buffer;
}
