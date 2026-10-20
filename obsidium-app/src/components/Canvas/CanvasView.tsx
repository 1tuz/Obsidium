import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TargetedDragEvent, TargetedKeyboardEvent, TargetedMouseEvent, TargetedPointerEvent } from 'preact';
import { t } from '../../i18n';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { absolutePath, fileName, parentDirectory, relativePath, resolveNotePath, samePath } from '../../modules/paths';
import { splitNoteLink, type CanvasNoteSource, type CanvasNoteTarget } from './canvasNoteLinks';
import { openExternalUrl } from '../../modules/openExternalUrl';
import { isCanvasPath, isFileCommandError, isMarkdownPath, readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { createUniqueFile } from '../../modules/documents/documentFactory';
import { registerCanvasFlush } from '../../modules/canvas/persistence';
import {
  addCanvasEdge,
  addCanvasNode,
  canvasFreehandPoints,
  createCanvasFreehandNode,
  parseCanvasDocument,
  removeCanvasEdge,
  removeCanvasNode,
  serializeCanvasDocument,
  updateCanvasEdge,
  updateCanvasNode,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPoint,
  type CanvasTypedNode,
} from '../../modules/canvas/model';
import {
  commitCanvasHistory,
  alignCanvasNodes,
  canvasEdgeSides,
  canvasNodeAtPoint,
  canvasRectBetweenPoints,
  canvasSidePoint,
  createCanvasHistory,
  getCanvasGroupMemberIds,
  getCanvasEdgeGeometry,
  getCanvasEdgePath,
  redoCanvasHistory,
  resizeCanvasNodeFromHandle,
  selectCanvasNode,
  selectCanvasNodesInRect,
  translateCanvasNodes,
  undoCanvasHistory,
  type CanvasHistory,
  type CanvasAlignment,
  type CanvasEdgeRoute,
  type CanvasResizeHandle,
  type CanvasSide,
} from '../../modules/canvas/interaction';
import { canvasFreehandPath } from '../../modules/canvas/freehand';
import { snapToGuides, type CanvasGuide } from '../../modules/canvas/guides';
import { mediaExtensionForFile, mediaKindForFile } from '../../modules/docs/imageEmbeds';
import { importIntoFiles } from '../../modules/docs/vaultFiles';
import {
  canvasContentBounds,
  clampCanvasZoom,
  fitCanvasCamera,
  panCanvas,
  zoomCanvasAt,
  zoomCanvasAtCenter,
  type CanvasCamera,
} from '../../modules/canvas/viewport';
import { CanvasCard, type CanvasCardNode } from './CanvasCard';
import { CanvasLinkDialog } from './CanvasLinkDialog';
import { CanvasNotePicker } from './CanvasNotePicker';
import { CanvasToolbar, type CanvasGrid, type CanvasPaperStyle, type CanvasTool } from './CanvasToolbar';
import './CanvasView.css';

type CanvasClipboard = { nodes: CanvasTypedNode[]; edges: CanvasEdge[] };
type CanvasLinkDraft = { mode: 'add' | 'edit'; point?: CanvasPoint; nodeId?: string; value: string };
type CanvasPointerSample = { clientX: number; clientY: number; shiftKey: boolean };
type DragState =
  | { kind: 'move'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument; selected: ReadonlySet<string> }
  | { kind: 'resize'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument; nodeId: string; handle: CanvasResizeHandle }
  | { kind: 'edge-bend'; startX: number; startY: number; camera: CanvasCamera; edgeId: string; route: CanvasEdgeRoute; bend: CanvasPoint }
  | { kind: 'draw'; points: CanvasPoint[] }
  | { kind: 'shape'; start: CanvasPoint; startX: number; startY: number; nodeId: string; moved?: boolean }
  | { kind: 'pan'; startX: number; startY: number; camera: CanvasCamera }
  | { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number; additive: boolean }
  | { kind: 'connect'; fromId: string; fromSide: CanvasSide; startX: number; startY: number; camera: CanvasCamera; current: CanvasPoint }
  | { kind: 'camera'; startX: number; startY: number; camera: CanvasCamera };

interface CanvasViewProps {
  path: string;
  workspacePath: string;
  inactive: boolean;
  indexRevision: number;
  onOpenFile: (path: string) => void;
  onOpenNoteLink?: (link: CanvasNoteTarget, sourcePath: string | null) => Promise<void> | void;
}

const GRID_SIZE = 20;
const AUTOSAVE_DELAY_MS = 400;
const CAMERA_PERSIST_DELAY_MS = 300;
const COMPACT_ZOOM_THRESHOLD = 0.4;
const GUIDE_SNAP_THRESHOLD_PX = 6;
const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const CANVAS_PRESET_COLORS: Record<string, string> = {
  '1': '--q-red-600',
  '2': '--q-orange-600',
  '3': '--q-yellow-600',
  '4': '--q-green-600',
  '5': '--q-cyan-600',
  '6': '--q-purple-600',
};
const resizeHandles: readonly CanvasResizeHandle[] = [
  'top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left',
];

const slashCommands = [
  { id: 'text', label: 'canvas.slash.text' },
  { id: 'new-note', label: 'canvas.slash.newNote' },
  { id: 'find-note', label: 'canvas.slash.findNote' },
  { id: 'link', label: 'canvas.slash.link' },
  { id: 'file', label: 'canvas.slash.file' },
  { id: 'group', label: 'canvas.slash.group' },
  { id: 'edge', label: 'canvas.slash.edge' },
  { id: 'rectangle', label: 'canvas.slash.rectangle' },
  { id: 'diamond', label: 'canvas.slash.diamond' },
  { id: 'number', label: 'canvas.slash.number' },
  { id: 'ellipse', label: 'canvas.slash.ellipse' },
] as const;

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canvasCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^[1-6]$/.test(value)) return `var(${CANVAS_PRESET_COLORS[value]})`;
  return /^#[\da-f]{3,8}$/i.test(value) ? value : undefined;
}

function edgeSide(value: unknown): string {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom' ? value : 'auto';
}

function edgeRouting(edge: CanvasEdge): { route: CanvasEdgeRoute; bend: CanvasPoint } {
  const obsidium = edge.obsidium && typeof edge.obsidium === 'object' ? edge.obsidium as Record<string, unknown> : {};
  const bend = obsidium.bend && typeof obsidium.bend === 'object' ? obsidium.bend as Record<string, unknown> : {};
  return {
    route: obsidium.route === 'elbow' || obsidium.route === 'curved' ? obsidium.route : 'straight',
    bend: {
      x: typeof bend.x === 'number' && Number.isFinite(bend.x) ? bend.x : 0,
      y: typeof bend.y === 'number' && Number.isFinite(bend.y) ? bend.y : 0,
    },
  };
}

function edgeRoutingPatch(edge: CanvasEdge, route: CanvasEdgeRoute, bend: CanvasPoint): Partial<CanvasEdge> {
  const obsidium = edge.obsidium && typeof edge.obsidium === 'object' ? edge.obsidium as Record<string, unknown> : {};
  return { obsidium: { ...obsidium, route, bend } };
}

function boardPreferences(document: CanvasDocument): Record<string, unknown> {
  const nested = document.obsidium?.canvas;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
}

function readPaperStyle(document: CanvasDocument): CanvasPaperStyle {
  const style = boardPreferences(document).paperStyle;
  return style === 'ivory' || style === 'parchment' || style === 'sepia' || style === 'dark-paper'
    ? style
    : 'paper-white';
}

function readGrid(document: CanvasDocument): CanvasGrid {
  const grid = boardPreferences(document).grid;
  return grid === 'dots' || grid === 'lines' ? grid : 'none';
}

function readCamera(document: CanvasDocument): CanvasCamera {
  const camera = boardPreferences(document).camera;
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) return { x: 0, y: 0, zoom: 1 };
  const value = camera as Record<string, unknown>;
  return {
    x: typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0,
    zoom: typeof value.zoom === 'number' && Number.isFinite(value.zoom)
      ? clampCanvasZoom(value.zoom)
      : 1,
  };
}

function withBoardPreferences(
  document: CanvasDocument,
  patch: Partial<{ paperStyle: CanvasPaperStyle; grid: CanvasGrid; camera: CanvasCamera }>,
): CanvasDocument {
  const obsidium = document.obsidium ?? {};
  const previous = boardPreferences(document);
  return {
    ...document,
    obsidium: {
      ...obsidium,
      canvas: { ...previous, ...patch },
    },
  };
}

function isCanvasNode(value: CanvasNode): value is CanvasTypedNode {
  return value.type === 'text' || value.type === 'file' || value.type === 'link' || value.type === 'group';
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasSvg(document: CanvasDocument, colors: { paper: string; ink: string; card: string; border: string; edge: string; presets: Record<string, string> }): string {
  const nodes = document.nodes;
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  if (nodes.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />';
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const edges = document.edges.map((edge, index) => {
    const geometry = getCanvasEdgeGeometry(edge, nodeIndex);
    if (!geometry) return '';
    const color = canvasCssColor(edge.color) ?? colors.edge;
    const resolvedColor = /^[1-6]$/.test(String(edge.color)) ? colors.presets[String(edge.color)] ?? colors.edge : color;
    const label = typeof edge.label === 'string'
      ? `<text x="${(geometry.from.x + geometry.to.x) / 2}" y="${(geometry.from.y + geometry.to.y) / 2 - 8}">${escapeXml(edge.label)}</text>`
      : '';
    const start = edge.fromEnd === 'arrow' ? ` marker-start="url(#arrow-start-${index})"` : '';
    const end = edge.toEnd === 'none' ? '' : ` marker-end="url(#arrow-end-${index})"`;
    const routing = edgeRouting(edge);
    return `<marker id="arrow-start-${index}" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="${escapeXml(resolvedColor)}" /></marker><marker id="arrow-end-${index}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${escapeXml(resolvedColor)}" /></marker><path d="${getCanvasEdgePath(geometry, routing.route, routing.bend)}" stroke="${escapeXml(resolvedColor)}" fill="none" stroke-width="1"${start}${end} />${label}`;
  }).join('');
  const body = nodes.map((node) => {
    const title = node.type === 'text' ? node.text : node.type === 'file' ? node.file : node.type === 'link' ? node.url : node.label;
    const fill = canvasCssColor(node.color) ?? colors.card;
    const resolvedFill = /^[1-6]$/.test(String(node.color)) ? colors.presets[String(node.color)] ?? colors.card : fill;
    const resolvedStroke = canvasCssColor(node.color) ?? colors.edge;
    const shape = node.type === 'text' ? (node.obsidium as Record<string, unknown> | undefined)?.shape : undefined;
    const freehand = shape === 'freehand' ? canvasFreehandPoints(node) : [];
    const frame = shape === 'freehand' && freehand.length > 1
      ? `<path d="${canvasFreehandPath(freehand)}" fill="none" stroke="${escapeXml(resolvedStroke)}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />`
      : shape === 'ellipse' || shape === 'number'
      ? `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="none" stroke="${escapeXml(resolvedStroke)}" stroke-width="3" />`
      : shape === 'diamond'
        ? `<polygon points="${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}" fill="none" stroke="${escapeXml(resolvedStroke)}" stroke-width="3" />`
        : `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${shape ? 'none' : escapeXml(resolvedFill)}" stroke="${escapeXml(shape ? resolvedStroke : colors.border)}" stroke-width="${shape ? 3 : 1}" />`;
    return `<g>${frame}<foreignObject x="${node.x + 12}" y="${node.y + 12}" width="${Math.max(1, node.width - 24)}" height="${Math.max(1, node.height - 24)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:16px sans-serif;white-space:pre-wrap;overflow:hidden;color:${escapeXml(colors.ink)}">${escapeXml(String(title ?? ''))}</div></foreignObject></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" style="color:${escapeXml(colors.ink)};background:${escapeXml(colors.paper)}">${edges}${body}</svg>`;
}

export function CanvasView({ path, workspacePath, inactive, indexRevision, onOpenFile, onOpenNoteLink }: CanvasViewProps) {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [history, setHistory] = useState<CanvasHistory<CanvasDocument> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'conflict' | 'error'>('saved');
  const [camera, setCamera] = useState<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [nodeColor, setNodeColor] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edgeSource, setEdgeSource] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeColor, setEdgeColor] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [slashMenu, setSlashMenu] = useState<{ point: CanvasPoint; query: string } | null>(null);
  const [linkDraft, setLinkDraft] = useState<CanvasLinkDraft | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const slashInputRef = useRef<HTMLInputElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<CanvasDocument | null>(null);
  const historyRef = useRef<CanvasHistory<CanvasDocument> | null>(null);
  const cameraRef = useRef(camera);
  const dragRef = useRef<DragState | null>(null);
  const hashRef = useRef('');
  const savedTextRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const saveTimerRef = useRef<number | null>(null);
  const cameraTimerRef = useRef<number | null>(null);
  const clipboardRef = useRef<CanvasClipboard>({ nodes: [], edges: [] });
  const notePlacementRef = useRef<CanvasPoint | null>(null);
  const lastPointerRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const pendingPointerRef = useRef<CanvasPointerSample | null>(null);
  const frameRef = useRef<number | null>(null);
  const flushPointerMoveRef = useRef<() => void>(() => {});
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

  const setCanvasDocument = useCallback((next: CanvasDocument, record = true) => {
    documentRef.current = next;
    setDocument(next);
    if (record && historyRef.current) {
      const updated = commitCanvasHistory(historyRef.current, next);
      historyRef.current = updated;
      setHistory(updated);
    }
  }, []);

  const setCameraValue = useCallback((next: CanvasCamera, persist = true) => {
    const value = { ...next, zoom: clampCanvasZoom(next.zoom) };
    cameraRef.current = value;
    setCamera(value);
    if (cameraTimerRef.current !== null) window.clearTimeout(cameraTimerRef.current);
    cameraTimerRef.current = null;
    if (!persist) return;
    cameraTimerRef.current = window.setTimeout(() => {
      cameraTimerRef.current = null;
      const current = documentRef.current;
      if (current) setCanvasDocument(withBoardPreferences(current, { camera: cameraRef.current }), false);
    }, CAMERA_PERSIST_DELAY_MS);
  }, [setCanvasDocument]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActionError(null);
    void readFileSnapshot(path).then((snapshot) => {
      if (cancelled) return;
      const parsed = parseCanvasDocument(snapshot.content);
      if (!parsed.ok) {
        setError(parsed.error);
        setLoading(false);
        return;
      }
      documentRef.current = parsed.value;
      historyRef.current = createCanvasHistory(parsed.value);
      hashRef.current = snapshot.hash;
      savedTextRef.current = serializeCanvasDocument(parsed.value);
      setDocument(parsed.value);
      setHistory(historyRef.current);
      setCameraValue(readCamera(parsed.value), false);
      setSaveState('saved');
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(String(cause));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [path, setCameraValue]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = documentRef.current;
    if (!current) return true;
    const content = serializeCanvasDocument(current);
    if (content === savedTextRef.current) {
      await saveQueueRef.current;
      return serializeCanvasDocument(documentRef.current ?? current) === savedTextRef.current;
    }
    setSaveState('saving');
    let succeeded = true;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest) return;
      const nextContent = serializeCanvasDocument(latest);
      if (nextContent === savedTextRef.current) return;
      const result = await writeFileAtomic(path, nextContent, hashRef.current);
      hashRef.current = result.hash;
      savedTextRef.current = nextContent;
      setSaveState('saved');
    }).catch((cause: unknown) => {
      succeeded = false;
      setSaveState(isFileCommandError(cause, 'conflict') ? 'conflict' : 'error');
    });
    await saveQueueRef.current;
    const latest = documentRef.current;
    if (!succeeded || !latest) return succeeded;
    return serializeCanvasDocument(latest) === savedTextRef.current || save();
  }, [path]);

  useEffect(() => registerCanvasFlush(async () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    return save();
  }), [save]);

  useEffect(() => {
    if (!document || loading || error || saveState === 'conflict') return undefined;
    if (serializeCanvasDocument(document) === savedTextRef.current) return undefined;
    setSaveState('saving');
    saveTimerRef.current = window.setTimeout(() => { void save(); }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [document, error, loading, save, saveState]);

  useEffect(() => {
    const flush = () => { void save(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (cameraTimerRef.current !== null) {
        window.clearTimeout(cameraTimerRef.current);
        cameraTimerRef.current = null;
        const current = documentRef.current;
        if (current) documentRef.current = withBoardPreferences(current, { camera: cameraRef.current });
      }
      void save();
    };
  }, [save]);

  const handleWorkspaceChanged = useCallback((paths: string[]) => {
    if (!paths.some((changed) => samePath(changed, path))) return;
    void readFileSnapshot(path).then((snapshot) => {
      if (snapshot.hash === hashRef.current) return;
      const current = documentRef.current;
      if (!current || serializeCanvasDocument(current) !== savedTextRef.current) {
        setSaveState('conflict');
        return;
      }
      const parsed = parseCanvasDocument(snapshot.content);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      documentRef.current = parsed.value;
      historyRef.current = createCanvasHistory(parsed.value);
      hashRef.current = snapshot.hash;
      savedTextRef.current = serializeCanvasDocument(parsed.value);
      setDocument(parsed.value);
      setHistory(historyRef.current);
      setCameraValue(readCamera(parsed.value), false);
    }).catch((cause: unknown) => setError(String(cause)));
  }, [path, setCameraValue]);
  useTauriEvent<string[]>('workspace-changed', handleWorkspaceChanged, !inactive);

  const selectionSet = useMemo(() => new Set(selection), [selection]);

  const visibleNodes = useMemo(() => {
    if (!document) return [];
    if (viewport.width <= 0 || viewport.height <= 0) return document.nodes;
    const left = -camera.x / camera.zoom;
    const top = -camera.y / camera.zoom;
    const right = (viewport.width - camera.x) / camera.zoom;
    const bottom = (viewport.height - camera.y) / camera.zoom;
    return document.nodes.filter((node) => (
      selectionSet.has(node.id)
      || (node.x <= right && node.x + node.width >= left && node.y <= bottom && node.y + node.height >= top)
    ));
  }, [camera, document, selectionSet, viewport]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleFileKey = visibleNodes.filter((node) => node.type === 'file').map((node) => `${node.id}:${node.file}`).join('\n');
  useEffect(() => {
    const nodes = visibleNodes.filter((node) => node.type === 'file' && node.file);
    let cancelled = false;
    let cursor = 0;
    const output: Record<string, string> = {};
    const worker = async () => {
      while (cursor < nodes.length) {
        const node = nodes[cursor];
        cursor += 1;
        if (node.type !== 'file' || !node.file) continue;
        try {
          const fullPath = absolutePath(workspacePath, node.file);
          if (isMarkdownPath(node.file)) output[node.id] = (await readFileSnapshot(fullPath)).content;
          else if (IMAGE_EXTENSIONS.test(node.file)) output[node.id] = `![${fileName(node.file)}](${node.file})`;
        } catch {
          output[node.id] = '';
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, nodes.length) }, worker)).then(() => {
      if (!cancelled) setFileContents((current) => ({ ...current, ...output }));
    });
    return () => { cancelled = true; };
  }, [indexRevision, visibleFileKey, workspacePath]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const resize = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(stage);
    return () => resize.disconnect();
  }, []);

  const paperStyle = document ? readPaperStyle(document) : 'paper-white';
  const grid = document ? readGrid(document) : 'none';
  const selectedEdge = document?.edges.find((edge) => edge.id === selectedEdgeId);
  const visibleSlashCommands = slashCommands.filter(({ label }) => t(label).toLowerCase().includes(slashMenu?.query.toLowerCase() ?? ''));
  const nodeIndex = useMemo(() => new Map((document?.nodes ?? []).map((node) => [node.id, node])), [document]);
  const selectedColor = selectedEdge?.color ?? (selection.length === 1 ? nodeIndex.get(selection[0])?.color : nodeColor);
  const toolbarColor = typeof selectedColor === 'string' && /^[1-6]$/.test(selectedColor) ? selectedColor : '';
  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasTypedNode>, record = true) => {
    const current = documentRef.current;
    if (current) setCanvasDocument(updateCanvasNode(current, nodeId, patch), record);
  }, [setCanvasDocument]);

  const handleTextChange = useCallback((nodeId: string, text: string) => {
    updateNode(nodeId, { text }, false);
  }, [updateNode]);

  const commitCurrentHistory = useCallback(() => {
    const current = documentRef.current;
    const history = historyRef.current;
    if (!current || !history) return;
    const next = commitCanvasHistory(history, current);
    historyRef.current = next;
    setHistory(next);
  }, []);

  const finishTextEditing = useCallback(() => {
    const current = documentRef.current;
    const editing = editingId;
    setEditingId(null);
    if (!current || !editing) return;
    const node = current.nodes.find((item) => item.id === editing);
    if (!node || node.type !== 'text') {
      commitCurrentHistory();
      return;
    }
    const obsidium = node.obsidium;
    const shape = obsidium && typeof obsidium === 'object' ? (obsidium as Record<string, unknown>).shape : undefined;
    if (!shape && node.text.trim() === '') {
      setCanvasDocument(removeCanvasNode(current, node.id));
      setSelection((items) => items.filter((id) => id !== node.id));
      return;
    }
    commitCurrentHistory();
  }, [commitCurrentHistory, editingId, setCanvasDocument]);

  const resizeTextNode = useCallback((nodeId: string, height: number) => {
    const current = documentRef.current;
    const node = current?.nodes.find((item) => item.id === nodeId);
    if (!current || !node || node.type !== 'text') return;
    const obsidium = node.obsidium;
    if (obsidium && typeof obsidium === 'object' && 'shape' in obsidium) return;
    const next = Math.max(80, Math.ceil(height));
    if (next <= node.height) return;
    setCanvasDocument(updateCanvasNode(current, nodeId, { height: next }), false);
  }, [setCanvasDocument]);

  const openNoteLink = useCallback(async (node: CanvasCardNode, rawTarget: string, rawSource: string) => {
    if (!onOpenNoteLink) return;
    const source: CanvasNoteSource = rawSource === 'markdown' ? 'markdown' : 'wiki';
    const link = splitNoteLink(rawTarget, source);
    if (!link) return;
    const sourceFile = node.type === 'file' && node.file ? absolutePath(workspacePath, node.file) : null;
    const directory = parentDirectory(sourceFile ?? path);
    const markdown = link.source === 'markdown'
      ? resolveNotePath(workspacePath, directory, link.target)
      : null;
    if (link.source === 'markdown' && !markdown) {
      setActionError(t('canvas.errors.noteLinkOutsideWorkspace'));
      return;
    }
    await onOpenNoteLink({
      target: link.target,
      fragment: link.fragment,
      source: link.source,
      path: markdown,
    }, sourceFile);
  }, [onOpenNoteLink, path, workspacePath]);

  const resolveImageUrl = useCallback((node: CanvasCardNode, target: string) => {
    const base = node.type === 'file' && node.file
      ? parentDirectory(absolutePath(workspacePath, node.file))
      : workspacePath;
    try { return convertFileSrc(absolutePath(base, target)); } catch { return target; }
  }, [workspacePath]);

  const openUrl = useCallback((url: string) => {
    void openExternalUrl(url).catch((cause) => setActionError(String(cause)));
  }, []);

  const selectNode = useCallback((node: CanvasTypedNode, event: TargetedPointerEvent<HTMLDivElement>) => {
    const next = selectCanvasNode(selection, node.id, event.shiftKey);
    setSelection(next);
    return next;
  }, [selection]);

  const worldPoint = useCallback((event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    return rect ? {
      x: (event.clientX - rect.left - currentCamera.x) / currentCamera.zoom,
      y: (event.clientY - rect.top - currentCamera.y) / currentCamera.zoom,
    } : { x: 0, y: 0 };
  }, []);

  const addNode = useCallback((type: CanvasTool, point: { x: number; y: number }, file?: string, url?: string) => {
    const current = documentRef.current;
    if (!current) return;
    let node: CanvasTypedNode;
    const base = { id: newId(), x: Math.round(point.x), y: Math.round(point.y), width: 280, height: 180, ...(nodeColor ? { color: nodeColor } : {}) };
    if (type === 'file' && file) node = { ...base, type, file };
    else if (type === 'link') node = { ...base, type, url: url ?? 'https://' };
    else node = {
      ...base,
      type: 'text',
      text: '',
      ...((type === 'rectangle' || type === 'diamond' || type === 'ellipse') ? { obsidium: { shape: type } } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node));
    setSelection([node.id]);
    if (node.type === 'text') setEditingId(node.id);
  }, [nodeColor, setCanvasDocument]);

  const beginShapeDrawing = useCallback((type: 'rectangle' | 'diamond' | 'ellipse', event: { clientX: number; clientY: number; pointerId: number }) => {
    const current = documentRef.current;
    const point = worldPoint(event);
    if (!current) return;
    const start = { x: Math.round(point.x), y: Math.round(point.y) };
    const node: CanvasTypedNode = {
      id: newId(), type: 'text', ...start, width: 1, height: 1, text: '',
      obsidium: { shape: type },
      ...(nodeColor ? { color: nodeColor } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node), false);
    setSelection([node.id]);
    setActiveTool('select');
    const next: DragState = { kind: 'shape', start, startX: event.clientX, startY: event.clientY, nodeId: node.id };
    dragRef.current = next;
    setDrag(next);
    stageRef.current?.focus();
    stageRef.current?.setPointerCapture(event.pointerId);
  }, [nodeColor, setCanvasDocument, worldPoint]);

  const addNumberMarker = useCallback((point: CanvasPoint) => {
    const current = documentRef.current;
    if (!current) return;
    const nextNumber = current.nodes.reduce((highest, node) => {
      const obsidium = node.type === 'text' && node.obsidium && typeof node.obsidium === 'object'
        ? node.obsidium as Record<string, unknown>
        : {};
      return obsidium.shape === 'number' ? Math.max(highest, Number(node.text) || 0) : highest;
    }, 0) + 1;
    const node: CanvasTypedNode = {
      id: newId(), type: 'text', x: Math.round(point.x), y: Math.round(point.y),
      width: 48, height: 48, text: String(nextNumber), obsidium: { shape: 'number' },
      ...(nodeColor ? { color: nodeColor } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node));
    setSelection([node.id]);
    setActiveTool('select');
  }, [nodeColor, setCanvasDocument]);

  const addSearchedNote = useCallback((path: string) => {
    const current = documentRef.current;
    if (!current) return;
    try {
      const anchor = current.nodes.find((node) => selection.includes(node.id));
      const point = notePlacementRef.current ?? {
        x: anchor ? anchor.x + anchor.width + GRID_SIZE : (viewport.width / 2 - camera.x) / camera.zoom,
        y: anchor ? anchor.y : (viewport.height / 2 - camera.y) / camera.zoom,
      };
      addNode('file', point, relativePath(workspacePath, path));
      notePlacementRef.current = null;
    } catch {
      setActionError(t('canvas.errors.fileOutsideWorkspace'));
    }
  }, [addNode, camera, selection, viewport, workspacePath]);

  const createCanvasNote = useCallback(async (point: CanvasPoint) => {
    try {
      const path = await createUniqueFile(workspacePath, t('canvas.slash.defaultNoteTitle'));
      if (path) addNode('file', point, relativePath(workspacePath, path));
    } catch (cause) {
      setActionError(String(cause));
    }
  }, [addNode, workspacePath]);

  const runSlashCommand = useCallback(async (commandId: string) => {
    const point = slashMenu?.point;
    if (!point) return;
    setSlashMenu(null);
    if (commandId === 'text') addNode('text', point);
    else if (commandId === 'new-note') await createCanvasNote(point);
    else if (commandId === 'find-note') {
      notePlacementRef.current = point;
      setNotePickerOpen(true);
    } else setActiveTool(commandId as CanvasTool);
  }, [addNode, createCanvasNote, slashMenu]);

  useEffect(() => {
    if (slashMenu) slashInputRef.current?.focus();
  }, [slashMenu]);

  const addGroup = useCallback(() => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = current.nodes.filter((node) => selection.includes(node.id));
    if (selected.length === 0) return;
    const margin = 32;
    const left = Math.min(...selected.map((node) => node.x)) - margin;
    const top = Math.min(...selected.map((node) => node.y)) - margin;
    const right = Math.max(...selected.map((node) => node.x + node.width)) + margin;
    const bottom = Math.max(...selected.map((node) => node.y + node.height)) + margin;
    const group: CanvasTypedNode = {
      id: newId(), type: 'group', x: left, y: top, width: right - left, height: bottom - top,
      label: t('canvas.toolbar.group'), ...(nodeColor ? { color: nodeColor } : {}),
    };
    const insertion = Math.min(...selected.map((node) => current.nodes.indexOf(node)));
    const nodes = [...current.nodes];
    nodes.splice(insertion, 0, group);
    setCanvasDocument({ ...current, nodes });
    setSelection([group.id]);
  }, [nodeColor, selection, setCanvasDocument]);

  const alignSelection = useCallback((alignment: CanvasAlignment) => {
    const current = documentRef.current;
    if (!current || selection.length < 2) return;
    setCanvasDocument({ ...current, nodes: alignCanvasNodes(current.nodes, new Set(selection), alignment) });
    setMenu(null);
  }, [selection, setCanvasDocument]);

  const onPaperStyleChange = useCallback((style: CanvasPaperStyle) => {
    const current = documentRef.current;
    if (current) setCanvasDocument(withBoardPreferences(current, { paperStyle: style }));
  }, [setCanvasDocument]);
  const onGridChange = useCallback((nextGrid: CanvasGrid) => {
    const current = documentRef.current;
    if (current) setCanvasDocument(withBoardPreferences(current, { grid: nextGrid }));
  }, [setCanvasDocument]);
  const updateEdge = useCallback((edgeId: string, patch: Partial<CanvasEdge>) => {
    const current = documentRef.current;
    if (current) setCanvasDocument(updateCanvasEdge(current, edgeId, patch));
  }, [setCanvasDocument]);

  const deleteSelectedEdge = useCallback(() => {
    const current = documentRef.current;
    if (current && selectedEdgeId) setCanvasDocument(removeCanvasEdge(current, selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setCanvasDocument]);

  const readCanvasColors = useCallback(() => {
    const styles = getComputedStyle(stageRef.current ?? window.document.documentElement);
    const color = (name: string) => styles.getPropertyValue(name).trim() || styles.color;
    return {
      paper: color('--q-canvas-paper'),
      ink: color('--q-canvas-ink'),
      card: color('--q-canvas-card'),
      border: color('--q-canvas-border'),
      edge: color('--q-canvas-edge'),
      presets: Object.fromEntries(Object.entries(CANVAS_PRESET_COLORS).map(([preset, variable]) => [
        preset,
        color(variable),
      ])),
    };
  }, []);

  const applyHistory = useCallback((next: CanvasHistory<CanvasDocument>) => {
    if (next === historyRef.current) return;
    const boardCamera = boardPreferences(next.current).camera;
    const restored = boardCamera === cameraRef.current
      ? next.current
      : withBoardPreferences(next.current, { camera: cameraRef.current });
    const committed = next.current === restored ? next : { ...next, current: restored };
    historyRef.current = committed;
    documentRef.current = restored;
    setHistory(committed);
    setDocument(restored);
  }, []);
  const undo = useCallback(() => {
    if (!historyRef.current) return;
    applyHistory(undoCanvasHistory(historyRef.current));
  }, [applyHistory]);
  const redo = useCallback(() => {
    if (!historyRef.current) return;
    applyHistory(redoCanvasHistory(historyRef.current));
  }, [applyHistory]);

  const zoomBy = useCallback((factor: number) => {
    setCameraValue(zoomCanvasAtCenter(cameraRef.current, viewport, factor));
  }, [setCameraValue, viewport]);

  const fitView = useCallback(() => {
    const current = documentRef.current;
    const bounds = canvasContentBounds(current?.nodes ?? []);
    setCameraValue(fitCanvasCamera(bounds, viewport));
  }, [setCameraValue, viewport]);

  const reorderSelection = useCallback((direction: 'front' | 'back') => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = new Set(selection);
    const chosen = current.nodes.filter((node) => selected.has(node.id));
    const rest = current.nodes.filter((node) => !selected.has(node.id));
    const nodes = direction === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
    setCanvasDocument({ ...current, nodes });
    setMenu(null);
  }, [selection, setCanvasDocument]);

  const duplicateSelection = useCallback(() => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = new Set(selection);
    const ids = new Map<string, string>();
    const copies = current.nodes
      .filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node))
      .map((node) => {
        const id = newId();
        ids.set(node.id, id);
        return { ...node, id, x: node.x + GRID_SIZE, y: node.y + GRID_SIZE };
      });
    if (copies.length === 0) return;
    const edges = current.edges
      .filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode))
      .map((edge) => ({ ...edge, id: newId(), fromNode: ids.get(edge.fromNode)!, toNode: ids.get(edge.toNode)! }));
    setCanvasDocument({ ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...edges] });
    setSelection(copies.map((node) => node.id));
  }, [selection, setCanvasDocument]);

  const handleNodePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>, node: CanvasTypedNode) => {
    if (event.button !== 0) return;
    if (spaceHeld) {
      event.stopPropagation();
      const next: DragState = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera: cameraRef.current };
      dragRef.current = next;
      setDrag(next);
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'rectangle' || activeTool === 'diamond' || activeTool === 'ellipse') {
      event.stopPropagation();
      beginShapeDrawing(activeTool, event);
      return;
    }
    if (activeTool !== 'select') return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, a, button')) return;
    event.stopPropagation();
    setSelectedEdgeId(null);
    const nextSelection = selectNode(node, event);
    if (nextSelection.includes(node.id)) {
      const current = documentRef.current;
      if (!current) return;
      const selected = new Set(nextSelection);
      for (const selectedNode of current.nodes) {
        if (selected.has(selectedNode.id) && selectedNode.type === 'group') {
          for (const memberId of getCanvasGroupMemberIds(selectedNode, current.nodes)) selected.add(memberId);
        }
      }
      const nextDrag: DragState = {
        kind: 'move', startX: event.clientX, startY: event.clientY, camera,
        document: current!, selected,
      };
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      stageRef.current?.setPointerCapture(event.pointerId);
    }
  }, [activeTool, beginShapeDrawing, camera, selectNode, spaceHeld]);

  const handleNodeClick = useCallback((event: TargetedMouseEvent<HTMLDivElement>, node: CanvasTypedNode) => {
    if (spaceHeld) {
      event.stopPropagation();
      return;
    }
    if (activeTool === 'edge') {
      event.stopPropagation();
      if (!edgeSource) setEdgeSource(node.id);
      else if (edgeSource !== node.id && documentRef.current) {
        const edge: CanvasEdge = {
          id: newId(), fromNode: edgeSource, toNode: node.id, fromEnd: 'none', toEnd: 'arrow',
          ...(edgeColor ? { color: edgeColor } : {}),
        };
        setCanvasDocument(addCanvasEdge(documentRef.current, edge));
        setEdgeSource(null);
      }
      return;
    }
    if (activeTool === 'group') {
      event.stopPropagation();
      if (!selection.includes(node.id)) setSelection((current) => [...new Set([...current, node.id])]);
      return;
    }
    if (activeTool !== 'select') return;
    event.stopPropagation();
  }, [activeTool, edgeColor, edgeSource, selection, setCanvasDocument, spaceHeld]);

  const beginConnect = useCallback((event: TargetedPointerEvent<HTMLButtonElement>, node: CanvasTypedNode, side: CanvasSide) => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedEdgeId(null);
    const next: DragState = {
      kind: 'connect', fromId: node.id, fromSide: side,
      startX: event.clientX, startY: event.clientY, camera: cameraRef.current,
      current: worldPoint(event),
    };
    dragRef.current = next;
    setDrag(next);
    stageRef.current?.setPointerCapture(event.pointerId);
  }, [worldPoint]);

  const importMedia = useCallback(async (files: File[], point: CanvasPoint) => {
    const media = files.filter((file) => mediaKindForFile(file));
    let offset = 0;
    for (const file of media) {
      try {
        const extension = mediaExtensionForFile(file);
        const relative = await importIntoFiles(workspacePath, {
          kind: 'bytes',
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name || `image.${extension}`,
        }, { fallbackName: 'image', fallbackExt: extension });
        addNode('file', { x: point.x + offset * GRID_SIZE, y: point.y + offset * GRID_SIZE }, relative);
        offset += 1;
      } catch (cause) {
        setActionError(String(cause));
      }
    }
  }, [addNode, workspacePath]);

  const applyPointerMove = useCallback((pointer: CanvasPointerSample) => {
    const currentDrag = dragRef.current;
    if (!currentDrag) return;
    if (currentDrag.kind === 'draw') {
      const point = worldPoint(pointer);
      const last = currentDrag.points[currentDrag.points.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
      const next = { ...currentDrag, points: [...currentDrag.points, point] };
      dragRef.current = next;
      setDrag(next);
      return;
    }
    if (currentDrag.kind === 'connect') {
      const next = { ...currentDrag, current: worldPoint(pointer) };
      dragRef.current = next;
      setDrag(next);
      return;
    }
    const dx = pointer.clientX - currentDrag.startX;
    const dy = pointer.clientY - currentDrag.startY;
    if (currentDrag.kind === 'move') {
      const current = currentDrag.document;
      const selected = currentDrag.selected;
      const zoom = currentDrag.camera.zoom;
      const delta = { x: dx / zoom, y: dy / zoom };
      const bounds = canvasContentBounds(current.nodes.filter((node) => selected.has(node.id)));
      const snapped = bounds
        ? snapToGuides(
          { x: bounds.x + delta.x, y: bounds.y + delta.y, width: bounds.width, height: bounds.height },
          current.nodes.filter((node) => !selected.has(node.id)),
          GUIDE_SNAP_THRESHOLD_PX / zoom,
        )
        : { offset: { x: 0, y: 0 }, guides: [] as CanvasGuide[] };
      setGuides(snapped.guides);
      setCanvasDocument({
        ...current,
        nodes: translateCanvasNodes(
          current.nodes,
          selected,
          { x: delta.x + snapped.offset.x, y: delta.y + snapped.offset.y },
          grid === 'none' ? undefined : GRID_SIZE,
        ),
      }, false);
    } else if (currentDrag.kind === 'resize') {
      const original = currentDrag.document.nodes.find((node) => node.id === currentDrag.nodeId);
      if (!original) return;
      const resized = resizeCanvasNodeFromHandle(original, currentDrag.handle, {
        x: dx / currentDrag.camera.zoom,
        y: dy / currentDrag.camera.zoom,
      }, pointer.shiftKey, 120, 80, grid === 'none' ? undefined : GRID_SIZE);
      const current = documentRef.current;
      if (current) setCanvasDocument(updateCanvasNode(current, original.id, resized), false);
    } else if (currentDrag.kind === 'edge-bend') {
      const current = documentRef.current;
      const edge = current?.edges.find((item) => item.id === currentDrag.edgeId);
      if (!current || !edge) return;
      const bend = {
        x: currentDrag.bend.x + dx / currentDrag.camera.zoom,
        y: currentDrag.route === 'elbow' ? 0 : currentDrag.bend.y + dy / currentDrag.camera.zoom,
      };
      setCanvasDocument(updateCanvasEdge(current, edge.id, edgeRoutingPatch(edge, currentDrag.route, bend)), false);
    } else if (currentDrag.kind === 'shape') {
      const end = worldPoint(pointer);
      const shapeDx = end.x - currentDrag.start.x;
      const shapeDy = end.y - currentDrag.start.y;
      const side = Math.max(Math.abs(shapeDx), Math.abs(shapeDy));
      const rect = canvasRectBetweenPoints(currentDrag.start, pointer.shiftKey ? {
        x: currentDrag.start.x + (Math.sign(shapeDx) || 1) * side,
        y: currentDrag.start.y + (Math.sign(shapeDy) || 1) * side,
      } : end);
      const current = documentRef.current;
      if (current) {
        const node = current.nodes.find((item) => item.id === currentDrag.nodeId);
        if (node && isCanvasNode(node)) {
          setCanvasDocument(updateCanvasNode(current, node.id, {
            x: rect.x, y: rect.y, width: Math.max(24, rect.width), height: Math.max(24, rect.height),
          }), false);
        }
      }
      dragRef.current = { ...currentDrag, moved: true };
    } else if (currentDrag.kind === 'pan' || currentDrag.kind === 'camera') {
      setCameraValue({ ...currentDrag.camera, x: currentDrag.camera.x + dx, y: currentDrag.camera.y + dy });
    } else {
      const next = { ...currentDrag, currentX: pointer.clientX, currentY: pointer.clientY };
      dragRef.current = next;
      setDrag(next);
    }
  }, [grid, setCameraValue, setCanvasDocument, worldPoint]);

  const flushPointerMove = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pointer = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (pointer) applyPointerMove(pointer);
  }, [applyPointerMove]);

  useEffect(() => {
    flushPointerMoveRef.current = flushPointerMove;
  }, [flushPointerMove]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingPointerRef.current = null;
  }, []);

  const handlePointerMove = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    lastPointerRef.current = worldPoint(event);
    if (!dragRef.current) return;
    pendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      flushPointerMoveRef.current();
    });
  }, [worldPoint]);

  const handlePointerUp = useCallback(() => {
    flushPointerMove();
    const currentDrag = dragRef.current;
    if (currentDrag?.kind === 'shape') {
      const current = documentRef.current;
      const node = current?.nodes.find((item) => item.id === currentDrag.nodeId);
      if (current && node && isCanvasNode(node)) {
        const patch = currentDrag.moved
          ? {}
          : { x: currentDrag.start.x, y: currentDrag.start.y, width: 160, height: 100 };
        const next = updateCanvasNode(current, node.id, patch);
        setCanvasDocument(next, false);
        if (historyRef.current) {
          const committed = commitCanvasHistory(historyRef.current, next);
          historyRef.current = committed;
          setHistory(committed);
        }
      }
    } else if (currentDrag?.kind === 'draw' && currentDrag.points.length > 0) {
      const current = documentRef.current;
      if (current) {
        const node = createCanvasFreehandNode(newId(), currentDrag.points);
        setCanvasDocument(addCanvasNode(current, node));
        setSelection([node.id]);
      }
      setActiveTool('select');
    } else if (currentDrag?.kind === 'connect') {
      const current = documentRef.current;
      const target = current ? canvasNodeAtPoint(current.nodes, currentDrag.current, currentDrag.fromId) : null;
      const source = current?.nodes.find((node) => node.id === currentDrag.fromId);
      if (current && target && source) {
        const edge: CanvasEdge = {
          id: newId(), fromNode: source.id, toNode: target.id, fromEnd: 'none', toEnd: 'arrow',
          fromSide: currentDrag.fromSide, toSide: canvasEdgeSides(source, target).toSide,
          ...(edgeColor ? { color: edgeColor } : {}),
        };
        setCanvasDocument(addCanvasEdge(current, edge));
        setSelectedEdgeId(edge.id);
        setSelection([]);
      }
    } else if (currentDrag?.kind === 'move' || currentDrag?.kind === 'resize' || currentDrag?.kind === 'edge-bend') {
      const current = documentRef.current;
      if (current) {
        const history = historyRef.current;
        if (history) {
          const committed = commitCanvasHistory(history, current);
          historyRef.current = committed;
          setHistory(committed);
        } else {
          historyRef.current = createCanvasHistory(current);
        }
      }
    } else if ((currentDrag?.kind === 'pan' || currentDrag?.kind === 'camera') && documentRef.current) {
      setCanvasDocument(withBoardPreferences(documentRef.current, { camera: cameraRef.current }), false);
    }
    if (currentDrag?.kind === 'marquee') {
      const start = worldPoint({ clientX: currentDrag.startX, clientY: currentDrag.startY });
      const end = worldPoint({ clientX: currentDrag.currentX, clientY: currentDrag.currentY });
      const nextSelection = documentRef.current
        ? selectCanvasNodesInRect(documentRef.current.nodes, { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }, selection, currentDrag.additive)
        : [];
      setSelection(nextSelection);
    }
    dragRef.current = null;
    setDrag(null);
    setGuides([]);
  }, [edgeColor, flushPointerMove, selection, setCanvasDocument, worldPoint]);

  const handleStagePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || (event.target !== stage && event.target !== worldRef.current)) return;
    stage.focus();
    const point = worldPoint(event);
    if (event.button === 1 || (spaceHeld && event.button === 0)) {
      const next: DragState = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera };
      dragRef.current = next;
      setDrag(next);
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'draw' && event.button === 0) {
      const next: DragState = { kind: 'draw', points: [point] };
      dragRef.current = next;
      setDrag(next);
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 0 && (activeTool === 'rectangle' || activeTool === 'diamond' || activeTool === 'ellipse')) {
      beginShapeDrawing(activeTool, event);
      return;
    }
    if (event.button === 0 && activeTool === 'number') {
      addNumberMarker(point);
      return;
    }
    if (activeTool !== 'select') {
      if (activeTool === 'text') addNode(activeTool, point);
      else if (activeTool === 'link') setLinkDraft({ mode: 'add', point, value: '' });
      else if (activeTool === 'group') addGroup();
      else if (activeTool === 'file') {
        void open({ multiple: false, directory: false }).then((selectedPath) => {
          if (!selectedPath) return;
          try {
            const file = relativePath(workspacePath, selectedPath);
            addNode('file', point, file);
          } catch {
            setActionError(t('canvas.errors.fileOutsideWorkspace'));
          }
        });
      }
      setActiveTool('select');
      return;
    }
    if (event.button !== 0) return;
    setSelection([]);
    const next: DragState = {
      kind: 'marquee', startX: event.clientX, startY: event.clientY,
      currentX: event.clientX, currentY: event.clientY, additive: event.shiftKey,
    };
    dragRef.current = next;
    setDrag(next);
    stage.setPointerCapture(event.pointerId);
  }, [activeTool, addGroup, addNode, addNumberMarker, beginShapeDrawing, camera, spaceHeld, worldPoint, workspacePath]);

  const handleDrop = useCallback((event: TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    if (transfer.files && transfer.files.length > 0) {
      void importMedia(Array.from(transfer.files), worldPoint(event));
      return;
    }
    const absolute = transfer.getData('application/x-obsidium-file-path') || transfer.getData('text/plain');
    if (!absolute || !isCanvasPath(path)) return;
    try {
      const file = relativePath(workspacePath, absolute);
      addNode('file', worldPoint(event), file);
    } catch {
      setActionError(t('canvas.errors.fileOutsideWorkspace'));
    }
  }, [addNode, importMedia, path, worldPoint, workspacePath]);

  const handlePaste = useCallback((event: ClipboardEvent) => {
    if ((event.target as HTMLElement).closest('textarea,input')) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void importMedia(files, lastPointerRef.current);
  }, [importMedia]);

  const handleWheel = useCallback((event: WheelEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const current = cameraRef.current;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setCameraValue(zoomCanvasAt(current, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }, factor));
      return;
    }
    const horizontal = event.shiftKey ? event.deltaY : event.deltaX;
    const vertical = event.shiftKey ? 0 : event.deltaY;
    if (horizontal === 0 && vertical === 0) return;
    event.preventDefault();
    setCameraValue(panCanvas(current, { x: -horizontal, y: -vertical }));
  }, [setCameraValue]);

  const handleKeyDown = useCallback((event: TargetedKeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('textarea,input,select')) return;
    const command = event.metaKey || event.ctrlKey;
    if (event.key === ' ' && !command) {
      if ((event.target as HTMLElement).closest('button,a')) return;
      event.preventDefault();
      if (!spaceHeld) setSpaceHeld(true);
      return;
    }
    if ((event.key === '/' || event.code === 'Slash') && !command) {
      event.preventDefault();
      setSlashMenu({
        point: { x: (viewport.width / 2 - camera.x) / camera.zoom, y: (viewport.height / 2 - camera.y) / camera.zoom },
        query: '',
      });
      return;
    }
    if (command && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      zoomBy(1.2);
      return;
    }
    if (command && event.key === '-') {
      event.preventDefault();
      zoomBy(1 / 1.2);
      return;
    }
    if (command && event.key === '0') {
      event.preventDefault();
      setCameraValue({ x: 0, y: 0, zoom: 1 });
      return;
    }
    if (event.shiftKey && event.code === 'Digit1') {
      event.preventDefault();
      fitView();
      return;
    }
    if (command && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (command && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      reorderSelection(event.key === ']' ? 'front' : 'back');
      return;
    }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection((documentRef.current?.nodes ?? []).map((node) => node.id));
      return;
    }
    if (event.key === 'Enter' && !command) {
      const current = documentRef.current;
      const node = selection.length === 1 ? current?.nodes.find((item) => item.id === selection[0]) : undefined;
      if (node?.type === 'text') {
        event.preventDefault();
        setEditingId(node.id);
      } else if (node?.type === 'file') {
        event.preventDefault();
        onOpenFile(absolutePath(workspacePath, node.file));
      } else if (node?.type === 'link') {
        event.preventDefault();
        openUrl(node.url);
      }
      return;
    }
    if (event.key.startsWith('Arrow') && selection.length > 0 && !command) {
      const step = event.shiftKey ? GRID_SIZE : 1;
      const delta = {
        x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      };
      const current = documentRef.current;
      if (current) {
        event.preventDefault();
        setCanvasDocument({
          ...current,
          nodes: translateCanvasNodes(current.nodes, new Set(selection), delta),
        });
      }
      return;
    }
    if (!command && !event.altKey && !event.shiftKey) {
      const tool = ({
        KeyV: 'select', KeyT: 'text', KeyF: 'file', KeyL: 'link', KeyG: 'group', KeyA: 'edge',
        KeyR: 'rectangle', KeyD: 'diamond', KeyE: 'ellipse', KeyN: 'number', KeyP: 'draw',
      } as const)[event.code];
      if (tool) {
        event.preventDefault();
        setActiveTool(tool);
        return;
      }
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo();
    } else if (command && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      const current = documentRef.current;
      const selected = new Set(selection);
      clipboardRef.current = {
        nodes: current?.nodes.filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node)) ?? [],
        edges: current?.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)) ?? [],
      };
    } else if (command && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      const current = documentRef.current;
      const selected = new Set(selection);
      clipboardRef.current = {
        nodes: current?.nodes.filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node)) ?? [],
        edges: current?.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)) ?? [],
      };
      if (current) for (const id of selection) setCanvasDocument(removeCanvasNode(documentRef.current ?? current, id));
      setSelection([]);
    } else if (command && event.key.toLowerCase() === 'v' && documentRef.current && clipboardRef.current.nodes.length) {
      event.preventDefault();
      const current = documentRef.current;
      const copiedNodes = clipboardRef.current.nodes;
      const ids = new Map(copiedNodes.map((node) => [node.id, newId()]));
      const copies = copiedNodes.map((node) => ({ ...node, id: ids.get(node.id)!, x: node.x + GRID_SIZE, y: node.y + GRID_SIZE }));
      const edges = clipboardRef.current.edges.map((edge) => ({
        ...edge,
        id: newId(),
        fromNode: ids.get(edge.fromNode)!,
        toNode: ids.get(edge.toNode)!,
      }));
      setCanvasDocument({ ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...edges] });
      setSelection(copies.map((node) => node.id));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      const current = documentRef.current;
      if (current && selectedEdgeId) {
        setCanvasDocument(removeCanvasEdge(current, selectedEdgeId));
        setSelectedEdgeId(null);
      } else if (current && selection.length) {
        let next = current;
        for (const id of selection) next = removeCanvasNode(next, id);
        setCanvasDocument(next);
        setSelection([]);
      }
    } else if (event.key === 'Escape') {
      setSelection([]); setEdgeSource(null); setEditingId(null); setMenu(null); setSlashMenu(null); setLinkDraft(null);
    }
  }, [camera, duplicateSelection, fitView, onOpenFile, openUrl, redo, reorderSelection, selectedEdgeId, selection, setCanvasDocument, spaceHeld, undo, viewport, workspacePath, zoomBy]);

  const handleKeyUp = useCallback((event: TargetedKeyboardEvent<HTMLElement>) => {
    if (event.key !== ' ') return;
    setSpaceHeld(false);
  }, []);

  useEffect(() => {
    if (!spaceHeld) return undefined;
    const release = () => setSpaceHeld(false);
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [spaceHeld]);

  const onCanvasColorChange = useCallback((value: string) => {
    const color = value || undefined;
    setNodeColor(color ?? '');
    setEdgeColor(color ?? '');
    const current = documentRef.current;
    if (!current) return;
    if (selectedEdgeId) {
      setCanvasDocument(updateCanvasEdge(current, selectedEdgeId, { color }));
    } else if (selection.length) {
      const selected = new Set(selection);
      setCanvasDocument({
        ...current,
        nodes: current.nodes.map((node) => selected.has(node.id) ? { ...node, color } : node),
      });
    }
  }, [selectedEdgeId, selection, setCanvasDocument]);

  const focusCanvas = useCallback((event: TargetedPointerEvent<HTMLElement>) => {
    if (!(event.target as HTMLElement).closest('input,textarea,select,button,[contenteditable="true"]')) {
      event.currentTarget.focus({ preventScroll: true });
    }
  }, []);

  const duplicateNode = useCallback((nodeId: string) => {
    const current = documentRef.current;
    const source = current?.nodes.find((node) => node.id === nodeId);
    if (!current || !source || !isCanvasNode(source)) return;
    const duplicate = { ...source, id: newId(), x: source.x + GRID_SIZE, y: source.y + GRID_SIZE };
    setCanvasDocument({ ...current, nodes: [...current.nodes, duplicate] });
    setSelection([duplicate.id]);
    setMenu(null);
  }, [setCanvasDocument]);

  const deleteNode = useCallback((nodeId: string) => {
    const current = documentRef.current;
    if (!current) return;
    setCanvasDocument(removeCanvasNode(current, nodeId));
    setSelection((items) => items.filter((id) => id !== nodeId));
    setMenu(null);
  }, [setCanvasDocument]);

  const exportSvg = useCallback(() => {
    if (document) downloadBlob(new Blob([canvasSvg(document, readCanvasColors())], { type: 'image/svg+xml' }), `${fileName(path).replace(/\.canvas$/i, '')}.svg`);
  }, [document, path, readCanvasColors]);

  const exportPng = useCallback(() => {
    if (!document) return;
    const source = new Blob([canvasSvg(document, readCanvasColors())], { type: 'image/svg+xml' });
    const sourceUrl = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(2, 4096 / Math.max(image.width, image.height));
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${fileName(path).replace(/\.canvas$/i, '')}.png`);
        URL.revokeObjectURL(sourceUrl);
      });
    };
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); setActionError(t('canvas.errors.exportFailed')); };
    image.src = sourceUrl;
  }, [document, path, readCanvasColors]);

  const downloadLocalCopy = useCallback(() => {
    const current = documentRef.current;
    if (current) downloadBlob(new Blob([serializeCanvasDocument(current)], { type: 'application/json' }), `${fileName(path)}.local-copy.json`);
  }, [path]);

  const reloadExternal = useCallback(async () => {
    try {
      const snapshot = await readFileSnapshot(path);
      const parsed = parseCanvasDocument(snapshot.content);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      documentRef.current = parsed.value;
      historyRef.current = createCanvasHistory(parsed.value);
      hashRef.current = snapshot.hash;
      savedTextRef.current = serializeCanvasDocument(parsed.value);
      setDocument(parsed.value);
      setHistory(historyRef.current);
      setCameraValue(readCamera(parsed.value), false);
      setSaveState('saved');
      setError(null);
      setActionError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [path, setCameraValue]);

  const screenPoint = (point: { x: number; y: number }) => ({ x: camera.x + point.x * camera.zoom, y: camera.y + point.y * camera.zoom });
  const compact = camera.zoom < COMPACT_ZOOM_THRESHOLD;

  if (loading) return <div className="q-canvas-loading" aria-busy="true">{t('canvas.loading')}</div>;
  if (error && !document) return <div className="q-canvas-error" role="alert">{t('canvas.errors.read', { reason: error })}</div>;
  if (!document) return null;

  return (
    <section
      className={`q-canvas${inactive ? ' q-canvas--inactive' : ''}`}
      data-paper-style={paperStyle}
      data-grid={grid}
      data-active-tool={activeTool}
      data-space-held={spaceHeld ? 'true' : undefined}
      aria-label={fileName(path)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPaste={handlePaste}
      onPointerDownCapture={focusCanvas}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest('.q-canvas__slash')) setSlashMenu(null);
      }}
      tabIndex={0}
    >
      <CanvasToolbar
        paperStyle={paperStyle}
        grid={grid}
        activeTool={activeTool}
        color={toolbarColor}
        canUndo={Boolean(history?.past.length)}
        canRedo={Boolean(history?.future.length)}
        onPaperStyleChange={onPaperStyleChange}
        onGridChange={onGridChange}
        onColorChange={onCanvasColorChange}
        onOpenSlash={() => setSlashMenu({
          point: { x: (viewport.width / 2 - camera.x) / camera.zoom, y: (viewport.height / 2 - camera.y) / camera.zoom },
          query: '',
        })}
        onToolChange={setActiveTool}
        onUndo={undo}
        onRedo={redo}
        onAddNote={() => setNotePickerOpen(true)}
        onExportSvg={exportSvg}
        onExportPng={exportPng}
      />
      <div className="q-canvas__controls" aria-label={t('canvas.toolbar.view')}>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label={t('canvas.toolbar.zoomOut')}>−</button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label={t('canvas.toolbar.zoomIn')}>+</button>
        <button type="button" onClick={fitView}>{t('canvas.toolbar.fitView')}</button>
        <button type="button" onClick={() => setCameraValue({ x: 0, y: 0, zoom: 1 })}>{t('canvas.toolbar.resetView')}</button>
        {selectedEdge && <>
          <label>{t('canvas.edgeLabel')}<input value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''} onInput={(event) => updateEdge(selectedEdge.id, { label: event.currentTarget.value })} /></label>
          <label>{t('canvas.edgeRoute')}<select aria-label={t('canvas.edgeRoute')} value={edgeRouting(selectedEdge).route} onChange={(event) => {
            const routing = edgeRouting(selectedEdge);
            updateEdge(selectedEdge.id, edgeRoutingPatch(selectedEdge, event.currentTarget.value as CanvasEdgeRoute, routing.bend));
          }}><option value="straight">{t('canvas.route.straight')}</option><option value="elbow">{t('canvas.route.elbow')}</option><option value="curved">{t('canvas.route.curved')}</option></select></label>
          <label>{t('canvas.fromDirection')}<select value={selectedEdge.fromEnd === 'arrow' ? 'arrow' : 'none'} onChange={(event) => updateEdge(selectedEdge.id, { fromEnd: event.currentTarget.value })}><option value="none">{t('canvas.direction.none')}</option><option value="arrow">{t('canvas.direction.arrow')}</option></select></label>
          <label>{t('canvas.toDirection')}<select value={selectedEdge.toEnd === 'none' ? 'none' : 'arrow'} onChange={(event) => updateEdge(selectedEdge.id, { toEnd: event.currentTarget.value })}><option value="none">{t('canvas.direction.none')}</option><option value="arrow">{t('canvas.direction.arrow')}</option></select></label>
          <label>{t('canvas.fromSide')}<select value={edgeSide(selectedEdge.fromSide)} onChange={(event) => updateEdge(selectedEdge.id, { fromSide: event.currentTarget.value === 'auto' ? undefined : event.currentTarget.value })}><option value="auto">{t('canvas.side.auto')}</option><option value="left">{t('canvas.side.left')}</option><option value="right">{t('canvas.side.right')}</option><option value="top">{t('canvas.side.top')}</option><option value="bottom">{t('canvas.side.bottom')}</option></select></label>
          <label>{t('canvas.toSide')}<select value={edgeSide(selectedEdge.toSide)} onChange={(event) => updateEdge(selectedEdge.id, { toSide: event.currentTarget.value === 'auto' ? undefined : event.currentTarget.value })}><option value="auto">{t('canvas.side.auto')}</option><option value="left">{t('canvas.side.left')}</option><option value="right">{t('canvas.side.right')}</option><option value="top">{t('canvas.side.top')}</option><option value="bottom">{t('canvas.side.bottom')}</option></select></label>
          <button type="button" onClick={deleteSelectedEdge}>{t('canvas.menu.delete')}</button>
        </>}
        <span role="status" aria-live="polite">{t(`canvas.save.${saveState}`)}</span>
      </div>
      {error && <p className="q-canvas__warning" role="alert">{error}</p>}
      {actionError && <p className="q-canvas__warning" role="alert">{actionError}</p>}
      {saveState === 'conflict' && <div className="q-canvas__warning q-canvas__conflict" role="alert">
        <span>{t('canvas.conflictDescription')}</span>
        <button type="button" onClick={downloadLocalCopy}>{t('canvas.saveLocalCopy')}</button>
        <button type="button" onClick={() => { void reloadExternal(); }}>{t('canvas.reloadExternal')}</button>
      </div>}
      <div
        className={`q-canvas__stage q-canvas__stage--${grid}`}
        ref={stageRef}
        tabIndex={0}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onDblClick={(event) => {
          if (event.target === stageRef.current || event.target === worldRef.current) addNode('text', worldPoint(event));
        }}
        style={{
          backgroundSize: `${GRID_SIZE * camera.zoom}px ${GRID_SIZE * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
      >
        <svg className="q-canvas__edges" width={viewport.width} height={viewport.height}>
          <defs><marker id="q-canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--q-canvas-edge)" /></marker></defs>
          {document.edges.filter((edge) => visibleNodeIds.has(edge.fromNode) || visibleNodeIds.has(edge.toNode) || edge.id === selectedEdgeId).map((edge, index) => {
            const geometry = getCanvasEdgeGeometry(edge, nodeIndex);
            if (!geometry) return null;
            const from = screenPoint(geometry.from);
            const to = screenPoint(geometry.to);
            const color = canvasCssColor(edge.color);
            const routing = edgeRouting(edge);
            const bend = { x: routing.bend.x * camera.zoom, y: routing.bend.y * camera.zoom };
            const path = getCanvasEdgePath({ from, to }, routing.route, bend);
            const handle = {
              x: (from.x + to.x) / 2 + bend.x,
              y: (from.y + to.y) / 2 + bend.y,
            };
            return <g key={edge.id}>
              <defs>
                <marker id={`q-canvas-arrow-start-${index}`} markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M 8 0 L 0 4 L 8 8 z" fill={color ?? 'var(--q-canvas-edge)'} /></marker>
                <marker id={`q-canvas-arrow-end-${index}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill={color ?? 'var(--q-canvas-edge)'} /></marker>
              </defs>
              <path
                d={path}
                markerStart={edge.fromEnd === 'arrow' ? `url(#q-canvas-arrow-start-${index})` : undefined}
                markerEnd={edge.toEnd === 'none' ? undefined : `url(#q-canvas-arrow-end-${index})`}
                stroke={selectedEdgeId === edge.id ? 'var(--q-text-accent)' : color ?? 'var(--q-canvas-edge)'}
                strokeWidth={selectedEdgeId === edge.id ? 2 : 1}
                onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelection([]); }}
                role="button"
                tabIndex={0}
                aria-label={`${edge.fromNode} → ${edge.toNode}`}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedEdgeId(edge.id); }}
              />
              {selectedEdgeId === edge.id && routing.route !== 'straight' && <circle
                className="q-canvas__edge-handle"
                cx={handle.x}
                cy={handle.y}
                r="6"
                role="button"
                tabIndex={0}
                aria-label={t('canvas.edgeBend')}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const next: DragState = {
                    kind: 'edge-bend', startX: event.clientX, startY: event.clientY,
                    camera, edgeId: edge.id, route: routing.route, bend: routing.bend,
                  };
                  dragRef.current = next; setDrag(next); stageRef.current?.setPointerCapture(event.pointerId);
                }}
              />}
              {typeof edge.label === 'string' && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6}>{edge.label}</text>}
            </g>;
          })}
          {guides.map((guide) => {
            const at = screenPoint(guide.axis === 'x' ? { x: guide.at, y: 0 } : { x: 0, y: guide.at });
            return guide.axis === 'x'
              ? <line key={`x:${guide.at}`} className="q-canvas__guide" x1={at.x} y1="0" x2={at.x} y2={viewport.height} stroke="var(--q-text-accent)" />
              : <line key={`y:${guide.at}`} className="q-canvas__guide" x1="0" y1={at.y} x2={viewport.width} y2={at.y} stroke="var(--q-text-accent)" />;
          })}
          {drag?.kind === 'connect' && (() => {
            const source = document.nodes.find((node) => node.id === drag.fromId);
            if (!source) return null;
            const from = screenPoint(canvasSidePoint(source, drag.fromSide));
            const to = screenPoint(drag.current);
            return <line className="q-canvas__connect-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })()}
          {drag?.kind === 'draw' && <polyline
            points={drag.points.map((point) => {
              const screen = screenPoint(point);
              return `${screen.x},${screen.y}`;
            }).join(' ')}
            fill="none"
            stroke="var(--q-canvas-edge)"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />}
        </svg>
      <div ref={worldRef} className="q-canvas__world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          {visibleNodes.map((node) => {
            if (!isCanvasNode(node)) return null;
            const preview = node.type === 'file' ? fileContents[node.id] ?? '' : undefined;
            const shape = node.type === 'text' ? (node.obsidium as Record<string, unknown> | undefined)?.shape : undefined;
            const freehandPoints = shape === 'freehand' ? canvasFreehandPoints(node) : [];
            return <div
              key={node.id}
              className={`q-canvas__object${selection.includes(node.id) ? ' is-selected' : ''}${shape === 'number' ? ' q-canvas__object--ellipse q-canvas__object--number' : shape === 'ellipse' ? ' q-canvas__object--ellipse' : shape === 'rectangle' ? ' q-canvas__object--rectangle' : shape === 'diamond' ? ' q-canvas__object--diamond' : shape === 'freehand' ? ' q-canvas__object--freehand' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                ...(canvasCssColor(node.color) ? { '--q-canvas-node-color': canvasCssColor(node.color)! } : {}),
              }}
              onPointerDown={(event) => handleNodePointerDown(event, node)}
              onClick={(event) => handleNodeClick(event, node)}
              onDblClick={(event) => {
                event.stopPropagation();
                if (node.type === 'text') setEditingId(node.id);
                else if (node.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
                else if (node.type === 'link') openUrl(node.url);
                else if (node.type === 'group') setEditingId(node.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelection((current) => current.includes(node.id) ? current : [node.id]);
                const rect = stageRef.current?.getBoundingClientRect();
                if (rect) setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, nodeId: node.id });
              }}
              onDragStart={(event) => { event.preventDefault(); }}
            >
              <CanvasCard
                node={node}
                markdown={preview}
                color={canvasCssColor(node.color)}
                strokeColor={typeof shape === 'string' && ['diamond', 'ellipse', 'freehand', 'number', 'rectangle'].includes(shape)
                  ? 'var(--q-canvas-node-color, var(--q-canvas-default-stroke))'
                  : undefined}
                editing={editingId === node.id}
                selected={selectionSet.has(node.id)}
                compact={compact}
                resolveImageUrl={resolveImageUrl}
                onChange={handleTextChange}
                onResize={resizeTextNode}
                onEditComplete={finishTextEditing}
                onOpenUrl={openUrl}
                onOpenNoteLink={onOpenNoteLink ? (target, source) => {
                  void openNoteLink(node, target, source).catch((cause: unknown) => setActionError(String(cause)));
                } : undefined}
              >
                {node.type === 'group' && (editingId === node.id
                  ? <input className="q-canvas__group-label" aria-label={t('canvas.groupLabel')} value={node.label ?? ''} onInput={(event) => updateNode(node.id, { label: event.currentTarget.value }, false)} onBlur={() => { commitCurrentHistory(); setEditingId(null); }} />
                  : <span className="q-canvas__group-label">{node.label ?? ''}</span>)}
              </CanvasCard>
              {freehandPoints.length > 1 && <svg className="q-canvas__freehand" viewBox={`0 0 ${node.width} ${node.height}`} aria-hidden="true">
                <path d={canvasFreehandPath(freehandPoints)} stroke="var(--q-canvas-node-color, var(--q-canvas-edge))" />
              </svg>}
              {activeTool === 'select' && !spaceHeld && node.type !== 'group' && (['top', 'right', 'bottom', 'left'] as const).map((side) => <button
                key={side}
                type="button"
                className="q-canvas__connect"
                data-side={side}
                aria-label={`${t('canvas.connectHandle')} ${t(`canvas.side.${side}`)}`}
                onPointerDown={(event) => beginConnect(event, node, side)}
              />)}
              {selection.includes(node.id) && resizeHandles.map((handle) => <button
                key={handle}
                type="button"
                className="q-canvas__resize"
                data-handle={handle}
                aria-label={`${t('canvas.toolbar.resize')} ${t(`canvas.resizeHandle.${handle}`)}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const next: DragState = { kind: 'resize', startX: event.clientX, startY: event.clientY, camera, document, nodeId: node.id, handle };
                  dragRef.current = next; setDrag(next); stageRef.current?.setPointerCapture(event.pointerId);
                }}
              />)}
            </div>;
          })}
        </div>
        {drag?.kind === 'marquee' && <div className="q-canvas__marquee" style={{
          left: Math.min(drag.startX - (stageRef.current?.getBoundingClientRect().left ?? 0), drag.currentX - (stageRef.current?.getBoundingClientRect().left ?? 0)),
          top: Math.min(drag.startY - (stageRef.current?.getBoundingClientRect().top ?? 0), drag.currentY - (stageRef.current?.getBoundingClientRect().top ?? 0)),
          width: Math.abs(drag.currentX - drag.startX),
          height: Math.abs(drag.currentY - drag.startY),
        }} />}
        {menu && <div className="q-canvas__menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button role="menuitem" onClick={() => {
            const node = document.nodes.find((item) => item.id === menu.nodeId);
            if (node?.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
            else if (node?.type === 'link') openUrl(node.url);
            setMenu(null);
          }}>{t('canvas.menu.open')}</button>
          <button role="menuitem" onClick={() => {
            const node = document.nodes.find((item) => item.id === menu.nodeId);
            if (node?.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
            else if (node?.type === 'link') setLinkDraft({ mode: 'edit', nodeId: node.id, value: node.url });
            else setEditingId(menu.nodeId);
            setMenu(null);
          }}>{t('canvas.menu.edit')}</button>
          <button role="menuitem" onClick={() => duplicateNode(menu.nodeId)}>{t('canvas.menu.duplicate')}</button>
          <button role="menuitem" onClick={() => reorderSelection('front')}>{t('canvas.menu.front')}</button>
          <button role="menuitem" onClick={() => reorderSelection('back')}>{t('canvas.menu.back')}</button>
          <button role="menuitem" onClick={() => deleteNode(menu.nodeId)}>{t('canvas.menu.delete')}</button>
          <button role="menuitem" onClick={() => { addGroup(); setMenu(null); }}>{t('canvas.menu.group')}</button>
          {selection.length > 1 && <>
            <button role="menuitem" onClick={() => alignSelection('left')}>{t('canvas.align.left')}</button>
            <button role="menuitem" onClick={() => alignSelection('center-x')}>{t('canvas.align.centerX')}</button>
            <button role="menuitem" onClick={() => alignSelection('right')}>{t('canvas.align.right')}</button>
            <button role="menuitem" onClick={() => alignSelection('top')}>{t('canvas.align.top')}</button>
            <button role="menuitem" onClick={() => alignSelection('center-y')}>{t('canvas.align.centerY')}</button>
            <button role="menuitem" onClick={() => alignSelection('bottom')}>{t('canvas.align.bottom')}</button>
          </>}
          {document.nodes.find((item) => item.id === menu.nodeId)?.type === 'group' && <button role="menuitem" onClick={() => deleteNode(menu.nodeId)}>{t('canvas.menu.ungroup')}</button>}
        </div>}
        {slashMenu && <div
          className="q-canvas__slash"
          style={{ left: Math.min(screenPoint(slashMenu.point).x, Math.max(0, viewport.width - 300)), top: Math.min(screenPoint(slashMenu.point).y, Math.max(0, viewport.height - 240)) }}
          role="dialog"
          aria-label={t('canvas.slash.label')}
        >
          <input
            ref={slashInputRef}
            type="search"
            value={slashMenu.query}
            aria-label={t('canvas.slash.search')}
            placeholder={t('canvas.slash.search')}
            onInput={(event) => setSlashMenu((current) => current ? { ...current, query: event.currentTarget.value } : null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSlashMenu(null);
              else if (event.key === 'ArrowDown') {
                event.preventDefault();
                stageRef.current?.querySelector<HTMLButtonElement>('.q-canvas__slash button')?.focus();
              } else if (event.key === 'Enter' && visibleSlashCommands[0]) void runSlashCommand(visibleSlashCommands[0].id);
            }}
          />
          <div role="listbox" aria-label={t('canvas.slash.label')}>
            {visibleSlashCommands.map((item) => <button
              key={item.id}
              type="button"
              role="option"
              aria-label={t(item.label)}
              onClick={() => void runSlashCommand(item.id)}
            >{t(item.label)}</button>)}
            {visibleSlashCommands.length === 0 && <span role="status">{t('canvas.slash.noResults')}</span>}
          </div>
        </div>}
        <span className="q-canvas__selection-count" aria-live="polite">{edgeSource ? t('canvas.connectTarget') : selection.length ? t('canvas.selectionCount', { count: selection.length }) : ''}</span>
      </div>
      <CanvasLinkDialog
        open={Boolean(linkDraft)}
        mode={linkDraft?.mode ?? 'add'}
        initialValue={linkDraft?.value}
        onClose={() => setLinkDraft(null)}
        onSubmit={(url) => {
          const draft = linkDraft;
          setLinkDraft(null);
          if (!draft) return;
          if (draft.mode === 'edit' && draft.nodeId) updateNode(draft.nodeId, { url });
          else if (draft.point) addNode('link', draft.point, undefined, url);
          setActiveTool('select');
        }}
      />
      <CanvasNotePicker
        open={notePickerOpen}
        workspacePath={workspacePath}
        onClose={() => { notePlacementRef.current = null; setNotePickerOpen(false); }}
        onSelect={addSearchedNote}
      />
    </section>
  );
}
