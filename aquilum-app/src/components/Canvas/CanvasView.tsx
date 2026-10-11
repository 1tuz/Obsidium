import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TargetedDragEvent, TargetedKeyboardEvent, TargetedMouseEvent, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { t } from '../../i18n';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { absolutePath, fileName, parentDirectory, relativePath, samePath } from '../../modules/paths';
import { openExternalUrl } from '../../modules/openExternalUrl';
import { isCanvasPath, isFileCommandError, isMarkdownPath, readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { registerCanvasFlush } from '../../modules/canvas/persistence';
import {
  addCanvasEdge,
  addCanvasNode,
  parseCanvasDocument,
  removeCanvasEdge,
  removeCanvasNode,
  serializeCanvasDocument,
  updateCanvasEdge,
  updateCanvasNode,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasTypedNode,
} from '../../modules/canvas/model';
import {
  commitCanvasHistory,
  alignCanvasNodes,
  createCanvasHistory,
  getCanvasGroupMemberIds,
  getCanvasEdgeGeometry,
  redoCanvasHistory,
  resizeCanvasNode,
  selectCanvasNode,
  selectCanvasNodesInRect,
  translateCanvasNodes,
  undoCanvasHistory,
  type CanvasHistory,
  type CanvasAlignment,
} from '../../modules/canvas/interaction';
import { CanvasCard, type CanvasCardNode } from './CanvasCard';
import { CanvasNotePicker } from './CanvasNotePicker';
import { CanvasToolbar, type CanvasGrid, type CanvasPaperStyle, type CanvasTool } from './CanvasToolbar';
import './CanvasView.css';

type Camera = { x: number; y: number; zoom: number };
type CanvasClipboard = { nodes: CanvasTypedNode[]; edges: CanvasEdge[] };
type DragState =
  | { kind: 'move'; startX: number; startY: number; camera: Camera; document: CanvasDocument; selected: string[] }
  | { kind: 'resize'; startX: number; startY: number; camera: Camera; document: CanvasDocument; nodeId: string }
  | { kind: 'pan'; startX: number; startY: number; camera: Camera }
  | { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number; additive: boolean }
  | { kind: 'camera'; startX: number; startY: number; camera: Camera };

interface CanvasViewProps {
  path: string;
  workspacePath: string;
  inactive: boolean;
  indexRevision: number;
  onOpenFile: (path: string) => void;
}

const GRID_SIZE = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const AUTOSAVE_DELAY_MS = 400;
const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const CANVAS_PRESET_COLORS: Record<string, string> = {
  '1': '--q-red-600',
  '2': '--q-orange-600',
  '3': '--q-yellow-600',
  '4': '--q-green-600',
  '5': '--q-cyan-600',
  '6': '--q-purple-600',
};

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function colorInputValue(value: string): string {
  const variable = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (variable) return colorInputValue(getComputedStyle(document.documentElement).getPropertyValue(variable).trim());
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6,8})$/i)?.[1];
  if (hex) return `#${hex.length === 3 ? [...hex].map((channel) => `${channel}${channel}`).join('') : hex.slice(0, 6)}`;
  const rgb = value.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return '';
  return `#${rgb.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

function canvasCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^[1-6]$/.test(value)) return `var(${CANVAS_PRESET_COLORS[value]})`;
  return /^#[\da-f]{3,8}$/i.test(value) ? value : undefined;
}

function edgeSide(value: unknown): string {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom' ? value : 'auto';
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

function readCamera(document: CanvasDocument): Camera {
  const camera = boardPreferences(document).camera;
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) return { x: 0, y: 0, zoom: 1 };
  const value = camera as Record<string, unknown>;
  return {
    x: typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0,
    zoom: typeof value.zoom === 'number' && Number.isFinite(value.zoom)
      ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value.zoom))
      : 1,
  };
}

function withBoardPreferences(
  document: CanvasDocument,
  patch: Partial<{ paperStyle: CanvasPaperStyle; grid: CanvasGrid; camera: Camera }>,
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
    return `<marker id="arrow-start-${index}" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="${escapeXml(resolvedColor)}" /></marker><marker id="arrow-end-${index}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${escapeXml(resolvedColor)}" /></marker><path d="M ${geometry.from.x} ${geometry.from.y} L ${geometry.to.x} ${geometry.to.y}" stroke="${escapeXml(color)}" fill="none"${start}${end} />${label}`;
  }).join('');
  const body = nodes.map((node) => {
    const title = node.type === 'text' ? node.text : node.type === 'file' ? node.file : node.type === 'link' ? node.url : node.label;
    const fill = canvasCssColor(node.color) ?? colors.card;
    const resolvedFill = /^[1-6]$/.test(String(node.color)) ? colors.presets[String(node.color)] ?? colors.card : fill;
    const shape = node.type === 'text' ? (node.obsidium as Record<string, unknown> | undefined)?.shape : undefined;
    const frame = shape === 'ellipse'
      ? `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${escapeXml(resolvedFill)}" stroke="${escapeXml(colors.border)}" />`
      : `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${escapeXml(resolvedFill)}" stroke="${escapeXml(colors.border)}" />`;
    return `<g>${frame}<foreignObject x="${node.x + 12}" y="${node.y + 12}" width="${Math.max(1, node.width - 24)}" height="${Math.max(1, node.height - 24)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:16px sans-serif;white-space:pre-wrap;overflow:hidden;color:${escapeXml(colors.ink)}">${escapeXml(String(title ?? ''))}</div></foreignObject></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" style="color:${escapeXml(colors.ink)};background:${escapeXml(colors.paper)}">${edges}${body}</svg>`;
}

export function CanvasView({ path, workspacePath, inactive, indexRevision, onOpenFile }: CanvasViewProps) {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [history, setHistory] = useState<CanvasHistory<CanvasDocument> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'conflict' | 'error'>('saved');
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edgeSource, setEdgeSource] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeColor, setEdgeColor] = useState('');
  const [themeEdgeColor, setThemeEdgeColor] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<CanvasDocument | null>(null);
  const historyRef = useRef<CanvasHistory<CanvasDocument> | null>(null);
  const cameraRef = useRef(camera);
  const dragRef = useRef<DragState | null>(null);
  const hashRef = useRef('');
  const savedTextRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const saveTimerRef = useRef<number | null>(null);
  const clipboardRef = useRef<CanvasClipboard>({ nodes: [], edges: [] });
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

  const setCameraValue = useCallback((next: Camera, persist = true) => {
    const value = { ...next, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom)) };
    cameraRef.current = value;
    setCamera(value);
    const current = documentRef.current;
    if (current && persist) setCanvasDocument(withBoardPreferences(current, { camera: value }), false);
  }, [setCanvasDocument]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  const visibleNodes = useMemo(() => {
    if (!document) return [];
    const selected = new Set(selection);
    const left = -camera.x / camera.zoom;
    const top = -camera.y / camera.zoom;
    const right = (viewport.width - camera.x) / camera.zoom;
    const bottom = (viewport.height - camera.y) / camera.zoom;
    return document.nodes.filter((node) => (
      selected.has(node.id)
      || (node.x <= right && node.x + node.width >= left && node.y <= bottom && node.y + node.height >= top)
    ));
  }, [camera, document, selection, viewport]);
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
  const nodeIndex = useMemo(() => new Map((document?.nodes ?? []).map((node) => [node.id, node])), [document]);
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) setThemeEdgeColor(colorInputValue(getComputedStyle(stage).getPropertyValue('--q-canvas-edge').trim()));
  }, [paperStyle]);
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

  const resolveImageUrl = useCallback((node: CanvasCardNode, target: string) => {
    const base = node.type === 'file' && node.file
      ? parentDirectory(absolutePath(workspacePath, node.file))
      : workspacePath;
    try { return convertFileSrc(absolutePath(base, target)); } catch { return target; }
  }, [workspacePath]);

  const openUrl = useCallback((url: string) => {
    void openExternalUrl(url).catch((cause) => setError(String(cause)));
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
    const base = { id: newId(), x: point.x, y: point.y, width: 280, height: 180 };
    if (type === 'file' && file) node = { ...base, type, file };
    else if (type === 'link') node = { ...base, type, url: url ?? 'https://' };
    else node = {
      ...base,
      type: 'text',
      text: '',
      ...((type === 'rectangle' || type === 'ellipse') ? { obsidium: { shape: type } } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node));
    setSelection([node.id]);
    if (node.type === 'text') setEditingId(node.id);
  }, [setCanvasDocument]);

  const addSearchedNote = useCallback((path: string) => {
    const current = documentRef.current;
    if (!current) return;
    try {
      const anchor = current.nodes.find((node) => selection.includes(node.id));
      const point = {
        x: anchor ? anchor.x + anchor.width + GRID_SIZE : (viewport.width / 2 - camera.x) / camera.zoom,
        y: anchor ? anchor.y : (viewport.height / 2 - camera.y) / camera.zoom,
      };
      addNode('file', point, relativePath(workspacePath, path));
    } catch {
      setError(t('canvas.errors.fileOutsideWorkspace'));
    }
  }, [addNode, camera, selection, viewport, workspacePath]);

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
      id: newId(), type: 'group', x: left, y: top, width: right - left, height: bottom - top, label: t('canvas.toolbar.group'),
    };
    const insertion = Math.min(...selected.map((node) => current.nodes.indexOf(node)));
    const nodes = [...current.nodes];
    nodes.splice(insertion, 0, group);
    setCanvasDocument({ ...current, nodes });
    setSelection([group.id]);
  }, [selection, setCanvasDocument]);

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

  const undo = useCallback(() => {
    if (!historyRef.current) return;
    const next = undoCanvasHistory(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.current;
    setHistory(next);
    setDocument(next.current);
  }, []);
  const redo = useCallback(() => {
    if (!historyRef.current) return;
    const next = redoCanvasHistory(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.current;
    setHistory(next);
    setDocument(next.current);
  }, []);

  const handleNodePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>, node: CanvasTypedNode) => {
    if (event.button !== 0 || activeTool !== 'select') return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, a, button')) return;
    event.stopPropagation();
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
        document: current!, selected: [...selected],
      };
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      stageRef.current?.setPointerCapture(event.pointerId);
    }
  }, [activeTool, camera, selectNode]);

  const handleNodeClick = useCallback((event: TargetedMouseEvent<HTMLDivElement>, node: CanvasTypedNode) => {
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
  }, [activeTool, edgeColor, edgeSource, selection, setCanvasDocument]);

  const handlePointerMove = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag) return;
    const dx = event.clientX - currentDrag.startX;
    const dy = event.clientY - currentDrag.startY;
    if (currentDrag.kind === 'move') {
      const delta = { x: dx / currentDrag.camera.zoom, y: dy / currentDrag.camera.zoom };
      const next = {
        ...currentDrag.document,
        nodes: translateCanvasNodes(currentDrag.document.nodes, new Set(currentDrag.selected), delta, grid === 'none' ? undefined : GRID_SIZE),
      };
      setCanvasDocument(next, false);
    } else if (currentDrag.kind === 'resize') {
      const original = currentDrag.document.nodes.find((node) => node.id === currentDrag.nodeId);
      if (!original) return;
      const resized = resizeCanvasNode(original, {
        width: original.width + dx / currentDrag.camera.zoom,
        height: original.height + dy / currentDrag.camera.zoom,
      }, 120, 80, grid === 'none' ? undefined : GRID_SIZE);
      const current = documentRef.current;
      if (current) setCanvasDocument(updateCanvasNode(current, original.id, resized), false);
    } else if (currentDrag.kind === 'pan') {
      setCameraValue({ ...currentDrag.camera, x: currentDrag.camera.x + dx, y: currentDrag.camera.y + dy });
    } else if (currentDrag.kind === 'camera') {
      setCameraValue({ ...currentDrag.camera, x: currentDrag.camera.x + dx, y: currentDrag.camera.y + dy });
    } else {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = { ...currentDrag, currentX: event.clientX, currentY: event.clientY };
      dragRef.current = next;
      setDrag(next);
    }
  }, [grid, setCameraValue, setCanvasDocument]);

  const handlePointerUp = useCallback(() => {
    const currentDrag = dragRef.current;
    if (currentDrag?.kind === 'move' || currentDrag?.kind === 'resize') {
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
      setCanvasDocument(withBoardPreferences(documentRef.current, { camera: cameraRef.current }));
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
  }, [selection, setCanvasDocument, worldPoint]);

  const handleStagePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || (event.target !== stage && event.target !== worldRef.current)) return;
    const point = worldPoint(event);
    if (event.button === 1) {
      const next: DragState = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera };
      dragRef.current = next;
      setDrag(next);
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool !== 'select') {
      if (activeTool === 'text') addNode(activeTool, point);
      else if (activeTool === 'rectangle' || activeTool === 'ellipse') addNode(activeTool, point);
      else if (activeTool === 'link') {
        const url = window.prompt(t('canvas.toolbar.enterUrl'), 'https://');
        if (url) addNode(activeTool, point, undefined, url);
      } else if (activeTool === 'group') addGroup();
      else if (activeTool === 'file') {
        void open({ multiple: false, directory: false }).then((selectedPath) => {
          if (!selectedPath) return;
          try {
            const file = relativePath(workspacePath, selectedPath);
            addNode('file', point, file);
          } catch {
            setError(t('canvas.errors.fileOutsideWorkspace'));
          }
        });
      }
      setActiveTool('select');
      return;
    }
    if (event.button !== 0) return;
    setSelection([]);
    const rect = stage.getBoundingClientRect();
    const next: DragState = {
      kind: 'marquee', startX: event.clientX, startY: event.clientY,
      currentX: event.clientX - rect.left, currentY: event.clientY - rect.top, additive: event.shiftKey,
    };
    dragRef.current = next;
    setDrag(next);
    stage.setPointerCapture(event.pointerId);
  }, [activeTool, addGroup, addNode, camera, worldPoint, workspacePath]);

  const handleDrop = useCallback((event: TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const absolute = transfer.getData('application/x-obsidium-file-path') || transfer.getData('text/plain');
    if (!absolute || !isCanvasPath(path)) return;
    try {
      const file = relativePath(workspacePath, absolute);
      addNode('file', worldPoint(event), file);
    } catch {
      setError(t('canvas.errors.fileOutsideWorkspace'));
    }
  }, [addNode, worldPoint, workspacePath]);

  const handleWheel = useCallback((event: TargetedWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const current = cameraRef.current;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const ratio = nextZoom / current.zoom;
    const next = {
      zoom: nextZoom,
      x: pointerX - (pointerX - current.x) * ratio,
      y: pointerY - (pointerY - current.y) * ratio,
    };
    setCameraValue(next);
  }, [setCameraValue]);

  const handleKeyDown = useCallback((event: TargetedKeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('textarea,input,select')) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo();
    } else if (command && event.key.toLowerCase() === 'c') {
      const current = documentRef.current;
      const selected = new Set(selection);
      clipboardRef.current = {
        nodes: current?.nodes.filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node)) ?? [],
        edges: current?.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)) ?? [],
      };
    } else if (command && event.key.toLowerCase() === 'x') {
      const current = documentRef.current;
      const selected = new Set(selection);
      clipboardRef.current = {
        nodes: current?.nodes.filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node)) ?? [],
        edges: current?.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)) ?? [],
      };
      if (current) for (const id of selection) setCanvasDocument(removeCanvasNode(documentRef.current ?? current, id));
      setSelection([]);
    } else if (command && event.key.toLowerCase() === 'v' && documentRef.current && clipboardRef.current.nodes.length) {
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
      setSelection([]); setEdgeSource(null); setEditingId(null); setMenu(null);
    }
  }, [redo, selectedEdgeId, selection, setCanvasDocument, undo]);

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
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); setError(t('canvas.errors.exportFailed')); };
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
    } catch (cause) {
      setError(String(cause));
    }
  }, [path, setCameraValue]);

  const screenPoint = (point: { x: number; y: number }) => ({ x: camera.x + point.x * camera.zoom, y: camera.y + point.y * camera.zoom });

  if (loading) return <div className="q-canvas-loading" aria-busy="true">{t('canvas.loading')}</div>;
  if (error && !document) return <div className="q-canvas-error" role="alert">{t('canvas.errors.read', { reason: error })}</div>;
  if (!document) return null;

  return (
    <section
      className={`q-canvas${inactive ? ' q-canvas--inactive' : ''}`}
      data-paper-style={paperStyle}
      data-grid={grid}
      aria-label={fileName(path)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <CanvasToolbar
        paperStyle={paperStyle}
        grid={grid}
        activeTool={activeTool}
        canUndo={Boolean(history?.past.length)}
        canRedo={Boolean(history?.future.length)}
        onPaperStyleChange={onPaperStyleChange}
        onGridChange={onGridChange}
        onToolChange={setActiveTool}
        onUndo={undo}
        onRedo={redo}
        onAddNote={() => setNotePickerOpen(true)}
        onExportSvg={exportSvg}
        onExportPng={exportPng}
      />
      <div className="q-canvas__controls" aria-label={t('canvas.toolbar.view')}>
        <button type="button" onClick={() => setCameraValue({ ...camera, zoom: Math.max(MIN_ZOOM, camera.zoom / 1.2) })} aria-label={t('canvas.toolbar.zoomOut')}>−</button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button type="button" onClick={() => setCameraValue({ ...camera, zoom: Math.min(MAX_ZOOM, camera.zoom * 1.2) })} aria-label={t('canvas.toolbar.zoomIn')}>+</button>
        <button type="button" onClick={() => setCameraValue({ x: 0, y: 0, zoom: 1 })}>{t('canvas.toolbar.resetView')}</button>
        <label>{t('canvas.toolbar.edgeColor')}<input type="color" value={edgeColor || themeEdgeColor} onChange={(event) => setEdgeColor(event.currentTarget.value)} /></label>
        {selectedEdge && <>
          <label>{t('canvas.edgeLabel')}<input value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''} onInput={(event) => updateEdge(selectedEdge.id, { label: event.currentTarget.value })} /></label>
          <label>{t('canvas.fromDirection')}<select value={selectedEdge.fromEnd === 'arrow' ? 'arrow' : 'none'} onChange={(event) => updateEdge(selectedEdge.id, { fromEnd: event.currentTarget.value })}><option value="none">{t('canvas.direction.none')}</option><option value="arrow">{t('canvas.direction.arrow')}</option></select></label>
          <label>{t('canvas.toDirection')}<select value={selectedEdge.toEnd === 'none' ? 'none' : 'arrow'} onChange={(event) => updateEdge(selectedEdge.id, { toEnd: event.currentTarget.value })}><option value="none">{t('canvas.direction.none')}</option><option value="arrow">{t('canvas.direction.arrow')}</option></select></label>
          <label>{t('canvas.fromSide')}<select value={edgeSide(selectedEdge.fromSide)} onChange={(event) => updateEdge(selectedEdge.id, { fromSide: event.currentTarget.value === 'auto' ? undefined : event.currentTarget.value })}><option value="auto">{t('canvas.side.auto')}</option><option value="left">{t('canvas.side.left')}</option><option value="right">{t('canvas.side.right')}</option><option value="top">{t('canvas.side.top')}</option><option value="bottom">{t('canvas.side.bottom')}</option></select></label>
          <label>{t('canvas.toSide')}<select value={edgeSide(selectedEdge.toSide)} onChange={(event) => updateEdge(selectedEdge.id, { toSide: event.currentTarget.value === 'auto' ? undefined : event.currentTarget.value })}><option value="auto">{t('canvas.side.auto')}</option><option value="left">{t('canvas.side.left')}</option><option value="right">{t('canvas.side.right')}</option><option value="top">{t('canvas.side.top')}</option><option value="bottom">{t('canvas.side.bottom')}</option></select></label>
          <input aria-label={t('canvas.toolbar.edgeColor')} type="color" value={colorInputValue(canvasCssColor(selectedEdge.color) ?? themeEdgeColor)} onChange={(event) => updateEdge(selectedEdge.id, { color: event.currentTarget.value })} />
          <button type="button" onClick={deleteSelectedEdge}>{t('canvas.menu.delete')}</button>
        </>}
        <span role="status" aria-live="polite">{t(`canvas.save.${saveState}`)}</span>
      </div>
      {error && <p className="q-canvas__warning" role="alert">{error}</p>}
      {saveState === 'conflict' && <div className="q-canvas__warning q-canvas__conflict" role="alert">
        <span>{t('canvas.conflictDescription')}</span>
        <button type="button" onClick={downloadLocalCopy}>{t('canvas.saveLocalCopy')}</button>
        <button type="button" onClick={() => { void reloadExternal(); }}>{t('canvas.reloadExternal')}</button>
      </div>}
      <div
        className={`q-canvas__stage q-canvas__stage--${grid}`}
        ref={stageRef}
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
            return <g key={edge.id}>
              <defs>
                <marker id={`q-canvas-arrow-start-${index}`} markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M 8 0 L 0 4 L 8 8 z" fill={color ?? 'var(--q-canvas-edge)'} /></marker>
                <marker id={`q-canvas-arrow-end-${index}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill={color ?? 'var(--q-canvas-edge)'} /></marker>
              </defs>
              <path
                d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                markerStart={edge.fromEnd === 'arrow' ? `url(#q-canvas-arrow-start-${index})` : undefined}
                markerEnd={edge.toEnd === 'none' ? undefined : `url(#q-canvas-arrow-end-${index})`}
                stroke={selectedEdgeId === edge.id ? 'var(--q-text-accent)' : color ?? 'var(--q-canvas-edge)'}
                strokeWidth={selectedEdgeId === edge.id ? 4 : 2}
                onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelection([]); }}
                role="button"
                tabIndex={0}
                aria-label={`${edge.fromNode} → ${edge.toNode}`}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedEdgeId(edge.id); }}
              />
              {typeof edge.label === 'string' && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6}>{edge.label}</text>}
            </g>;
          })}
        </svg>
      <div ref={worldRef} className="q-canvas__world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          {visibleNodes.map((node) => {
            if (!isCanvasNode(node)) return null;
            const preview = node.type === 'file' ? fileContents[node.id] ?? '' : undefined;
            return <div
              key={node.id}
              className={`q-canvas__object${selection.includes(node.id) ? ' is-selected' : ''}${node.type === 'text' && (node.obsidium as Record<string, unknown> | undefined)?.shape === 'ellipse' ? ' q-canvas__object--ellipse' : node.type === 'text' && (node.obsidium as Record<string, unknown> | undefined)?.shape === 'rectangle' ? ' q-canvas__object--rectangle' : ''}`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
              onPointerDown={(event) => handleNodePointerDown(event, node)}
              onClick={(event) => handleNodeClick(event, node)}
              onDblClick={(event) => {
                event.stopPropagation();
                if (node.type === 'text') setEditingId(node.id);
                else if (node.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
                else if (node.type === 'link') openUrl(node.url);
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
                editing={editingId === node.id}
                selected={selection.includes(node.id)}
                resolveImageUrl={resolveImageUrl}
                onChange={handleTextChange}
                onEditComplete={commitCurrentHistory}
                onOpenUrl={openUrl}
              >
                {node.type === 'group' && (editingId === node.id
                  ? <input className="q-canvas__group-label" aria-label={t('canvas.groupLabel')} value={node.label ?? ''} onInput={(event) => updateNode(node.id, { label: event.currentTarget.value }, false)} onBlur={() => { commitCurrentHistory(); setEditingId(null); }} />
                  : <span className="q-canvas__group-label">{node.label ?? ''}</span>)}
              </CanvasCard>
              {selection.includes(node.id) && <button
                type="button"
                className="q-canvas__resize"
                aria-label={t('canvas.toolbar.resize')}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const next: DragState = { kind: 'resize', startX: event.clientX, startY: event.clientY, camera, document, nodeId: node.id };
                  dragRef.current = next; setDrag(next); stageRef.current?.setPointerCapture(event.pointerId);
                }}
              />}
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
            else if (node?.type === 'link') {
              const url = window.prompt(t('canvas.toolbar.enterUrl'), node.url);
              if (url) updateNode(node.id, { url });
            } else setEditingId(menu.nodeId);
            setMenu(null);
          }}>{t('canvas.menu.edit')}</button>
          <button role="menuitem" onClick={() => duplicateNode(menu.nodeId)}>{t('canvas.menu.duplicate')}</button>
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
        <span className="q-canvas__selection-count" aria-live="polite">{edgeSource ? t('canvas.connectTarget') : selection.length ? t('canvas.selectionCount', { count: selection.length }) : ''}</span>
      </div>
      <CanvasNotePicker
        open={notePickerOpen}
        workspacePath={workspacePath}
        onClose={() => setNotePickerOpen(false)}
        onSelect={addSearchedNote}
      />
    </section>
  );
}
