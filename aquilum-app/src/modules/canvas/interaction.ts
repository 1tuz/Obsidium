import type { CanvasEdge, CanvasNode } from './model';

export type CanvasRect = { x: number; y: number; width: number; height: number };
export type CanvasPoint = { x: number; y: number };
export type CanvasEdgeGeometry = { from: CanvasPoint; to: CanvasPoint };
export type CanvasAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';

const snap = (value: number, gridSize?: number): number =>
  gridSize && gridSize > 0 ? Math.round(value / gridSize) * gridSize : Math.round(value);

export const selectCanvasNode = (
  selectedIds: readonly string[],
  nodeId: string,
  shiftKey = false,
): string[] => {
  if (!shiftKey) return [nodeId];
  return selectedIds.includes(nodeId)
    ? selectedIds.filter(id => id !== nodeId)
    : [...selectedIds, nodeId];
};

export const selectCanvasNodesInRect = (
  nodes: readonly CanvasNode[],
  rect: CanvasRect,
  selectedIds: readonly string[] = [],
  additive = false,
): string[] => {
  const left = Math.min(rect.x, rect.x + rect.width);
  const right = Math.max(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const bottom = Math.max(rect.y, rect.y + rect.height);
  const hits = nodes.filter(node =>
    node.x <= right && node.x + node.width >= left && node.y <= bottom && node.y + node.height >= top,
  ).map(node => node.id);
  return additive ? [...new Set([...selectedIds, ...hits])] : hits;
};

export const translateCanvasNodes = <T extends CanvasNode>(
  nodes: readonly T[],
  selectedIds: ReadonlySet<string>,
  delta: CanvasPoint,
  gridSize?: number,
): T[] => nodes.map(node => selectedIds.has(node.id)
  ? { ...node, x: snap(node.x + delta.x, gridSize), y: snap(node.y + delta.y, gridSize) }
  : node);

export const resizeCanvasNode = <T extends CanvasNode>(
  node: T,
  size: { width: number; height: number },
  minWidth = 120,
  minHeight = 80,
  gridSize?: number,
): T => ({
  ...node,
  width: Math.max(minWidth, snap(size.width, gridSize)),
  height: Math.max(minHeight, snap(size.height, gridSize)),
});

type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

const sidePoint = (node: CanvasNode, side: CanvasSide): CanvasPoint => {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y };
  if (side === 'right') return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
};

export const getCanvasGroupMemberIds = (
  group: CanvasNode,
  nodes: readonly CanvasNode[],
): string[] => nodes.filter(node => node.id !== group.id
  && node.x >= group.x
  && node.y >= group.y
  && node.x + node.width <= group.x + group.width
  && node.y + node.height <= group.y + group.height)
  .map(node => node.id);

export const alignCanvasNodes = <T extends CanvasNode>(
  nodes: readonly T[],
  selectedIds: ReadonlySet<string>,
  alignment: CanvasAlignment,
): T[] => {
  const selected = nodes.filter(node => selectedIds.has(node.id));
  if (selected.length < 2) return [...nodes];
  const left = Math.min(...selected.map(node => node.x));
  const top = Math.min(...selected.map(node => node.y));
  const right = Math.max(...selected.map(node => node.x + node.width));
  const bottom = Math.max(...selected.map(node => node.y + node.height));
  return nodes.map(node => {
    if (!selectedIds.has(node.id)) return node;
    if (alignment === 'left') return { ...node, x: left };
    if (alignment === 'center-x') return { ...node, x: Math.round((left + right - node.width) / 2) };
    if (alignment === 'right') return { ...node, x: right - node.width };
    if (alignment === 'top') return { ...node, y: top };
    if (alignment === 'center-y') return { ...node, y: Math.round((top + bottom - node.height) / 2) };
    return { ...node, y: bottom - node.height };
  });
};

const connectedSide = (from: CanvasNode, to: CanvasNode): CanvasSide => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
};

const isSide = (value: unknown): value is CanvasSide =>
  value === 'top' || value === 'right' || value === 'bottom' || value === 'left';

export const getCanvasEdgeGeometry = (
  edge: CanvasEdge,
  nodes: readonly CanvasNode[] | ReadonlyMap<string, CanvasNode>,
): CanvasEdgeGeometry | null => {
  const findNode = Array.isArray(nodes)
    ? (id: string) => nodes.find(node => node.id === id)
    : (id: string) => (nodes as ReadonlyMap<string, CanvasNode>).get(id);
  const from = findNode(edge.fromNode);
  const to = findNode(edge.toNode);
  if (!from || !to) return null;
  const fromSide = isSide(edge.fromSide) ? edge.fromSide : connectedSide(from, to);
  const toSide = isSide(edge.toSide) ? edge.toSide : connectedSide(to, from);
  return { from: sidePoint(from, fromSide), to: sidePoint(to, toSide) };
};

export type CanvasHistory<T> = {
  current: T;
  past: T[];
  future: T[];
  limit: number;
};

export const createCanvasHistory = <T>(current: T, limit = 100): CanvasHistory<T> => ({
  current,
  past: [],
  future: [],
  limit: Math.max(0, limit),
});

export const commitCanvasHistory = <T>(history: CanvasHistory<T>, next: T): CanvasHistory<T> => {
  if (Object.is(history.current, next)) return history;
  const past = history.limit ? [...history.past, history.current].slice(-history.limit) : [];
  return { ...history, current: next, past, future: [] };
};

export const undoCanvasHistory = <T>(history: CanvasHistory<T>): CanvasHistory<T> => {
  if (!history.past.length) return history;
  return {
    ...history,
    current: history.past[history.past.length - 1],
    past: history.past.slice(0, -1),
    future: [history.current, ...history.future],
  };
};

export const redoCanvasHistory = <T>(history: CanvasHistory<T>): CanvasHistory<T> => {
  if (!history.future.length) return history;
  return {
    ...history,
    current: history.future[0],
    past: history.limit ? [...history.past, history.current].slice(-history.limit) : [],
    future: history.future.slice(1),
  };
};
