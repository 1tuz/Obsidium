export type JsonObject = Record<string, unknown>;

export interface CanvasNodeBase extends JsonObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: 'text';
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: 'file';
  file: string;
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: 'link';
  url: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode | CanvasNodeBase;

export interface CanvasEdge extends JsonObject {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
}

export type CanvasDrawingKind = 'rectangle' | 'ellipse' | 'arrow' | 'freehand' | 'highlighter';

export interface CanvasDrawing {
  id: string;
  kind: CanvasDrawingKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: number[];
  strokeWidth?: number;
  opacity?: number;
}

export interface ObsidiumCanvasExtension extends JsonObject {
  drawings?: CanvasDrawing[];
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  obsidium: ObsidiumCanvasExtension;
  extra: JsonObject;
}

const EMPTY_CANVAS: CanvasDocument = {
  nodes: [],
  edges: [],
  obsidium: {},
  extra: {},
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validNode(value: unknown): CanvasNode | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return null;
  return {
    ...value,
    id: value.id,
    type: value.type,
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width: Math.max(40, finite(value.width, 260)),
    height: Math.max(30, finite(value.height, 140)),
  } as CanvasNode;
}

function validEdge(value: unknown): CanvasEdge | null {
  if (!isObject(value)
    || typeof value.id !== 'string'
    || typeof value.fromNode !== 'string'
    || typeof value.toNode !== 'string') return null;
  return value as CanvasEdge;
}

function validDrawing(value: unknown): CanvasDrawing | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') return null;
  if (!['rectangle', 'ellipse', 'arrow', 'freehand', 'highlighter'].includes(value.kind)) return null;
  const points = Array.isArray(value.points)
    ? value.points.filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
    : undefined;
  return {
    id: value.id,
    kind: value.kind as CanvasDrawingKind,
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width: Math.max(1, finite(value.width, 1)),
    height: Math.max(1, finite(value.height, 1)),
    points,
    strokeWidth: Math.max(1, finite(value.strokeWidth, value.kind === 'highlighter' ? 18 : 3)),
    opacity: Math.min(1, Math.max(0.05, finite(value.opacity, value.kind === 'highlighter' ? 0.28 : 1))),
  };
}

export function parseCanvas(source: string): CanvasDocument {
  if (!source.trim()) return structuredClone(EMPTY_CANVAS);
  const parsed = JSON.parse(source) as unknown;
  if (!isObject(parsed)) throw new Error('Canvas root must be an object');
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.map(validNode).filter(Boolean) as CanvasNode[] : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges.map(validEdge).filter(Boolean) as CanvasEdge[] : [];
  const obsidiumRaw = isObject(parsed.obsidium) ? parsed.obsidium : {};
  const drawings = Array.isArray(obsidiumRaw.drawings)
    ? obsidiumRaw.drawings.map(validDrawing).filter(Boolean) as CanvasDrawing[]
    : [];
  const { nodes: _nodes, edges: _edges, obsidium: _obsidium, ...extra } = parsed;
  return {
    nodes,
    edges,
    obsidium: { ...obsidiumRaw, drawings },
    extra,
  };
}

export function serializeCanvas(document: CanvasDocument): string {
  const payload: JsonObject = {
    ...document.extra,
    nodes: document.nodes,
    edges: document.edges,
  };
  const drawings = document.obsidium.drawings ?? [];
  const otherExtension = Object.keys(document.obsidium).some((key) => key !== 'drawings');
  if (drawings.length > 0 || otherExtension) {
    payload.obsidium = { ...document.obsidium, drawings };
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function updateNode(
  document: CanvasDocument,
  id: string,
  patch: Partial<CanvasNode>,
): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === id ? { ...node, ...patch } as CanvasNode : node),
  };
}

export function removeNode(document: CanvasDocument, id: string): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.filter((node) => node.id !== id),
    edges: document.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id),
  };
}

export function addNode(document: CanvasDocument, node: CanvasNode): CanvasDocument {
  return { ...document, nodes: [...document.nodes, node] };
}

export function addEdge(document: CanvasDocument, edge: CanvasEdge): CanvasDocument {
  if (!document.nodes.some((node) => node.id === edge.fromNode)
    || !document.nodes.some((node) => node.id === edge.toNode)) return document;
  return { ...document, edges: [...document.edges, edge] };
}

export function addDrawing(document: CanvasDocument, drawing: CanvasDrawing): CanvasDocument {
  return {
    ...document,
    obsidium: {
      ...document.obsidium,
      drawings: [...(document.obsidium.drawings ?? []), drawing],
    },
  };
}

export function removeDrawing(document: CanvasDocument, id: string): CanvasDocument {
  return {
    ...document,
    obsidium: {
      ...document.obsidium,
      drawings: (document.obsidium.drawings ?? []).filter((drawing) => drawing.id !== id),
    },
  };
}

export function emptyCanvas(): CanvasDocument {
  return structuredClone(EMPTY_CANVAS);
}
