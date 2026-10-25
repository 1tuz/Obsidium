import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TargetedDragEvent, TargetedKeyboardEvent, TargetedMouseEvent, TargetedPointerEvent } from 'preact';
import { t } from '../../i18n';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { absolutePath, fileName, parentDirectory, resolveNotePath, samePath } from '../../modules/paths';
import { splitNoteLink, type CanvasNoteSource, type CanvasNoteTarget } from './canvasNoteLinks';
import { openExternalUrl } from '../../modules/openExternalUrl';
import { isFileCommandError, isMarkdownPath, readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { createUniqueFile } from '../../modules/documents/documentFactory';
import { recalledCanvasCamera, registerCanvasFlush, rememberCanvasCamera } from '../../modules/canvas/persistence';
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
  canvasNodeAnchor,
  moveCanvasEdgeEndpoint,
  canvasEdgeAnchor,
  canvasNodeAtPoint,
  canvasRectBetweenPoints,
  canvasSidePoint,
  createCanvasHistory,
  expandCanvasSelection,
  getCanvasGroupMemberIds,
  canvasEdgeArrowheads,
  getCanvasEdgeGeometry,
  getCanvasEdgePath,
  redoCanvasHistory,
  resizeCanvasGroup,
  resizeCanvasNodeFromHandle,
  resizeCanvasSelection,
  selectCanvasNode,
  selectCanvasNodesInRect,
  translateCanvasNodes,
  undoCanvasHistory,
  type CanvasHistory,
  type CanvasAlignment,
  type CanvasEdgeRoute,
  type CanvasRect,
  type CanvasResizeHandle,
  type CanvasSide,
} from '../../modules/canvas/interaction';
import { canvasFreehandPath } from '../../modules/canvas/freehand';
import { readCanvasAppearance, withCanvasAppearance, type CanvasAppearancePatch } from '../../modules/canvas/nodeProps';
import { CANVAS_PRESET_COLORS, canvasColorCss as canvasCssColor, canvasFillCss, canvasStickerFill } from '../../modules/canvas/palette';
import { copyPngToClipboard, svgToPngBlob } from '../../modules/canvas/svgToPng';
import { canvasNodeStyle, canvasPixels } from '../../modules/canvas/renderStyle';
import { canvasTextOverflow } from '../../modules/canvas/textFit';
import { mixCssColors } from '../../modules/canvas/colorMix';
import { resolveCanvasMedia } from '../../modules/canvas/media';
import { canvasSvg, canvasSvgAssetSources, type CanvasSvgMedia, type CanvasSvgPalette } from '../../modules/canvas/svgExport';
import { snapPointToNodes, snapResizeRect, snapToGuides, type CanvasGuide, type CanvasSnapPoint } from '../../modules/canvas/guides';
import { canvasWorkspacePath } from '../../modules/canvas/dropPath';
import { registerNoteDropTarget } from '../../modules/dragPayload';
import { mediaExtensionForFile, mediaKindForFile } from '../../modules/docs/imageEmbeds';
import { importIntoFiles } from '../../modules/docs/vaultFiles';
import {
  CANVAS_VIEW_MARGIN_PX,
  canvasContentBounds,
  canvasNodeVisible,
  canvasVisibleBounds,
  clampCanvasCamera,
  clampCanvasZoom,
  fitCanvasCamera,
  nextCanvasZoom,
  panCanvas,
  zoomCanvasAt,
  zoomCanvasAtCenter,
  type CanvasCamera,
  type CanvasZoomDirection,
} from '../../modules/canvas/viewport';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { CanvasCard, type CanvasCardNode } from './CanvasCard';
import { CanvasLinkDialog } from './CanvasLinkDialog';
import { CanvasNotePicker } from './CanvasNotePicker';
import { CanvasPropertiesPanel, type CanvasAppearanceCapabilities, type CanvasPanelTarget } from './CanvasPropertiesPanel';
import { CanvasShape, type CanvasShapeKind } from './CanvasShape';
import { CanvasToolbar, type CanvasGrid, type CanvasPaperStyle, type CanvasTool } from './CanvasToolbar';
import './CanvasView.css';

type CanvasClipboard = { nodes: CanvasTypedNode[]; edges: CanvasEdge[] };
type CanvasLinkDraft = { mode: 'add' | 'edit'; point?: CanvasPoint; nodeId?: string; value: string };
type CanvasPointerSample = { clientX: number; clientY: number; shiftKey: boolean };
type DragState =
  | { kind: 'move'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument; selected: ReadonlySet<string> }
  | { kind: 'resize'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument; nodeId: string; handle: CanvasResizeHandle }
  | {
    kind: 'resize-selection'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument;
    bounds: CanvasRect; handle: CanvasResizeHandle; selected: ReadonlySet<string>;
  }
  | { kind: 'edge-bend'; startX: number; startY: number; camera: CanvasCamera; edgeId: string; route: CanvasEdgeRoute; bend: CanvasPoint }
  | { kind: 'draw'; points: CanvasPoint[] }
  | { kind: 'shape'; start: CanvasPoint; startX: number; startY: number; nodeId: string; moved?: boolean }
  | { kind: 'pan'; startX: number; startY: number; camera: CanvasCamera }
  | { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number; additive: boolean }
  | { kind: 'connect'; fromId: string; fromSide: CanvasSide | 'auto'; startX: number; startY: number; camera: CanvasCamera; current: CanvasPoint; moved?: boolean; snapped?: CanvasSnapPoint | null }
  | { kind: 'edge-endpoint'; startX: number; startY: number; camera: CanvasCamera; document: CanvasDocument; edgeId: string; end: 'from' | 'to' }
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
const MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'm4v'];
const TEXT_CARD_MIN_HEIGHT = 40;
const AUTOSAVE_DELAY_MS = 400;
const CAMERA_PERSIST_DELAY_MS = 300;
const COMPACT_ZOOM_THRESHOLD = 0.4;
const GUIDE_SNAP_THRESHOLD_PX = 6;
const resizeHandles: readonly CanvasResizeHandle[] = [
  'top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left',
];

const slashCommands = [
  { id: 'text', label: 'canvas.slash.text' },
  { id: 'new-note', label: 'canvas.slash.newNote' },
  { id: 'find-note', label: 'canvas.slash.findNote' },
  { id: 'note', label: 'canvas.slash.note' },
  { id: 'image', label: 'canvas.slash.image' },
  { id: 'link', label: 'canvas.slash.link' },
  { id: 'group', label: 'canvas.slash.group' },
  { id: 'edge', label: 'canvas.slash.edge' },
  { id: 'rectangle', label: 'canvas.slash.rectangle' },
  { id: 'diamond', label: 'canvas.slash.diamond' },
  { id: 'number', label: 'canvas.slash.number' },
  { id: 'sticker', label: 'canvas.slash.sticker' },
  { id: 'ellipse', label: 'canvas.slash.ellipse' },
] as const;

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const editableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && Boolean(target.closest('textarea,input,select,[contenteditable="true"],.cm-editor'));

const clipboardText = (clipboard: DataTransfer, type: string): string => {
  try {
    return clipboard.getData(type) ?? '';
  } catch {
    return '';
  }
};

const localClipboardPath = (raw: string): string | null => {
  const first = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (!first || !(/^file:\/\//i.test(first) || /^(?:[a-zA-Z]:[\\/]|\/)/.test(first))) return null;
  const extension = first.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1].toLowerCase();
  return extension && MEDIA_EXTENSIONS.includes(extension) ? first : null;
};

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


function shapeKindOf(node: CanvasTypedNode): CanvasShapeKind | 'freehand' | null {
  const obsidium = node.obsidium;
  if (node.type !== 'text' || !obsidium || typeof obsidium !== 'object') return null;
  const shape = (obsidium as Record<string, unknown>).shape;
  return shape === 'rectangle' || shape === 'diamond' || shape === 'ellipse' || shape === 'number' || shape === 'sticker' || shape === 'freehand'
    ? shape
    : null;
}

function appearanceCapabilities(node: CanvasTypedNode): CanvasAppearanceCapabilities {
  const none: CanvasAppearanceCapabilities = {
    fill: false, stroke: false, strokeWidth: false, strokeStyle: false, corners: false, font: false,
  };
  if (node.type !== 'text') return none;
  const shape = shapeKindOf(node);
  if (shape === 'freehand') return { ...none, stroke: true, strokeWidth: true, strokeStyle: true };
  if (shape === 'sticker') return { ...none, fill: true, font: true };
  if (shape === 'rectangle') return { fill: true, stroke: true, strokeWidth: true, strokeStyle: true, corners: true, font: true };
  if (shape === 'diamond' || shape === 'ellipse' || shape === 'number') {
    return { fill: true, stroke: true, strokeWidth: true, strokeStyle: true, corners: false, font: true };
  }
  return { ...none, font: true };
}

function intersectCapabilities(
  left: CanvasAppearanceCapabilities,
  right: CanvasAppearanceCapabilities,
): CanvasAppearanceCapabilities {
  return {
    fill: left.fill && right.fill,
    stroke: left.stroke && right.stroke,
    strokeWidth: left.strokeWidth && right.strokeWidth,
    strokeStyle: left.strokeStyle && right.strokeStyle,
    corners: left.corners && right.corners,
    font: left.font && right.font,
  };
}

function nodeColorValue(node: CanvasTypedNode, palette: CanvasSvgPalette): string | undefined {
  if (typeof node.color !== 'string') return undefined;
  if (/^[1-6]$/.test(node.color)) return palette.presets[node.color];
  return /^#[\da-f]{3,8}$/i.test(node.color) ? node.color : undefined;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function imageDataUrl(url: string): Promise<string | null> {
  return fetch(url)
    .then((response) => response.ok ? response.blob() : null)
    .then((blob) => blob ? new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }) : null)
    .catch(() => null);
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
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [snapPoint, setSnapPoint] = useState<CanvasSnapPoint | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);
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
  const viewportRef = useRef(viewport);
  const dragRef = useRef<DragState | null>(null);
  const pressRef = useRef<{ node: CanvasTypedNode; shift: boolean } | null>(null);
  const pendingMoveRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    camera: CanvasCamera;
    document: CanvasDocument;
    selected: ReadonlySet<string>;
  } | null>(null);
  const dragMovedRef = useRef(false);
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
  const fileCacheRef = useRef(new Map<string, { revision: number; content: string }>());
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
    const value = clampCanvasCamera(
      { ...next, zoom: clampCanvasZoom(next.zoom) },
      canvasContentBounds(documentRef.current?.nodes ?? []),
      viewportRef.current,
    );
    cameraRef.current = value;
    rememberCanvasCamera(path, value);
    setCamera(value);
    if (cameraTimerRef.current !== null) window.clearTimeout(cameraTimerRef.current);
    cameraTimerRef.current = null;
    if (!persist) return;
    cameraTimerRef.current = window.setTimeout(() => {
      cameraTimerRef.current = null;
      const current = documentRef.current;
      if (current) setCanvasDocument(withBoardPreferences(current, { camera: cameraRef.current }), false);
    }, CAMERA_PERSIST_DELAY_MS);
  }, [path, setCanvasDocument]);

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
      setCameraValue(recalledCanvasCamera(path) ?? readCamera(parsed.value), false);
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
  const selectionRect = useMemo(
    () => canvasContentBounds((document?.nodes ?? []).filter((node) => selectionSet.has(node.id))),
    [document, selectionSet],
  );
  const selectedGroups = useMemo(
    () => (document?.nodes ?? []).filter((node) => selectionSet.has(node.id) && node.type === 'group'),
    [document, selectionSet],
  );
  const groupMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of selectedGroups) {
      for (const memberId of getCanvasGroupMemberIds(group, document?.nodes ?? [])) ids.add(memberId);
    }
    return ids;
  }, [document, selectedGroups]);
  const visibleNodes = useMemo(() => {
    if (!document) return [];
    const bounds = canvasVisibleBounds(camera, viewport, CANVAS_VIEW_MARGIN_PX);
    if (!bounds) return document.nodes;
    return document.nodes.filter((node) => selectionSet.has(node.id) || canvasNodeVisible(node, bounds));
  }, [camera, document, selectionSet, viewport]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleFileKey = visibleNodes
    .filter((node) => node.type === 'file' && node.file && isMarkdownPath(node.file))
    .map((node) => `${node.id}:${node.file}`)
    .join('\n');
  useEffect(() => {
    const nodes = visibleNodes.filter((node) => node.type === 'file' && node.file && isMarkdownPath(node.file));
    let cancelled = false;
    let cursor = 0;
    const output: Record<string, string> = {};
    const missing: typeof nodes = [];
    for (const node of nodes) {
      if (node.type !== 'file' || !node.file) continue;
      const cached = fileCacheRef.current.get(node.file);
      if (cached && cached.revision === indexRevision) output[node.id] = cached.content;
      else missing.push(node);
    }
    if (missing.length === 0) {
      if (!cancelled) setFileContents(output);
      return undefined;
    }
    const worker = async () => {
      while (cursor < missing.length) {
        const node = missing[cursor];
        cursor += 1;
        if (node.type !== 'file' || !node.file) continue;
        try {
          const content = (await readFileSnapshot(absolutePath(workspacePath, node.file))).content;
          fileCacheRef.current.set(node.file, { revision: indexRevision, content });
          output[node.id] = content;
        } catch {
          output[node.id] = '';
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker)).then(() => {
      if (!cancelled) setFileContents(output);
    });
    return () => { cancelled = true; };
  }, [indexRevision, visibleFileKey, workspacePath]);

  const viewportObserverRef = useRef<ResizeObserver | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => {
    viewportObserverRef.current?.disconnect();
    viewportObserverRef.current = null;
    stageRef.current = node;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = { width: entry.contentRect.width, height: entry.contentRect.height };
      viewportRef.current = size;
      setViewport(size);
    });
    observer.observe(node);
    viewportObserverRef.current = observer;
  }, []);
  useEffect(() => () => {
    viewportObserverRef.current?.disconnect();
    viewportObserverRef.current = null;
  }, []);

  const paperStyle = document ? readPaperStyle(document) : 'paper-white';
  const grid = document ? readGrid(document) : 'none';
  const selectedEdge = document?.edges.find((edge) => edge.id === selectedEdgeId);
  const visibleSlashCommands = slashCommands.filter(({ label }) => t(label).toLowerCase().includes(slashMenu?.query.toLowerCase() ?? ''));
  const nodeIndex = useMemo(() => new Map((document?.nodes ?? []).map((node) => [node.id, node])), [document]);
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
    const next = Math.max(TEXT_CARD_MIN_HEIGHT, Math.ceil(height));
    if (next <= node.height) return;
    setCanvasDocument(updateCanvasNode(current, nodeId, { height: next }), false);
  }, [setCanvasDocument]);

  const fitTextOnEdit = useCallback((nodeId: string) => {
    window.requestAnimationFrame(() => {
      const card = stageRef.current?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
      const textarea = card?.querySelector<HTMLTextAreaElement>('textarea');
      if (!card || !textarea) return;
      const overflow = card.classList.contains('q-canvas-card--shape')
        ? canvasTextOverflow(textarea)
        : textarea.scrollHeight - textarea.clientHeight;
      if (overflow > 0) {
        resizeTextNode(nodeId, (documentRef.current?.nodes.find((item) => item.id === nodeId)?.height ?? 0) + overflow);
      }
      window.requestAnimationFrame(() => {
        const current = stageRef.current?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
        const field = current?.querySelector<HTMLTextAreaElement>('textarea');
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(field.value.length, field.value.length);
      });
    });
  }, [resizeTextNode]);

  const beginTextEditing = useCallback((nodeId: string) => {
    setEditingId(nodeId);
    fitTextOnEdit(nodeId);
  }, [fitTextOnEdit]);

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
    const resolution = resolveCanvasMedia({
      workspacePath,
      canvasPath: path,
      nodeType: node.type,
      nodeFile: node.file,
      target,
    });
    if (!resolution) return target;
    if (resolution.external) return resolution.url;
    try { return convertFileSrc(resolution.url); } catch { return resolution.url; }
  }, [path, workspacePath]);

  const mediaForNode = useCallback((node: CanvasTypedNode): CanvasSvgMedia | null => {
    if (node.type === 'file' && node.file) {
      const resolution = resolveCanvasMedia({
        workspacePath,
        canvasPath: path,
        nodeType: 'file',
        nodeFile: node.file,
        target: node.file,
      });
      if (!resolution) return null;
      return {
        kind: resolution.kind,
        src: resolution.external ? resolution.url : resolveImageUrl(node, node.file),
        label: fileName(node.file),
      };
    }
    if (node.type === 'link' && node.url) {
      const resolution = resolveCanvasMedia({
        workspacePath,
        canvasPath: path,
        nodeType: 'link',
        target: node.url,
      });
      if (!resolution || resolution.kind !== 'image') return null;
      return {
        kind: 'image',
        src: resolution.external ? resolution.url : resolveImageUrl(node, node.url),
        label: node.url,
      };
    }
    return null;
  }, [path, resolveImageUrl, workspacePath]);

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

  const addNode = useCallback((type: 'text' | 'sticker' | 'file' | 'link' | 'rectangle' | 'diamond' | 'ellipse', point: { x: number; y: number }, file?: string, url?: string) => {
    const current = documentRef.current;
    if (!current) return;
    let node: CanvasTypedNode;
    const base = { id: newId(), x: Math.round(point.x), y: Math.round(point.y), width: 280, ...(nodeColor ? { color: nodeColor } : {}) };
    if (type === 'file' && file) node = { ...base, height: 180, type, file };
    else if (type === 'link') node = { ...base, height: 180, type, url: url ?? 'https://' };
    else if (type === 'sticker') {
      node = {
        ...base,
        width: 200,
        height: 160,
        type: 'text',
        text: '',
        obsidium: { shape: 'sticker' },
      };
    } else node = {
      ...base,
      height: type === 'text' ? TEXT_CARD_MIN_HEIGHT : 180,
      type: 'text',
      text: '',
      ...((type === 'rectangle' || type === 'diamond' || type === 'ellipse')
        ? { obsidium: { shape: type, fill: 'transparent' } }
        : {}),
    };
    setCanvasDocument(addCanvasNode(current, node));
    setSelection([node.id]);
    if (node.type === 'text') beginTextEditing(node.id);
  }, [beginTextEditing, nodeColor, setCanvasDocument]);

  const beginShapeDrawing = useCallback((type: 'rectangle' | 'diamond' | 'ellipse', event: { clientX: number; clientY: number; pointerId: number }) => {
    const current = documentRef.current;
    const point = worldPoint(event);
    if (!current) return;
    setSelectedEdgeId(null);
    const start = { x: Math.round(point.x), y: Math.round(point.y) };
    const node: CanvasTypedNode = {
      id: newId(), type: 'text', ...start, width: 1, height: 1, text: '',
      obsidium: { shape: type, fill: 'transparent' },
      ...(nodeColor ? { color: nodeColor } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node), false);
    setSelection([node.id]);
    const next: DragState = { kind: 'shape', start, startX: event.clientX, startY: event.clientY, nodeId: node.id };
    dragRef.current = next;
    setDrag(next);
    stageRef.current?.focus();
    stageRef.current?.setPointerCapture(event.pointerId);
  }, [nodeColor, setCanvasDocument, worldPoint]);

  const attachImage = useCallback(async (point: CanvasPoint) => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t('canvas.toolbar.tool.image'), extensions: MEDIA_EXTENSIONS }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const relative = await importIntoFiles(
        workspacePath,
        { kind: 'path', sourcePath: selected },
        { fallbackName: 'image', fallbackExt: 'png' },
      );
      addNode('file', point, relative);
    } catch {
      setActionError(t('canvas.errors.imageImport'));
    }
  }, [addNode, workspacePath]);

  const viewportCenter = useCallback((): CanvasPoint => ({
    x: (viewport.width / 2 - camera.x) / camera.zoom,
    y: (viewport.height / 2 - camera.y) / camera.zoom,
  }), [camera, viewport]);

  const chooseTool = useCallback((tool: CanvasTool) => {
    if (tool === 'image') {
      setActiveTool('select');
      void attachImage(viewportCenter());
      return;
    }
    if (tool === 'note') {
      setActiveTool('select');
      notePlacementRef.current = viewportCenter();
      setNotePickerOpen(true);
      return;
    }
    setActiveTool(tool);
  }, [attachImage, viewportCenter]);

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
      const relative = canvasWorkspacePath(workspacePath, path);
      if (!relative) {
        setActionError(t('canvas.errors.noteMissing'));
        return;
      }
      addNode('file', point, relative);
      notePlacementRef.current = null;
    } catch {
      setActionError(t('canvas.errors.noteMissing'));
    }
  }, [addNode, camera, selection, viewport, workspacePath]);

  const createCanvasNote = useCallback(async (title: string, point: CanvasPoint | null) => {
    const placement = point ?? notePlacementRef.current ?? {
      x: (viewport.width / 2 - camera.x) / camera.zoom,
      y: (viewport.height / 2 - camera.y) / camera.zoom,
    };
    try {
      const created = await createUniqueFile(workspacePath, title);
      if (!created) {
        setActionError(t('canvas.errors.noteCreate'));
        return;
      }
      const relative = canvasWorkspacePath(workspacePath, created);
      if (!relative) {
        setActionError(t('canvas.errors.noteCreate'));
        return;
      }
      addNode('file', placement, relative);
    } catch (cause) {
      setActionError(String(cause));
    } finally {
      notePlacementRef.current = null;
    }
  }, [addNode, camera, viewport, workspacePath]);

  const runSlashCommand = useCallback(async (commandId: string) => {
    const point = slashMenu?.point;
    if (!point) return;
    setSlashMenu(null);
    if (commandId === 'text') addNode('text', point);
    else if (commandId === 'new-note') await createCanvasNote(t('canvas.slash.defaultNoteTitle'), point);
    else if (commandId === 'find-note' || commandId === 'note') {
      notePlacementRef.current = point;
      setNotePickerOpen(true);
    } else if (commandId === 'image') await attachImage(point);
    else if (commandId === 'link') setLinkDraft({ mode: 'add', point, value: '' });
    else setActiveTool(commandId as CanvasTool);
  }, [addNode, attachImage, createCanvasNote, slashMenu]);

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

  const deleteSelection = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    if (selectedEdgeId) {
      setCanvasDocument(removeCanvasEdge(current, selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }
    if (selection.length === 0) return;
    let next = current;
    for (const id of selection) next = removeCanvasNode(next, id);
    setCanvasDocument(next);
    setSelection([]);
  }, [selectedEdgeId, selection, setCanvasDocument]);

  const readCanvasColors = useCallback((): CanvasSvgPalette => {
    const stage = stageRef.current ?? window.document.documentElement;
    const probe = window.document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;';
    stage.appendChild(probe);
    const read = (name: string, property: 'color' | 'background-color' = 'background-color') => {
      probe.style.removeProperty(property);
      probe.style.setProperty(property, `var(${name})`);
      const value = getComputedStyle(probe).getPropertyValue(property).trim();
      probe.style.removeProperty(property);
      return value;
    };
    const fallback = getComputedStyle(stage).color || 'currentColor';
    const paper = read('--q-canvas-paper') || getComputedStyle(stage).backgroundColor;
    const ink = read('--q-canvas-ink', 'color') || fallback;
    const card = read('--q-canvas-card') || mixCssColors(ink, paper, 0.12);
    const border = read('--q-canvas-border') || mixCssColors(ink, paper, 0.82);
    const edge = read('--q-canvas-edge') || mixCssColors(ink, paper, 0.45);
    const presets = Object.fromEntries(Object.entries(CANVAS_PRESET_COLORS).map(([preset, variable]) => [
      preset,
      read(variable) || ink,
    ]));
    probe.remove();
    return { paper, ink, card, border, edge, presets };
  }, []);

  const exportContext = useCallback(async (current: CanvasDocument, textMode: 'html' | 'svg' = 'html'): Promise<string> => {
    const palette = readCanvasColors();
    const hrefs = new Map<string, string>();
    await Promise.all(canvasSvgAssetSources(current, mediaForNode).map(async (src) => {
      const data = await imageDataUrl(src);
      if (data) hrefs.set(src, data);
    }));
    return canvasSvg(current, {
      palette,
      media: mediaForNode,
      imageHref: (src) => hrefs.get(src) ?? '',
      markdown: (node) => node.type === 'text'
        ? node.text
        : node.type === 'file' ? fileContents[node.id] ?? '' : '',
      resolveImage: (node, target) => resolveImageUrl(node, target),
      shapeStroke: (node) => nodeColorValue(node, palette) ?? mixCssColors(palette.ink, palette.paper, 0.22),
      shapeFill: (node) => nodeColorValue(node, palette) ?? mixCssColors(palette.ink, palette.paper, 0.8),
      appearance: (node) => readCanvasAppearance(node),
      textMode,
    });
  }, [fileContents, mediaForNode, readCanvasColors, resolveImageUrl]);

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

  const zoomBy = useCallback((direction: CanvasZoomDirection) => {
    const current = cameraRef.current;
    const factor = nextCanvasZoom(current.zoom, direction) / current.zoom;
    setCameraValue(zoomCanvasAtCenter(current, viewportRef.current, factor));
  }, [setCameraValue]);

  const fitView = useCallback(() => {
    const current = documentRef.current;
    const bounds = canvasContentBounds(current?.nodes ?? []);
    setCameraValue(fitCanvasCamera(bounds, viewport));
  }, [setCameraValue, viewport]);

  const reorderSelection = useCallback((direction: 'front' | 'back') => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = new Set(expandCanvasSelection(selection, current.nodes));
    const chosen = current.nodes.filter((node) => selected.has(node.id));
    const rest = current.nodes.filter((node) => !selected.has(node.id));
    const nodes = direction === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
    setCanvasDocument({ ...current, nodes });
    setMenu(null);
  }, [selection, setCanvasDocument]);

  const copySelection = useCallback(() => {
    const current = documentRef.current;
    const selected = new Set(expandCanvasSelection(selection, current?.nodes ?? []));
    clipboardRef.current = {
      nodes: current?.nodes.filter((node): node is CanvasTypedNode => selected.has(node.id) && isCanvasNode(node)) ?? [],
      edges: current?.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)) ?? [],
    };
    return clipboardRef.current.nodes.length > 0;
  }, [selection]);

  const copySelectionAsImage = useCallback(() => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = new Set(expandCanvasSelection(selection, current.nodes));
    const nodes = current.nodes.filter((node) => selected.has(node.id));
    const edges = current.edges.filter((edge) => selected.has(edge.fromNode) && selected.has(edge.toNode));
    void exportContext({ ...current, nodes, edges }, 'svg')
      .then((svg) => copyPngToClipboard(svg))
      .then((copied) => {
        if (!copied) setActionError(t('canvas.errors.copyImageUnavailable'));
      })
      .catch(() => setActionError(t('canvas.errors.copyImageUnavailable')));
  }, [exportContext, selection]);

  const pasteClipboard = useCallback((at?: CanvasPoint) => {
    const current = documentRef.current;
    const copiedNodes = clipboardRef.current.nodes;
    if (!current || copiedNodes.length === 0) return;
    const ids = new Map(copiedNodes.map((node) => [node.id, newId()]));
    const left = Math.min(...copiedNodes.map((node) => node.x));
    const top = Math.min(...copiedNodes.map((node) => node.y));
    const target = at ?? { x: left + GRID_SIZE, y: top + GRID_SIZE };
    const copies = copiedNodes.map((node) => ({
      ...node,
      id: ids.get(node.id)!,
      x: Math.round(target.x + (node.x - left)),
      y: Math.round(target.y + (node.y - top)),
    }));
    const edges = clipboardRef.current.edges.map((edge) => ({
      ...edge,
      id: newId(),
      fromNode: ids.get(edge.fromNode)!,
      toNode: ids.get(edge.toNode)!,
    }));
    setCanvasDocument({ ...current, nodes: [...current.nodes, ...copies], edges: [...current.edges, ...edges] });
    setSelection(copies.map((node) => node.id));
  }, [setCanvasDocument]);

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

  const ungroupSelection = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    const groups = current.nodes.filter((node) => selection.includes(node.id) && node.type === 'group');
    if (groups.length === 0) return;
    const members = new Set<string>();
    for (const group of groups) {
      for (const memberId of getCanvasGroupMemberIds(group, current.nodes)) members.add(memberId);
    }
    let next = current;
    for (const group of groups) next = removeCanvasNode(next, group.id);
    setCanvasDocument(next);
    setSelection([...members]);
    setMenu(null);
  }, [selection, setCanvasDocument]);

  const handleNodePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>, node: CanvasTypedNode) => {
    if (event.button !== 0) return;
    dragMovedRef.current = false;
    if (spaceHeld) {
      event.stopPropagation();
      const next: DragState = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera: cameraRef.current };
      dragRef.current = next;
      setDrag(next);
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'edge') {
      event.stopPropagation();
      event.preventDefault();
      setSelectedEdgeId(null);
      const next: DragState = {
        kind: 'connect', fromId: node.id, fromSide: 'auto',
        startX: event.clientX, startY: event.clientY,
        camera: cameraRef.current, current: worldPoint(event),
      };
      dragRef.current = next;
      setDrag(next);
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    const shapeTool = activeTool === 'rectangle' || activeTool === 'diamond' || activeTool === 'ellipse';
    if (activeTool !== 'select' && !shapeTool) return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, a, button')) return;
    event.stopPropagation();
    if (shapeTool) setActiveTool('select');
    else pressRef.current = { node, shift: event.shiftKey };
    setSelectedEdgeId(null);
    const current = documentRef.current;
    if (!current) return;
    const nextSelection = selectNode(node, event);
    const cluster = expandCanvasSelection([node.id], current.nodes);
    const resolved = expandCanvasSelection(nextSelection, current.nodes)
      .filter((id) => nextSelection.includes(node.id) || !cluster.includes(id));
    setSelection(resolved);
    if (resolved.includes(node.id)) {
      pendingMoveRef.current = {
        pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        camera, document: current, selected: new Set(resolved),
      };
    }
  }, [activeTool, camera, selectNode, selection, spaceHeld, worldPoint]);

  const handleNodeClick = useCallback((event: TargetedMouseEvent<HTMLDivElement>, node: CanvasTypedNode) => {
    if (spaceHeld) {
      event.stopPropagation();
      return;
    }
    if (activeTool === 'edge') {
      event.stopPropagation();
      if (!edgeSource) {
        setEdgeSource(node.id);
        if (documentRef.current) setSelection(expandCanvasSelection([node.id], documentRef.current.nodes));
      } else if (edgeSource !== node.id && documentRef.current) {
        const edge: CanvasEdge = {
          id: newId(), fromNode: edgeSource, toNode: node.id, fromEnd: 'none', toEnd: 'arrow',
        };
        setCanvasDocument(addCanvasEdge(documentRef.current, edge));
        setEdgeSource(null);
      }
      return;
    }
    if (activeTool === 'group') {
      event.stopPropagation();
      const current = documentRef.current;
      if (current) setSelection(expandCanvasSelection([...new Set([...selection, node.id])], current.nodes));
      return;
    }
    if (activeTool !== 'select') return;
    event.stopPropagation();
  }, [activeTool, edgeSource, selection, setCanvasDocument, spaceHeld]);

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
      const moved = currentDrag.moved === true
        || Math.abs(pointer.clientX - currentDrag.startX) > 4
        || Math.abs(pointer.clientY - currentDrag.startY) > 4;
      const raw = worldPoint(pointer);
      const snap = snapPointToNodes(
        raw,
        documentRef.current?.nodes ?? [],
        GUIDE_SNAP_THRESHOLD_PX / cameraRef.current.zoom,
        new Set([currentDrag.fromId]),
        false,
      );
      setSnapPoint(snap.snapped);
      const next = { ...currentDrag, current: snap.point, moved, snapped: snap.snapped };
      dragRef.current = next;
      setDrag(next);
      return;
    }
    if (currentDrag.kind === 'edge-endpoint') {
      const edge = currentDrag.document.edges.find((item) => item.id === currentDrag.edgeId);
      const raw = worldPoint(pointer);
      const anchorNodeId = currentDrag.end === 'from' ? edge?.fromNode : edge?.toNode;
      const target = canvasNodeAtPoint(currentDrag.document.nodes, raw, undefined)
        ?? currentDrag.document.nodes.find((node) => node.id === anchorNodeId)
        ?? null;
      if (edge && target) {
        const snap = snapPointToNodes(raw, [target], GUIDE_SNAP_THRESHOLD_PX / cameraRef.current.zoom, undefined, false);
        setSnapPoint(snap.snapped);
        const other = currentDrag.document.nodes.find((node) => node.id === (currentDrag.end === 'from' ? edge.toNode : edge.fromNode));
        const toward = other ? { x: other.x + other.width / 2, y: other.y + other.height / 2 } : undefined;
        const current = documentRef.current;
        if (current) {
          const anchor = snap.snapped ? snap.point : (() => {
            const outline = canvasEdgeAnchor(target, snap.point, toward ?? snap.point);
            return { x: target.x + outline.x * target.width, y: target.y + outline.y * target.height };
          })();
          const anchored = moveCanvasEdgeEndpoint(edge, currentDrag.end, target, anchor);
          const patch = currentDrag.end === 'from'
            ? { ...anchored, fromNode: target.id }
            : { ...anchored, toNode: target.id };
          setCanvasDocument(updateCanvasEdge(current, edge.id, patch), false);
        }
      }
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
      if (current) {
        const snapped = snapResizeRect(
          { x: resized.x, y: resized.y, width: resized.width, height: resized.height },
          currentDrag.document.nodes.filter((node) => node.id !== original.id),
          currentDrag.handle,
          GUIDE_SNAP_THRESHOLD_PX / currentDrag.camera.zoom,
        );
        setGuides(snapped.guides);
        let next = updateCanvasNode(current, original.id, {
          ...resized,
          x: snapped.rect.x,
          y: snapped.rect.y,
          width: Math.max(24, snapped.rect.width),
          height: Math.max(24, snapped.rect.height),
        });
        if (original.type === 'group') {
          const memberIds = new Set(getCanvasGroupMemberIds(original, currentDrag.document.nodes));
          const members = currentDrag.document.nodes.filter((node) => memberIds.has(node.id));
          for (const member of resizeCanvasGroup(original, members, resized)) {
            next = updateCanvasNode(next, member.id, member);
          }
        }
        setCanvasDocument(next, false);
      }
    } else if (currentDrag.kind === 'resize-selection') {
      const resized = resizeCanvasNodeFromHandle(
        { id: 'selection', type: 'group', ...currentDrag.bounds },
        currentDrag.handle,
        { x: dx / currentDrag.camera.zoom, y: dy / currentDrag.camera.zoom },
        pointer.shiftKey, 24, 24, grid === 'none' ? undefined : GRID_SIZE,
      );
      const current = documentRef.current;
      if (current) {
        const snapped = snapResizeRect(
          { x: resized.x, y: resized.y, width: resized.width, height: resized.height },
          current.nodes.filter((node) => !currentDrag.selected.has(node.id)),
          currentDrag.handle,
          GUIDE_SNAP_THRESHOLD_PX / currentDrag.camera.zoom,
        );
        setGuides(snapped.guides);
        const next: CanvasRect = {
          x: snapped.rect.x,
          y: snapped.rect.y,
          width: Math.max(24, snapped.rect.width),
          height: Math.max(24, snapped.rect.height),
        };
        setCanvasDocument({
          ...current,
          nodes: resizeCanvasSelection(current.nodes, currentDrag.selected, next),
        }, false);
      }
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
    const pending = pendingMoveRef.current;
    if (pending && !dragRef.current
      && (Math.abs(event.clientX - pending.startX) > 4 || Math.abs(event.clientY - pending.startY) > 4)) {
      pendingMoveRef.current = null;
      const next: DragState = {
        kind: 'move', startX: pending.startX, startY: pending.startY, camera: pending.camera,
        document: pending.document, selected: pending.selected,
      };
      dragRef.current = next;
      setDrag(next);
      stageRef.current?.setPointerCapture(pending.pointerId);
    }
    const currentDrag = dragRef.current;
    if (!currentDrag) return;
    if ('startX' in currentDrag
      && (Math.abs(event.clientX - currentDrag.startX) > 4 || Math.abs(event.clientY - currentDrag.startY) > 4)) {
      dragMovedRef.current = true;
    }
    pendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      flushPointerMoveRef.current();
    });
  }, [worldPoint]);

  const handlePointerUp = useCallback((cancelled = false) => {
    flushPointerMove();
    pendingMoveRef.current = null;
    const pressed = pressRef.current;
    pressRef.current = null;
    if (!cancelled && pressed && !dragMovedRef.current && !pressed.shift && pressed.node.type === 'file') {
      onOpenFile(absolutePath(workspacePath, pressed.node.file));
    }
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
        const node = createCanvasFreehandNode(newId(), currentDrag.points, nodeColor || undefined);
        setCanvasDocument(addCanvasNode(current, node));
        setSelection([node.id]);
      }
    } else if (currentDrag?.kind === 'connect') {
      const current = documentRef.current;
      const target = current ? canvasNodeAtPoint(current.nodes, currentDrag.current, currentDrag.fromId) : null;
      const source = current?.nodes.find((node) => node.id === currentDrag.fromId);
      if (current && target && source && (currentDrag.moved || currentDrag.fromSide !== 'auto')) {
        const sides = canvasEdgeSides(source, target);
        const origin = worldPoint({ clientX: currentDrag.startX, clientY: currentDrag.startY });
        const edge: CanvasEdge = {
          id: newId(), fromNode: source.id, toNode: target.id, fromEnd: 'none', toEnd: 'arrow',
          fromSide: currentDrag.fromSide === 'auto' ? sides.fromSide : currentDrag.fromSide,
          toSide: sides.toSide,
          fromAnchor: currentDrag.snapped
            ? canvasNodeAnchor(source, origin)
            : canvasEdgeAnchor(source, origin, { x: target.x + target.width / 2, y: target.y + target.height / 2 }),
          toAnchor: currentDrag.snapped
            ? canvasNodeAnchor(target, currentDrag.current)
            : canvasEdgeAnchor(target, currentDrag.current, { x: source.x + source.width / 2, y: source.y + source.height / 2 }),
        };
        setCanvasDocument(addCanvasEdge(current, edge));
        setSelectedEdgeId(edge.id);
        setSelection([]);
      }
    } else if (currentDrag?.kind === 'move' || currentDrag?.kind === 'resize' || currentDrag?.kind === 'resize-selection' || currentDrag?.kind === 'edge-bend' || currentDrag?.kind === 'edge-endpoint') {
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
    setSnapPoint(null);
  }, [flushPointerMove, nodeColor, onOpenFile, selection, setCanvasDocument, workspacePath, worldPoint]);

  const handleStagePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || (event.target !== stage && event.target !== worldRef.current)) return;
    stage.focus();
    dragMovedRef.current = false;
    if (event.button === 0) setSelectedEdgeId(null);
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
      if (activeTool === 'text' || activeTool === 'sticker') addNode(activeTool, point);
      else if (activeTool === 'group') addGroup();
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
  }, [activeTool, addGroup, addNode, addNumberMarker, beginShapeDrawing, camera, spaceHeld, worldPoint]);

  const handleDrop = useCallback((event: TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    if (transfer.files && transfer.files.length > 0) {
      void importMedia(Array.from(transfer.files), worldPoint(event));
      return;
    }
    const raw = transfer.getData('application/x-obsidium-file-path') || transfer.getData('text/plain') || transfer.getData('text/uri-list');
    if (!raw) return;
    const relative = canvasWorkspacePath(workspacePath, raw);
    const absolute = relative ? absolutePath(workspacePath, relative) : raw;
    const point = worldPoint(event);
    if (relative) {
      addNode('file', { x: point.x, y: point.y }, relative);
      return;
    }
    {
      const media = resolveCanvasMedia({
        workspacePath,
        canvasPath: path,
        nodeType: 'link',
        target: absolute,
      });
      if (!media) {
        setActionError(t('canvas.errors.dropUnsupported'));
        return;
      }
      const current = documentRef.current;
      if (!current) return;
      const node: CanvasTypedNode = {
        id: newId(), type: 'link', x: Math.round(point.x), y: Math.round(point.y),
        width: 280, height: 180, url: absolute,
        ...(nodeColor ? { color: nodeColor } : {}),
      };
      setCanvasDocument(addCanvasNode(current, node));
      setSelection([node.id]);
    }
  }, [addNode, importMedia, nodeColor, path, setCanvasDocument, worldPoint, workspacePath]);

  useEffect(() => registerNoteDropTarget((payload, clientX, clientY) => {
    const point = worldPoint({ clientX, clientY });
    const relative = canvasWorkspacePath(workspacePath, payload.path);
    if (!relative) {
      setActionError(t('canvas.errors.dropUnsupported'));
      return;
    }
    addNode('file', { x: point.x - 140, y: point.y - 60 }, relative);
  }), [addNode, worldPoint, workspacePath]);

  const importClipboardPath = useCallback(async (sourcePath: string, point: CanvasPoint) => {
    try {
      const relative = await importIntoFiles(
        workspacePath,
        { kind: 'path', sourcePath },
        { fallbackName: 'image', fallbackExt: 'png' },
      );
      addNode('file', { x: point.x, y: point.y }, relative);
    } catch (cause) {
      setActionError(String(cause));
    }
  }, [addNode, workspacePath]);

  const handlePaste = useCallback((event: ClipboardEvent) => {
    if (editableTarget(event.target)) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = Array.from(clipboard.files ?? []);
    if (files.length === 0) {
      for (const item of Array.from(clipboard.items ?? [])) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void importMedia(files, lastPointerRef.current);
      return;
    }
    const uriText = clipboardText(clipboard, 'text/uri-list');
    const plainText = clipboardText(clipboard, 'text/plain').trim();
    const localPath = localClipboardPath(uriText) ?? localClipboardPath(plainText);
    if (localPath) {
      event.preventDefault();
      const relative = canvasWorkspacePath(workspacePath, localPath);
      if (!relative) {
        setActionError(t('canvas.errors.dropUnsupported'));
        return;
      }
      void importClipboardPath(absolutePath(workspacePath, relative), lastPointerRef.current);
      return;
    }
    const media = plainText ? resolveCanvasMedia({
      workspacePath,
      canvasPath: path,
      nodeType: 'link',
      target: plainText,
    }) : null;
    if (!media) return;
    event.preventDefault();
    const point = lastPointerRef.current;
    const current = documentRef.current;
    if (!current) return;
    const node: CanvasTypedNode = {
      id: newId(), type: 'link', x: Math.round(point.x), y: Math.round(point.y),
      width: 280, height: 180, url: plainText,
      ...(nodeColor ? { color: nodeColor } : {}),
    };
    setCanvasDocument(addCanvasNode(current, node));
    setSelection([node.id]);
  }, [importClipboardPath, importMedia, nodeColor, path, setCanvasDocument, workspacePath]);

  useEffect(() => {
    if (inactive) return undefined;

    const boardOwnsFocus = () => {
      const section = stageRef.current?.closest('.q-canvas');
      if (!section) return false;
      const active = globalThis.document.activeElement;
      return !active || active === globalThis.document.body || section.contains(active);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || editableTarget(event.target)) return;
      handlePaste(event);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (editableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'c') {
        if (boardOwnsFocus() && copySelection()) event.preventDefault();
      } else if (key === 'v' && clipboardRef.current.nodes.length > 0) {
        event.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [copySelection, handlePaste, inactive, pasteClipboard]);

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
      zoomBy(1);
      return;
    }
    if (command && event.key === '-') {
      event.preventDefault();
      zoomBy(-1);
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
        beginTextEditing(node.id);
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
        KeyR: 'rectangle', KeyD: 'diamond', KeyE: 'ellipse', KeyN: 'number', KeyP: 'draw', KeyS: 'sticker',
        KeyV: 'select', KeyT: 'text', KeyF: 'image', KeyL: 'note', KeyG: 'group', KeyA: 'edge',
      } as const)[event.code];
      if (tool) {
        event.preventDefault();
        chooseTool(tool);
        return;
      }
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo();
    } else if (command && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelectionAsImage();
    } else if (command && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelection();
    } else if (command && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      if (copySelection()) deleteSelection();
    } else if (command && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteClipboard();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === 'Escape') {
      setSelection([]); setSelectedEdgeId(null); setEdgeSource(null); setEditingId(null); setMenu(null); setSlashMenu(null); setLinkDraft(null);
      setActiveTool('select');
    }
  }, [camera, chooseTool, copySelection, copySelectionAsImage, deleteSelection, duplicateSelection, fitView, onOpenFile, openUrl, pasteClipboard, redo, reorderSelection, spaceHeld, undo, viewport, workspacePath, zoomBy]);

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

  const applySelectionAppearance = useCallback((patch: CanvasAppearancePatch) => {
    const current = documentRef.current;
    if (!current || selection.length === 0) return;
    const selected = new Set(selection);
    setCanvasDocument({
      ...current,
      nodes: current.nodes.map((node) => selected.has(node.id) ? withCanvasAppearance(node, patch) : node),
    });
  }, [selection, setCanvasDocument]);

  const onSelectionStroke = useCallback((value: string) => {
    onCanvasColorChange(value);
  }, [onCanvasColorChange]);

  const onSelectionFill = useCallback((value: string | null) => {
    applySelectionAppearance({ fill: value });
  }, [applySelectionAppearance]);

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
    const current = documentRef.current;
    if (!current) return;
    const name = `${fileName(path).replace(/\.canvas$/i, '')}.svg`;
    void exportContext(current)
      .then((svg) => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), name))
      .catch((cause: unknown) => setActionError(String(cause)));
  }, [exportContext, path]);

  const exportPng = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    const name = `${fileName(path).replace(/\.canvas$/i, '')}.png`;
    void exportContext(current, 'svg')
      .then((svg) => svgToPngBlob(svg))
      .then((blob) => downloadBlob(blob, name))
      .catch(() => setActionError(t('canvas.errors.exportFailed')));
  }, [exportContext, path]);


  const exportJson = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    downloadBlob(new Blob([serializeCanvasDocument(current)], { type: 'application/json' }), fileName(path));
  }, [path]);

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
  const menuWorldPoint = (point: { x: number; y: number }): CanvasPoint => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });
  const menuNodeId = menu?.nodeId ?? null;
  const compact = camera.zoom < COMPACT_ZOOM_THRESHOLD;

  if (loading) return <div className="q-canvas-loading" aria-busy="true">{t('canvas.loading')}</div>;
  if (error && !document) return <div className="q-canvas-error" role="alert">{t('canvas.errors.read', { reason: error })}</div>;
  if (!document) return null;

  const selectedNode = selection.length > 0 ? document.nodes.find((node) => node.id === selection[0]) : undefined;
  const panelTarget: CanvasPanelTarget | null = selection.length > 0
    ? selectedNode
      ? {
        kind: 'nodes',
        appearance: readCanvasAppearance(selectedNode),
        capabilities: selection.reduce<CanvasAppearanceCapabilities>((current, id) => {
          const node = document?.nodes.find((item) => item.id === id);
          return node ? intersectCapabilities(current, appearanceCapabilities(node)) : current;
        }, appearanceCapabilities(selectedNode)),
        count: selection.length,
        canGroup: selection.length > 1,
        canUngroup: selectedGroups.length > 0,
        ...(typeof selectedNode.color === 'string' && selectedNode.color ? { stroke: selectedNode.color } : {}),
      }
      : null
    : selectedEdge
      ? {
        kind: 'edge',
        route: edgeRouting(selectedEdge).route,
        fromEnd: selectedEdge.fromEnd === 'arrow' ? 'arrow' : 'none',
        toEnd: selectedEdge.toEnd === 'none' ? 'none' : 'arrow',
        label: typeof selectedEdge.label === 'string' ? selectedEdge.label : '',
        ...(typeof selectedEdge.color === 'string' && selectedEdge.color ? { color: selectedEdge.color } : {}),
      }
      : null;
  const selectedGroup = selectedGroups.length === 1
    && selection.every((id) => id === selectedGroups[0].id || groupMemberIds.has(id))
    ? selectedGroups[0]
    : null;
  const frameRect: CanvasRect | null = selectedGroup
    ? { x: selectedGroup.x, y: selectedGroup.y, width: selectedGroup.width, height: selectedGroup.height }
    : selection.length > 1
      ? selectionRect
      : null;
  const selectionFrame = frameRect ? {
    x: camera.x + frameRect.x * camera.zoom,
    y: camera.y + frameRect.y * camera.zoom,
    width: frameRect.width * camera.zoom,
    height: frameRect.height * camera.zoom,
  } : null;

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
        if (!(event.target as HTMLElement).closest('.q-canvas__menu')) setMenu(null);
      }}
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
        onOpenSlash={() => setSlashMenu({
          point: { x: (viewport.width / 2 - camera.x) / camera.zoom, y: (viewport.height / 2 - camera.y) / camera.zoom },
          query: '',
        })}
        onToolChange={chooseTool}
        onUndo={undo}
        onRedo={redo}
        onAddNote={() => setNotePickerOpen(true)}
        onExportSvg={exportSvg}
        onExportPng={exportPng}
      />
      <div className="q-canvas__controls" role="group" aria-label={t('canvas.toolbar.view')}>
        <button type="button" onClick={() => zoomBy(-1)} aria-label={t('canvas.toolbar.zoomOut')}>−</button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1)} aria-label={t('canvas.toolbar.zoomIn')}>+</button>
        <IconButton label={t('canvas.toolbar.fitView')} size="small" onClick={fitView}><Icon icon="crop" size={16} /></IconButton>
        <IconButton label={t('canvas.toolbar.resetView')} size="small" onClick={() => setCameraValue({ x: 0, y: 0, zoom: 1 })}><Icon icon="rotate-ccw" size={16} /></IconButton>
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
        data-canvas-drop="true"
        ref={attachStage}
        tabIndex={0}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => handlePointerUp()}
        onPointerCancel={() => handlePointerUp(true)}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          if (event.target !== stageRef.current && event.target !== worldRef.current) return;
          event.preventDefault();
          const rect = stageRef.current?.getBoundingClientRect();
          if (!rect) return;
          setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, nodeId: null });
        }}
        onDblClick={(event) => {
          if (event.target === stageRef.current || event.target === worldRef.current) addNode('text', worldPoint(event));
        }}
        style={{
          backgroundSize: `${GRID_SIZE * camera.zoom}px ${GRID_SIZE * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
      >
        <svg className="q-canvas__edges" width={viewport.width} height={viewport.height}>
          {document.edges.filter((edge) => visibleNodeIds.has(edge.fromNode) || visibleNodeIds.has(edge.toNode) || edge.id === selectedEdgeId).map((edge) => {
            const geometry = getCanvasEdgeGeometry(edge, nodeIndex);
            if (!geometry) return null;
            const from = screenPoint(geometry.from);
            const to = screenPoint(geometry.to);
            const color = canvasCssColor(edge.color);
            const routing = edgeRouting(edge);
            const bend = { x: routing.bend.x * camera.zoom, y: routing.bend.y * camera.zoom };
            const path = getCanvasEdgePath({ from, to }, routing.route, bend);
            const arrowheads = canvasEdgeArrowheads({ from, to }, routing.route, bend, Math.max(10, Math.min(16, 12 * camera.zoom)));
            const selected = selectedEdgeId === edge.id;
            const select = (event: { stopPropagation: () => void }) => {
              event.stopPropagation();
              setSelectedEdgeId(edge.id);
              setSelection([]);
            };
            return <g key={edge.id} className={selected ? 'is-selected' : undefined}>
              <path
                className="q-canvas__edge-hit"
                d={path}
                onClick={select}
                onPointerDown={(event) => event.stopPropagation()}
                onDblClick={(event) => {
                  event.stopPropagation();
                  const current = documentRef.current;
                  if (!current) return;
                  setCanvasDocument(removeCanvasEdge(current, edge.id));
                  setSelectedEdgeId(null);
                }}
                aria-hidden="true"
              />
              <path
                className={selected ? 'is-selected' : undefined}
                d={path}
                stroke={selected ? 'var(--q-canvas-selection, var(--q-text-accent))' : color ?? 'var(--q-canvas-edge)'}
                onClick={select}
                role="button"
                tabIndex={0}
                aria-label={`${edge.fromNode} → ${edge.toNode}`}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedEdgeId(edge.id); }}
              />
              {edge.fromEnd === 'arrow' && arrowheads.start && <polygon className="q-canvas__arrow" points={arrowheads.start} fill={color ?? 'var(--q-canvas-edge)'} pointerEvents="none" />}
              {edge.toEnd !== 'none' && arrowheads.end && <polygon className="q-canvas__arrow" points={arrowheads.end} fill={color ?? 'var(--q-canvas-edge)'} pointerEvents="none" />}
              {typeof edge.label === 'string' && edge.label.trim() !== '' && <text
                className="q-canvas__edge-label"
                x={(from.x + to.x) / 2 + bend.x}
                y={(from.y + to.y) / 2 + bend.y - 8}
                textAnchor="middle"
                onClick={select}
              >{edge.label}</text>}
            </g>;
          })}
          {guides.map((guide) => {
            const at = screenPoint(guide.axis === 'x' ? { x: guide.at, y: 0 } : { x: 0, y: guide.at });
            return guide.axis === 'x'
              ? <line key={`x:${guide.at}`} className="q-canvas__guide" x1={at.x} y1="0" x2={at.x} y2={viewport.height} stroke="var(--q-canvas-selection, var(--q-text-accent))" />
              : <line key={`y:${guide.at}`} className="q-canvas__guide" x1="0" y1={at.y} x2={viewport.width} y2={at.y} stroke="var(--q-canvas-selection, var(--q-text-accent))" />;
          })}
          {drag?.kind === 'connect' && (() => {
            const source = document.nodes.find((node) => node.id === drag.fromId);
            if (!source) return null;
            const from = screenPoint(drag.fromSide === 'auto'
              ? { x: source.x + source.width / 2, y: source.y + source.height / 2 }
              : canvasSidePoint(source, drag.fromSide));
            const to = screenPoint(drag.current);
            return <line className="q-canvas__connect-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })()}
          {drag?.kind === 'draw' && <polyline
            points={drag.points.map((point) => {
              const screen = screenPoint(point);
              return `${screen.x},${screen.y}`;
            }).join(' ')}
            fill="none"
            stroke={canvasCssColor(nodeColor) ?? 'var(--q-canvas-edge)'}
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />}
        </svg>
      <div ref={worldRef} className="q-canvas__world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          {visibleNodes.map((node, paintIndex) => {
            if (!isCanvasNode(node)) return null;
            const preview = node.type === 'file' ? fileContents[node.id] ?? '' : undefined;
            const shapeName = shapeKindOf(node);
            const shape = shapeName && shapeName !== 'freehand' ? shapeName : undefined;
            const freehandPoints = shapeName === 'freehand' ? canvasFreehandPoints(node) : [];
            const media = mediaForNode(node);
            const selected = selectionSet.has(node.id) && !groupMemberIds.has(node.id);
            const obsidium = node.obsidium && typeof node.obsidium === 'object' ? node.obsidium as Record<string, unknown> : {};
            const fill = shape && (obsidium.fill === 'transparent' || obsidium.fill === undefined) ? 'transparent' : undefined;
            const appearance = readCanvasAppearance(node);
            const stickerFill = shape === 'sticker' ? canvasStickerFill(appearance.fill) : undefined;
            const shapeFill = stickerFill ?? (shape && appearance.fill ? canvasFillCss(appearance.fill) : undefined);
            return <div
              key={node.id}
              className={`q-canvas__object${selected ? ' is-selected' : ''}${shape ? ' q-canvas__object--shape' : ''}${shape === 'number' ? ' q-canvas__object--ellipse q-canvas__object--number' : shape === 'ellipse' ? ' q-canvas__object--ellipse' : shape === 'rectangle' ? ' q-canvas__object--rectangle' : shape === 'diamond' ? ' q-canvas__object--diamond' : shapeName === 'freehand' ? ' q-canvas__object--freehand' : ''}`}
              data-fill={fill}
              style={{
                ...canvasNodeStyle(node, paintIndex + 1),
                ...(canvasCssColor(node.color) ? { '--q-canvas-node-color': canvasCssColor(node.color)! } : {}),
                ...(appearance.opacity < 1 ? { opacity: String(appearance.opacity) } : {}),
              }}
              onPointerDown={(event) => handleNodePointerDown(event, node)}
              onClick={(event) => handleNodeClick(event, node)}
              onDblClick={(event) => {
                event.stopPropagation();
                if (node.type === 'text') beginTextEditing(node.id);
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
                color={shape ? undefined : canvasCssColor(node.color)}
                shape={shape ?? null}
                appearance={appearance}
                media={media}
                editing={editingId === node.id}
                selected={selected}
                compact={compact}
                openHint={node.type === 'file' ? t('canvas.card.openNote') : undefined}
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
                  ? <input
                    className="q-canvas__group-label"
                    aria-label={t('canvas.groupLabel')}
                    value={node.label ?? ''}
                    onInput={(event) => updateNode(node.id, { label: event.currentTarget.value }, false)}
                    onBlur={() => { commitCurrentHistory(); setEditingId(null); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.blur();
                    }}
                  />
                  : <span className="q-canvas__group-label">{node.label ?? ''}</span>)}
              </CanvasCard>
              {shape && <CanvasShape
                shape={shape}
                width={node.width}
                height={node.height}
                zoom={camera.zoom}
                selected={selected}
                strokeWidth={appearance.strokeWidth}
                strokeStyle={appearance.strokeStyle}
                corners={appearance.corners}
                fill={shapeFill}
              />}
              {freehandPoints.length > 1 && <svg className="q-canvas__freehand" viewBox={`0 0 ${node.width} ${node.height}`} aria-hidden="true">
                {selected && <path className="q-canvas__freehand-halo" d={canvasFreehandPath(freehandPoints)} stroke="var(--q-canvas-selection, var(--q-text-accent))" />}
                <path d={canvasFreehandPath(freehandPoints)} stroke="var(--q-canvas-node-color, var(--q-canvas-edge))" />
              </svg>}
              {(activeTool === 'select' || activeTool === 'edge') && !selectedEdgeId && !spaceHeld && node.type !== 'group' && !groupMemberIds.has(node.id) && (['top', 'right', 'bottom', 'left'] as const).map((side) => <button
                key={side}
                type="button"
                className="q-canvas__connect"
                data-side={side}
                style={{ transform: `translate(-50%, -50%) scale(${1 / camera.zoom})` }}
                aria-label={`${t('canvas.connectHandle')} ${t(`canvas.side.${side}`)}`}
                onPointerDown={(event) => beginConnect(event, node, side)}
              />)}
              {selected && selection.length === 1 && node.type !== 'group' && !groupMemberIds.has(node.id) && resizeHandles.map((handle) => <button
                key={handle}
                type="button"
                className="q-canvas__resize"
                data-handle={handle}
                style={{ transform: `translate(-50%, -50%) scale(${1 / camera.zoom})` }}
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
        <svg className="q-canvas__edge-overlay" width={viewport.width} height={viewport.height}>
          {snapPoint && (() => {
            const at = screenPoint(snapPoint);
            return <g className="q-canvas__snap" aria-hidden="true">
              <circle cx={at.x} cy={at.y} r="9" />
              <circle cx={at.x} cy={at.y} r="3" />
            </g>;
          })()}
          {selectedEdge && (() => {
            const geometry = getCanvasEdgeGeometry(selectedEdge, nodeIndex);
            if (!geometry) return null;
            const from = screenPoint(geometry.from);
            const to = screenPoint(geometry.to);
            const routing = edgeRouting(selectedEdge);
            const bend = { x: routing.bend.x * camera.zoom, y: routing.bend.y * camera.zoom };
            const handle = { x: (from.x + to.x) / 2 + bend.x, y: (from.y + to.y) / 2 + bend.y };
            const startDrag = (next: DragState) => {
              dragRef.current = next;
              setDrag(next);
            };
            return <g>
              {(['from', 'to'] as const).map((end) => <circle
                key={end}
                className="q-canvas__edge-endpoint"
                cx={end === 'from' ? from.x : to.x}
                cy={end === 'from' ? from.y : to.y}
                r="6"
                role="button"
                tabIndex={0}
                aria-label={`${t('canvas.edgeEndpoint')} ${end === 'from' ? '→' : '←'}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  const current = documentRef.current;
                  if (!current) return;
                  startDrag({
                    kind: 'edge-endpoint', startX: event.clientX, startY: event.clientY,
                    camera, document: current, edgeId: selectedEdge.id, end,
                  });
                  stageRef.current?.setPointerCapture(event.pointerId);
                }}
              />)}
              {routing.route !== 'straight' && <circle
                className="q-canvas__edge-handle"
                cx={handle.x}
                cy={handle.y}
                r="6"
                role="button"
                tabIndex={0}
                aria-label={t('canvas.edgeBend')}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  startDrag({
                    kind: 'edge-bend', startX: event.clientX, startY: event.clientY,
                    camera, edgeId: selectedEdge.id, route: routing.route, bend: routing.bend,
                  });
                  stageRef.current?.setPointerCapture(event.pointerId);
                }}
              />}
            </g>;
          })()}
        </svg>
        {drag?.kind === 'marquee' && <div className="q-canvas__marquee" style={{
          left: canvasPixels(Math.min(drag.startX - (stageRef.current?.getBoundingClientRect().left ?? 0), drag.currentX - (stageRef.current?.getBoundingClientRect().left ?? 0))),
          top: canvasPixels(Math.min(drag.startY - (stageRef.current?.getBoundingClientRect().top ?? 0), drag.currentY - (stageRef.current?.getBoundingClientRect().top ?? 0))),
          width: canvasPixels(Math.abs(drag.currentX - drag.startX)),
          height: canvasPixels(Math.abs(drag.currentY - drag.startY)),
        }} />}
        {selectionFrame && !drag && !editingId && (
          <div
            className="q-canvas__selection-frame"
            style={{
              left: canvasPixels(selectionFrame.x),
              top: canvasPixels(selectionFrame.y),
              width: canvasPixels(selectionFrame.width),
              height: canvasPixels(selectionFrame.height),
            }}
          >
            {resizeHandles.map((handle) => <button
              key={handle}
              type="button"
              className="q-canvas__resize"
              data-handle={handle}
              style={{ transform: `translate(-50%, -50%) scale(${1 / camera.zoom})` }}
              aria-label={`${t('canvas.toolbar.resize')} ${t(`canvas.resizeHandle.${handle}`)}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!frameRect) return;
                const current = documentRef.current;
                if (!current) return;
                const next: DragState = selectedGroup
                  ? { kind: 'resize', startX: event.clientX, startY: event.clientY, camera, document: current, nodeId: selectedGroup.id, handle }
                  : {
                    kind: 'resize-selection', startX: event.clientX, startY: event.clientY, camera,
                    document: current, bounds: frameRect, handle, selected: new Set(selection),
                  };
                dragRef.current = next;
                setDrag(next);
                stageRef.current?.setPointerCapture(event.pointerId);
              }}
            />)}
          </div>
        )}
        {menu && <div
          className="q-canvas__menu"
          style={{
            left: canvasPixels(Math.min(menu.x, Math.max(0, viewport.width - 200))),
            top: canvasPixels(Math.min(menu.y, Math.max(0, viewport.height - 280))),
          }}
          role="menu"
          aria-label={t('canvas.menu.label')}
        >
          {menuNodeId === null ? <>
            <button role="menuitem" onClick={() => {
              addNode('text', menuWorldPoint(menu));
              setMenu(null);
            }}>{t('canvas.menu.addText')}</button>
            <button role="menuitem" onClick={() => {
              addNode('sticker', menuWorldPoint(menu));
              setMenu(null);
            }}>{t('canvas.slash.sticker')}</button>
            <button role="menuitem" disabled={selection.length === 0} onClick={() => {
              copySelection();
              setMenu(null);
            }}>{t('canvas.menu.copy')}</button>
            <button role="menuitem" disabled={selection.length === 0} onClick={() => {
              copySelectionAsImage();
              setMenu(null);
            }}>{t('canvas.menu.copyImage')}</button>
            <button role="menuitem" disabled={clipboardRef.current.nodes.length === 0} onClick={() => {
              pasteClipboard(menuWorldPoint(menu));
              setMenu(null);
            }}>{t('canvas.menu.paste')}</button>
            <button role="menuitem" onClick={() => {
              setLinkDraft({ mode: 'add', point: menuWorldPoint(menu), value: '' });
              setMenu(null);
            }}>{t('canvas.menu.addLink')}</button>
            <button role="menuitem" onClick={() => {
              notePlacementRef.current = menuWorldPoint(menu);
              setNotePickerOpen(true);
              setMenu(null);
            }}>{t('canvas.slash.findNote')}</button>
            <button role="menuitem" onClick={() => {
              setSelection(document.nodes.map((node) => node.id));
              setMenu(null);
            }}>{t('canvas.menu.selectAll')}</button>
            <button role="menuitem" onClick={() => { fitView(); setMenu(null); }}>{t('canvas.toolbar.fitView')}</button>
            <button role="menuitem" onClick={() => { setCameraValue({ x: 0, y: 0, zoom: 1 }); setMenu(null); }}>{t('canvas.toolbar.resetView')}</button>
            <button role="menuitem" onClick={() => { exportSvg(); setMenu(null); }}>{t('canvas.toolbar.exportSvg')}</button>
            <button role="menuitem" onClick={() => { exportPng(); setMenu(null); }}>{t('canvas.toolbar.exportPng')}</button>
            <button role="menuitem" onClick={() => { exportJson(); setMenu(null); }}>{t('canvas.menu.exportJson')}</button>
          </> : <>
            <button role="menuitem" onClick={() => {
              const node = document.nodes.find((item) => item.id === menuNodeId);
              if (node?.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
              else if (node?.type === 'link') openUrl(node.url);
              setMenu(null);
            }}>{t('canvas.menu.open')}</button>
            <button role="menuitem" onClick={() => {
              const node = document.nodes.find((item) => item.id === menuNodeId);
              if (node?.type === 'file') onOpenFile(absolutePath(workspacePath, node.file));
              else if (node?.type === 'link') setLinkDraft({ mode: 'edit', nodeId: node.id, value: node.url });
              else beginTextEditing(menuNodeId);
              setMenu(null);
            }}>{t('canvas.menu.edit')}</button>
            <button role="menuitem" onClick={() => duplicateNode(menuNodeId)}>{t('canvas.menu.duplicate')}</button>
            <button role="menuitem" onClick={() => reorderSelection('front')}>{t('canvas.menu.front')}</button>
            <button role="menuitem" onClick={() => reorderSelection('back')}>{t('canvas.menu.back')}</button>
            <button role="menuitem" onClick={() => deleteNode(menuNodeId)}>{t('canvas.menu.delete')}</button>
            <button role="menuitem" onClick={() => { addGroup(); setMenu(null); }}>{t('canvas.menu.group')}</button>
            {selection.length > 1 && <>
              <button role="menuitem" onClick={() => alignSelection('left')}>{t('canvas.align.left')}</button>
              <button role="menuitem" onClick={() => alignSelection('center-x')}>{t('canvas.align.centerX')}</button>
              <button role="menuitem" onClick={() => alignSelection('right')}>{t('canvas.align.right')}</button>
              <button role="menuitem" onClick={() => alignSelection('top')}>{t('canvas.align.top')}</button>
              <button role="menuitem" onClick={() => alignSelection('center-y')}>{t('canvas.align.centerY')}</button>
              <button role="menuitem" onClick={() => alignSelection('bottom')}>{t('canvas.align.bottom')}</button>
            </>}
            {document.nodes.find((item) => item.id === menuNodeId)?.type === 'group' && <button role="menuitem" onClick={() => { ungroupSelection(); setMenu(null); }}>{t('canvas.menu.ungroup')}</button>}
          </>}
        </div>}
        {slashMenu && <div
          className="q-canvas__slash"
          style={{
            left: canvasPixels(Math.min(screenPoint(slashMenu.point).x, Math.max(0, viewport.width - 300))),
            top: canvasPixels(Math.min(screenPoint(slashMenu.point).y, Math.max(0, viewport.height - 240))),
          }}
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
        <span className="q-canvas__selection-count" aria-live="polite">{selection.length ? t('canvas.selectionCount', { count: selection.length }) : ''}</span>
      </div>
      {panelTarget && !drag && !editingId && (
        <CanvasPropertiesPanel
          target={panelTarget}
          onAppearance={applySelectionAppearance}
          onStroke={onSelectionStroke}
          onFill={onSelectionFill}
          onFront={() => reorderSelection('front')}
          onBack={() => reorderSelection('back')}
          onDuplicate={duplicateSelection}
          onCopy={copySelection}
          onPaste={() => pasteClipboard()}
          onGroup={addGroup}
          onUngroup={ungroupSelection}
          onDelete={deleteSelection}
          onRoute={(route) => {
            if (selectedEdge) updateEdge(selectedEdge.id, edgeRoutingPatch(selectedEdge, route, edgeRouting(selectedEdge).bend));
          }}
          onFromEnd={(end) => { if (selectedEdge) updateEdge(selectedEdge.id, { fromEnd: end }); }}
          onToEnd={(end) => { if (selectedEdge) updateEdge(selectedEdge.id, { toEnd: end }); }}
          onLabel={(label) => { if (selectedEdge) updateEdge(selectedEdge.id, { label }); }}
          onClose={() => {
            if (panelTarget.kind === 'nodes') setSelection([]);
            else setSelectedEdgeId(null);
          }}
        />
      )}
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
        }}
      />
      <CanvasNotePicker
        open={notePickerOpen}
        workspacePath={workspacePath}
        onClose={() => { notePlacementRef.current = null; setNotePickerOpen(false); }}
        onSelect={addSearchedNote}
        onCreate={(title) => { void createCanvasNote(title, null); }}
      />
    </section>
  );
}
