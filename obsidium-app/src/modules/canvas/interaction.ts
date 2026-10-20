import type { CanvasEdge, CanvasNode } from './model';

export type CanvasRect = { x: number; y: number; width: number; height: number };
export type CanvasPoint = { x: number; y: number };
export type CanvasEdgeGeometry = { from: CanvasPoint; to: CanvasPoint };
export type CanvasResizeHandle = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';
export type CanvasEdgeRoute = 'straight' | 'elbow' | 'curved';
export type CanvasAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';

export const canvasRectBetweenPoints = (start: CanvasPoint, end: CanvasPoint): CanvasRect => {
  const left = Math.round(Math.min(start.x, end.x));
  const top = Math.round(Math.min(start.y, end.y));
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.round(Math.max(start.x, end.x)) - left),
    height: Math.max(1, Math.round(Math.max(start.y, end.y)) - top),
  };
};

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

export const resizeCanvasNodeFromHandle = <T extends CanvasNode>(
  node: T,
  handle: CanvasResizeHandle,
  delta: CanvasPoint,
  lockAspectRatio = false,
  minWidth = 120,
  minHeight = 80,
  gridSize?: number,
): T => {
  const west = handle.includes('left');
  const east = handle.includes('right');
  const north = handle.includes('top');
  const south = handle.includes('bottom');
  let width = east || west ? Math.max(minWidth, node.width + (east ? delta.x : -delta.x)) : node.width;
  let height = south || north ? Math.max(minHeight, node.height + (south ? delta.y : -delta.y)) : node.height;
  if (lockAspectRatio) {
    const widthScale = width / node.width;
    const heightScale = height / node.height;
    const corner = (west || east) && (north || south);
    const scale = corner
      ? Math.abs(widthScale - 1) > Math.abs(heightScale - 1) ? widthScale : heightScale
      : west || east ? widthScale : heightScale;
    width = Math.max(minWidth, node.width * scale);
    height = Math.max(minHeight, node.height * scale);
  }
  width = west || east || lockAspectRatio ? Math.max(minWidth, snap(width, gridSize)) : node.width;
  height = north || south || lockAspectRatio ? Math.max(minHeight, snap(height, gridSize)) : node.height;
  return {
    ...node,
    x: west ? node.x + node.width - width : lockAspectRatio && !north && !south ? node.x - (width - node.width) / 2 : node.x,
    y: north ? node.y + node.height - height : lockAspectRatio && !west && !east ? node.y - (height - node.height) / 2 : node.y,
    width,
    height,
  };
};

export const getCanvasEdgePath = (
  geometry: CanvasEdgeGeometry,
  route: CanvasEdgeRoute = 'straight',
  bend: CanvasPoint = { x: 0, y: 0 },
): string => {
  const { from, to } = geometry;
  if (route === 'elbow') {
    const middleX = Math.round((from.x + to.x) / 2 + bend.x);
    return `M ${from.x} ${from.y} L ${middleX} ${from.y} L ${middleX} ${to.y} L ${to.x} ${to.y}`;
  }
  if (route === 'curved') {
    const controlX = Math.round((from.x + to.x) / 2 + bend.x);
    const controlY = Math.round((from.y + to.y) / 2 + bend.y);
    return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
};

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

export const canvasSidePoint = (node: CanvasNode, side: CanvasSide): CanvasPoint => {
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

export const expandCanvasSelection = (
  ids: readonly string[],
  nodes: readonly CanvasNode[],
): string[] => {
  const expanded = new Set(ids);
  for (const id of ids) {
    const node = nodes.find((item) => item.id === id);
    if (!node) continue;
    if (node.type === 'group') {
      for (const memberId of getCanvasGroupMemberIds(node, nodes)) expanded.add(memberId);
    }
    for (const group of nodes) {
      if (group.type !== 'group' || group.id === node.id) continue;
      if (node.x < group.x || node.y < group.y
        || node.x + node.width > group.x + group.width
        || node.y + node.height > group.y + group.height) continue;
      expanded.add(group.id);
      for (const memberId of getCanvasGroupMemberIds(group, nodes)) expanded.add(memberId);
    }
  }
  return nodes.filter((node) => expanded.has(node.id)).map((node) => node.id);
};

export const resizeCanvasGroup = <T extends CanvasNode>(
  group: CanvasNode,
  members: readonly T[],
  resized: CanvasNode,
): T[] => {
  const scaleX = group.width > 0 ? resized.width / group.width : 1;
  const scaleY = group.height > 0 ? resized.height / group.height : 1;
  return members.map((member) => {
    if (member.x < group.x || member.y < group.y
      || member.x + member.width > group.x + group.width
      || member.y + member.height > group.y + group.height) return member;
    return {
      ...member,
      x: Math.round(resized.x + (member.x - group.x) * scaleX),
      y: Math.round(resized.y + (member.y - group.y) * scaleY),
      width: Math.max(24, Math.round(member.width * scaleX)),
      height: Math.max(24, Math.round(member.height * scaleY)),
    };
  });
};

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

export const canvasEdgeSides = (from: CanvasNode, to: CanvasNode): { fromSide: CanvasSide; toSide: CanvasSide } => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const horizontal = Math.abs(dx) > Math.abs(dy);
  return {
    fromSide: horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top'),
    toSide: horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom'),
  };
};

export const canvasNodeAtPoint = <T extends CanvasNode>(
  nodes: readonly T[],
  point: CanvasPoint,
  excludeId?: string,
): T | null => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.type === 'group' || node.id === excludeId) continue;
    if (point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height) {
      return node;
    }
  }
  return null;
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
  const sides = canvasEdgeSides(from, to);
  const fromSide = isSide(edge.fromSide) ? edge.fromSide : sides.fromSide;
  const toSide = isSide(edge.toSide) ? edge.toSide : sides.toSide;
  return { from: canvasSidePoint(from, fromSide), to: canvasSidePoint(to, toSide) };
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
