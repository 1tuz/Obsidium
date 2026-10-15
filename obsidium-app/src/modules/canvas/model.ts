export type CanvasNodeType = 'text' | 'file' | 'link' | 'group';

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
};

export type CanvasTextNode = CanvasNode & { type: 'text'; text: string };
export type CanvasFileNode = CanvasNode & { type: 'file'; file: string };
export type CanvasLinkNode = CanvasNode & { type: 'link'; url: string };
export type CanvasGroupNode = CanvasNode & { type: 'group'; label?: string };
export type CanvasTypedNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;
export type CanvasPoint = { x: number; y: number };

export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  [key: string]: unknown;
};

export type CanvasDocument = {
  nodes: CanvasTypedNode[];
  edges: CanvasEdge[];
  obsidium?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CanvasParseResult =
  | { ok: true; value: CanvasDocument }
  | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCanvasColor = (value: unknown): boolean => value === undefined
  || (typeof value === 'string' && (/^[1-6]$/.test(value) || /^#[\da-f]{3,8}$/i.test(value)));

const validateCanvasColor = (value: unknown, name: string): string | null =>
  isCanvasColor(value) ? null : `${name} must be a JSON Canvas preset or hex color`;

const validateNode = (value: unknown, index: number): string | null => {
  if (!isRecord(value)) return `nodes[${index}] must be an object`;
  if (typeof value.id !== 'string' || !value.id) return `nodes[${index}].id must be a non-empty string`;
  if (!['text', 'file', 'link', 'group'].includes(String(value.type))) {
    return `nodes[${index}].type must be text, file, link, or group`;
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return `nodes[${index}].${key} must be a finite number`;
  }
  if ((value.width as number) <= 0 || (value.height as number) <= 0) return `nodes[${index}] dimensions must be positive`;
  const colorError = validateCanvasColor(value.color, `nodes[${index}].color`);
  if (colorError) return colorError;
  if (value.type === 'text' && typeof value.text !== 'string') return `nodes[${index}].text must be a string`;
  if (value.type === 'file' && typeof value.file !== 'string') return `nodes[${index}].file must be a string`;
  if (value.type === 'link' && typeof value.url !== 'string') return `nodes[${index}].url must be a string`;
  if (value.type === 'group' && value.label !== undefined && typeof value.label !== 'string') {
    return `nodes[${index}].label must be a string`;
  }
  return null;
};

const validateEdge = (value: unknown, index: number): string | null => {
  if (!isRecord(value)) return `edges[${index}] must be an object`;
  for (const key of ['id', 'fromNode', 'toNode']) {
    if (typeof value[key] !== 'string' || !value[key]) return `edges[${index}].${key} must be a non-empty string`;
  }
  for (const key of ['fromSide', 'toSide']) {
    if (value[key] !== undefined && !['top', 'right', 'bottom', 'left'].includes(String(value[key]))) {
      return `edges[${index}].${key} is invalid`;
    }
  }
  for (const key of ['fromEnd', 'toEnd']) {
    if (value[key] !== undefined && !['none', 'arrow'].includes(String(value[key]))) {
      return `edges[${index}].${key} is invalid`;
    }
  }
  const colorError = validateCanvasColor(value.color, `edges[${index}].color`);
  if (colorError) return colorError;
  return null;
};

export const parseCanvasDocument = (source: string): CanvasParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, error: 'Canvas document must be an object' };
  if (parsed.nodes !== undefined && !Array.isArray(parsed.nodes)) return { ok: false, error: 'Canvas document nodes must be an array' };
  if (parsed.edges !== undefined && !Array.isArray(parsed.edges)) return { ok: false, error: 'Canvas document edges must be an array' };
  const nodes = (parsed.nodes ?? []) as unknown[];
  const edges = (parsed.edges ?? []) as unknown[];
  const ids = new Set<string>();
  const nodeIds = new Set<string>();
  for (let index = 0; index < nodes.length; index += 1) {
    const error = validateNode(nodes[index], index);
    if (error) return { ok: false, error };
    const id = (nodes[index] as Record<string, unknown>).id as string;
    if (ids.has(id)) return { ok: false, error: `Duplicate Canvas id: ${id}` };
    ids.add(id);
    nodeIds.add(id);
  }
  for (let index = 0; index < edges.length; index += 1) {
    const error = validateEdge(edges[index], index);
    if (error) return { ok: false, error };
    const edge = edges[index] as Record<string, unknown>;
    const id = edge.id as string;
    if (ids.has(id)) return { ok: false, error: `Duplicate Canvas id: ${id}` };
    if (!nodeIds.has(edge.fromNode as string) || !nodeIds.has(edge.toNode as string)) {
      return { ok: false, error: `edges[${index}] references an unknown node` };
    }
    ids.add(id);
  }
  if (parsed.obsidium !== undefined && !isRecord(parsed.obsidium)) {
    return { ok: false, error: 'Canvas document obsidium extension must be an object' };
  }
  return { ok: true, value: { ...parsed, nodes: nodes as CanvasTypedNode[], edges: edges as CanvasEdge[] } as CanvasDocument };
};

export const serializeCanvasDocument = (document: CanvasDocument): string => JSON.stringify(document, null, 2);

export function createCanvasFreehandNode(id: string, points: readonly CanvasPoint[]): CanvasTextNode {
  const first = points[0] ?? { x: 0, y: 0 };
  const bounds = points.reduce((value, point) => ({
    left: Math.min(value.left, point.x),
    top: Math.min(value.top, point.y),
    right: Math.max(value.right, point.x),
    bottom: Math.max(value.bottom, point.y),
  }), { left: first.x, top: first.y, right: first.x, bottom: first.y });
  const left = Math.floor(bounds.left) - 8;
  const top = Math.floor(bounds.top) - 8;
  const right = Math.ceil(bounds.right) + 8;
  const bottom = Math.ceil(bounds.bottom) + 8;
  return {
    id,
    type: 'text',
    x: left,
    y: top,
    width: Math.max(16, right - left),
    height: Math.max(16, bottom - top),
    text: '',
    obsidium: {
      shape: 'freehand',
      points: points.map((point) => ({ x: Math.round(point.x - left), y: Math.round(point.y - top) })),
    },
  };
}

export function canvasFreehandPoints(node: CanvasTypedNode): CanvasPoint[] {
  const obsidium = node.obsidium;
  if (!isRecord(obsidium) || obsidium.shape !== 'freehand' || !Array.isArray(obsidium.points)) return [];
  return obsidium.points.filter((point): point is CanvasPoint => isRecord(point)
    && typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y));
}

export const addCanvasNode = (document: CanvasDocument, node: CanvasTypedNode): CanvasDocument => ({
  ...document,
  nodes: [...document.nodes, node],
});

export const updateCanvasNode = (
  document: CanvasDocument,
  id: string,
  update: Partial<CanvasTypedNode>,
): CanvasDocument => ({
  ...document,
  nodes: document.nodes.map(node => node.id === id ? { ...node, ...update } as CanvasTypedNode : node),
});

export const removeCanvasNode = (document: CanvasDocument, id: string): CanvasDocument => ({
  ...document,
  nodes: document.nodes.filter(node => node.id !== id),
  edges: document.edges.filter(edge => edge.fromNode !== id && edge.toNode !== id),
});

export const duplicateCanvasNode = (
  document: CanvasDocument,
  id: string,
  newId: string,
  offset = 20,
): CanvasDocument => {
  const node = document.nodes.find(candidate => candidate.id === id);
  return node ? addCanvasNode(document, { ...node, id: newId, x: node.x + offset, y: node.y + offset }) : document;
};

export const addCanvasEdge = (document: CanvasDocument, edge: CanvasEdge): CanvasDocument => ({
  ...document,
  edges: [...document.edges, edge],
});

export const updateCanvasEdge = (
  document: CanvasDocument,
  id: string,
  update: Partial<CanvasEdge>,
): CanvasDocument => ({
  ...document,
  edges: document.edges.map(edge => edge.id === id ? { ...edge, ...update } : edge),
});

export const removeCanvasEdge = (document: CanvasDocument, id: string): CanvasDocument => ({
  ...document,
  edges: document.edges.filter(edge => edge.id !== id),
});
