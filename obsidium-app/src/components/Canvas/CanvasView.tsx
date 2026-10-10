import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import {
  ArrowRight, Circle, FileText, Hand, Highlighter, Link2, MousePointer2, Pencil,
  Plus, RectangleHorizontal, StickyNote, Trash2,
} from 'lucide';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { absolutePath } from '../../modules/paths';
import {
  addDrawing,
  addEdge,
  addNode,
  parseCanvas,
  removeDrawing,
  removeNode,
  serializeCanvas,
  updateNode,
  type CanvasDocument,
  type CanvasDrawing,
  type CanvasNode,
} from '../../modules/canvas/model';
import './CanvasView.css';

type Tool = 'select' | 'hand' | 'text' | 'file' | 'connect' | 'rectangle' | 'ellipse' | 'arrow' | 'pen' | 'highlighter';
type Selection = { kind: 'node' | 'drawing'; id: string } | null;

interface CanvasViewProps {
  path: string;
  workspacePath: string;
  onOpenFile: (path: string) => void;
}

interface LoadedCanvas {
  document: CanvasDocument;
  hash: string;
}

const SAVE_DELAY_MS = 220;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function centerOf(node: CanvasNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function relativeFileLabel(node: CanvasNode): string {
  if (node.type === 'file' && typeof node.file === 'string') return node.file;
  if (node.type === 'link' && typeof node.url === 'string') return node.url;
  if (node.type === 'group' && typeof node.label === 'string') return node.label;
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  return node.type;
}

function nodeFill(node: CanvasNode): string {
  if (node.color === '1') return token('--q-bg-danger-subtle', '#fee');
  if (node.color === '2') return token('--q-bg-warning-subtle', '#ffe8b0');
  if (node.color === '4') return token('--q-bg-success-subtle', '#def8e8');
  if (node.color === '5') return token('--q-bg-info-subtle', '#def6fa');
  if (node.color === '6') return token('--q-bg-accent-subtle', '#e1edff');
  return token('--q-bg-surface-raised', '#f5f5f5');
}

function canvasPoint(stage: Konva.Stage): { x: number; y: number } | null {
  const pointer = stage.getPointerPosition();
  if (!pointer) return null;
  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(pointer);
}

function makeTextNode(x: number, y: number, text = 'Text'): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x, y,
    width: 280,
    height: 160,
    text,
  };
}

function makeFileNode(x: number, y: number, file: string): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: 'file',
    x, y,
    width: 320,
    height: 150,
    file,
  };
}

export function CanvasView({ path, workspacePath, onOpenFile }: CanvasViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const loadedRef = useRef<LoadedCanvas | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const drawingRef = useRef<Konva.Line | null>(null);
  const drawingPointsRef = useRef<number[]>([]);
  const [loaded, setLoaded] = useState<LoadedCanvas | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [noteInput, setNoteInput] = useState(false);
  const [notePath, setNotePath] = useState('');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSelection(null);
    void readFileSnapshot(path)
      .then((snapshot) => {
        if (cancelled) return;
        const next = { document: parseCanvas(snapshot.content), hash: snapshot.hash };
        loadedRef.current = next;
        setLoaded(next);
      })
      .catch((error) => {
        console.error('Failed to load canvas', error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [path]);

  const persist = useCallback((document: CanvasDocument) => {
    const current = loadedRef.current;
    if (!current) return;
    loadedRef.current = { ...current, document };
    setLoaded({ ...current, document });
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const content = serializeCanvas(document);
      setSaving(true);
      writeQueueRef.current = writeQueueRef.current
        .then(async () => {
          const expectedHash = loadedRef.current?.hash ?? null;
          const result = await writeFileAtomic(path, content, expectedHash);
          if (loadedRef.current) loadedRef.current.hash = result.hash;
        })
        .catch((error) => {
          console.error('Failed to save canvas', error);
          setFailed(true);
        })
        .finally(() => setSaving(false));
    }, SAVE_DELAY_MS);
  }, [path]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const snapshot = loadedRef.current;
    if (snapshot) {
      const content = serializeCanvas(snapshot.document);
      writeQueueRef.current = writeQueueRef.current.then(async () => {
        const expectedHash = loadedRef.current?.hash ?? snapshot.hash;
        await writeFileAtomic(path, content, expectedHash);
      }).catch(() => undefined);
    }
  }, [path]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || stageRef.current) return;
    const stage = new Konva.Stage({ container: host, width: host.clientWidth, height: host.clientHeight });
    stageRef.current = stage;
    const observer = new ResizeObserver(() => {
      stage.size({ width: host.clientWidth, height: host.clientHeight });
      stage.batchDraw();
    });
    observer.observe(host);
    stage.on('wheel', (event) => {
      event.evt.preventDefault();
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const anchor = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };
      const factor = event.evt.deltaY > 0 ? 0.9 : 1.1;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldScale * factor));
      stage.scale({ x: scale, y: scale });
      stage.position({ x: pointer.x - anchor.x * scale, y: pointer.y - anchor.y * scale });
      stage.batchDraw();
    });
    return () => {
      observer.disconnect();
      stage.destroy();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.draggable(tool === 'hand');
    stage.container().style.cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  }, [tool]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !loaded) return;
    renderScene(stage, loaded.document, selection, {
      workspacePath,
      onOpenFile,
      onSelect: (next) => {
        if (tool === 'connect' && next?.kind === 'node') {
          if (!connectFrom) {
            setConnectFrom(next.id);
            setSelection(next);
            return;
          }
          if (connectFrom !== next.id) {
            persist(addEdge(loaded.document, {
              id: crypto.randomUUID(),
              fromNode: connectFrom,
              toNode: next.id,
              toEnd: 'arrow',
            }));
          }
          setConnectFrom(null);
          setSelection(next);
          setTool('select');
          return;
        }
        if (!next) setConnectFrom(null);
        setSelection(next);
      },
      onMoveNode: (id, x, y) => persist(updateNode(loaded.document, id, { x, y })),
    });
  }, [connectFrom, loaded, onOpenFile, persist, selection, tool, workspacePath]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !loaded) return;
    const onPointerDown = () => {
      if (!['pen', 'highlighter'].includes(tool) || stage.getIntersection(stage.getPointerPosition() ?? { x: -1, y: -1 })) return;
      const point = canvasPoint(stage);
      if (!point) return;
      drawingPointsRef.current = [point.x, point.y];
      const line = new Konva.Line({
        points: drawingPointsRef.current,
        stroke: tool === 'highlighter'
          ? token('--q-bg-warning', '#f2b600')
          : token('--q-text-primary', '#111'),
        strokeWidth: tool === 'highlighter' ? 18 : 3,
        opacity: tool === 'highlighter' ? 0.28 : 1,
        lineCap: 'round',
        lineJoin: 'round',
        listening: false,
      });
      stage.getLayers()[0]?.add(line);
      drawingRef.current = line;
    };
    const onPointerMove = () => {
      if (!drawingRef.current) return;
      const point = canvasPoint(stage);
      if (!point) return;
      drawingPointsRef.current.push(point.x, point.y);
      drawingRef.current.points(drawingPointsRef.current);
      drawingRef.current.getLayer()?.batchDraw();
    };
    const onPointerUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current.destroy();
      drawingRef.current = null;
      const points = drawingPointsRef.current;
      drawingPointsRef.current = [];
      if (points.length < 4) return;
      const drawing: CanvasDrawing = {
        id: crypto.randomUUID(),
        kind: tool === 'highlighter' ? 'highlighter' : 'freehand',
        points,
        strokeWidth: tool === 'highlighter' ? 18 : 3,
        opacity: tool === 'highlighter' ? 0.28 : 1,
      };
      persist(addDrawing(loaded.document, drawing));
    };
    stage.on('pointerdown.canvas-draw', onPointerDown);
    stage.on('pointermove.canvas-draw', onPointerMove);
    stage.on('pointerup.canvas-draw pointerleave.canvas-draw', onPointerUp);
    return () => stage.off('.canvas-draw');
  }, [loaded, persist, tool]);

  const addAtCenter = useCallback((kind: 'text' | 'rectangle' | 'ellipse' | 'arrow') => {
    if (!loaded || !stageRef.current) return;
    const stage = stageRef.current;
    const center = {
      x: (stage.width() / 2 - stage.x()) / stage.scaleX(),
      y: (stage.height() / 2 - stage.y()) / stage.scaleY(),
    };
    if (kind === 'text') {
      const node = makeTextNode(center.x - 140, center.y - 80);
      persist(addNode(loaded.document, node));
      setSelection({ kind: 'node', id: node.id });
      return;
    }
    const drawing: CanvasDrawing = kind === 'arrow' ? {
      id: crypto.randomUUID(),
      kind,
      points: [center.x - 90, center.y, center.x + 90, center.y],
      strokeWidth: 2,
    } : {
      id: crypto.randomUUID(),
      kind,
      x: center.x - 90,
      y: center.y - 60,
      width: 180,
      height: 120,
      strokeWidth: 2,
    };
    persist(addDrawing(loaded.document, drawing));
    setSelection({ kind: 'drawing', id: drawing.id });
  }, [loaded, persist]);

  const addNote = useCallback(() => {
    if (!loaded || !stageRef.current) return;
    const relative = notePath.trim().replace(/^[/\\]+/, '');
    if (!relative) return;
    const stage = stageRef.current;
    const center = {
      x: (stage.width() / 2 - stage.x()) / stage.scaleX(),
      y: (stage.height() / 2 - stage.y()) / stage.scaleY(),
    };
    const node: CanvasNode = /^https?:\/\//i.test(relative) ? {
      id: crypto.randomUUID(), type: 'link', x: center.x - 160, y: center.y - 75,
      width: 320, height: 150, url: relative,
    } : makeFileNode(center.x - 160, center.y - 75, relative);
    persist(addNode(loaded.document, node));
    setSelection({ kind: 'node', id: node.id });
    setNoteInput(false);
    setNotePath('');
  }, [loaded, notePath, persist]);

  const removeSelected = useCallback(() => {
    if (!loaded || !selection) return;
    const next = selection.kind === 'node'
      ? removeNode(loaded.document, selection.id)
      : removeDrawing(loaded.document, selection.id);
    persist(next);
    setSelection(null);
  }, [loaded, persist, selection]);

  const tools = useMemo(() => [
    ['select', MousePointer2, t('canvas.select')],
    ['hand', Hand, t('canvas.pan')],
    ['text', StickyNote, t('canvas.text')],
    ['file', FileText, t('canvas.file')],
    ['connect', Link2, t('canvas.connect')],
    ['rectangle', RectangleHorizontal, t('canvas.rectangle')],
    ['ellipse', Circle, t('canvas.ellipse')],
    ['arrow', ArrowRight, t('canvas.arrow')],
    ['pen', Pencil, t('canvas.draw')],
    ['highlighter', Highlighter, t('canvas.highlight')],
  ] as const, []);

  if (failed && !loaded) return <div className="q-canvas-state">{t('canvas.openError')}</div>;

  return (
    <section className="q-canvas-view">
      <div className="q-canvas-toolbar" role="toolbar" aria-label={t('canvas.toolbar')}>
        {tools.map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            className={tool === id ? 'active' : ''}
            aria-pressed={tool === id}
            title={label}
            onClick={() => {
              if (id === 'text') addAtCenter('text');
              else if (id === 'file') setNoteInput((current) => !current);
              else if (id === 'rectangle') addAtCenter('rectangle');
              else if (id === 'ellipse') addAtCenter('ellipse');
              else if (id === 'arrow') addAtCenter('arrow');
              else { setConnectFrom(null); setTool(id); }
            }}
          >
            <Icon icon={icon} />
          </button>
        ))}
        <span className="q-canvas-toolbar__divider" />
        <button type="button" title={t('canvas.delete')} disabled={!selection} onClick={removeSelected}>
          <Icon icon={Trash2} />
        </button>
        <span className="q-canvas-toolbar__status">{saving ? t('canvas.saving') : failed ? t('canvas.saveFailed') : ''}</span>
      </div>
      {noteInput && (
        <form className="q-canvas-note-picker" onSubmit={(event) => { event.preventDefault(); addNote(); }}>
          <Icon icon={Plus} />
          <input
            autoFocus
            value={notePath}
            onInput={(event) => setNotePath(event.currentTarget.value)}
            placeholder={t('canvas.filePlaceholder')}
            aria-label={t('canvas.filePath')}
          />
          <button type="submit">{t('canvas.add')}</button>
        </form>
      )}
      <div ref={hostRef} className="q-canvas-stage" />
    </section>
  );
}

function renderScene(
  stage: Konva.Stage,
  document: CanvasDocument,
  selection: Selection,
  actions: {
    workspacePath: string;
    onOpenFile: (path: string) => void;
    onSelect: (selection: Selection) => void;
    onMoveNode: (id: string, x: number, y: number) => void;
  },
) {
  stage.destroyChildren();
  const layer = new Konva.Layer({ listening: true });
  stage.add(layer);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  for (const edge of document.edges) {
    const from = nodes.get(edge.fromNode);
    const to = nodes.get(edge.toNode);
    if (!from || !to) continue;
    const a = centerOf(from);
    const b = centerOf(to);
    layer.add(new Konva.Arrow({
      points: [a.x, a.y, b.x, b.y],
      stroke: token('--q-text-tertiary', '#777'),
      fill: token('--q-text-tertiary', '#777'),
      strokeWidth: 1.5,
      pointerLength: edge.toEnd === 'none' ? 0 : 8,
      pointerWidth: edge.toEnd === 'none' ? 0 : 8,
      listening: false,
    }));
  }

  for (const drawing of document.obsidium.drawings ?? []) {
    const selected = selection?.kind === 'drawing' && selection.id === drawing.id;
    const stroke = selected ? token('--q-text-accent', '#1471eb') : token('--q-text-secondary', '#333');
    let shape: Konva.Shape | null = null;
    if (drawing.kind === 'rectangle') {
      shape = new Konva.Rect({ x: drawing.x, y: drawing.y, width: drawing.width, height: drawing.height, stroke, strokeWidth: drawing.strokeWidth ?? 2, cornerRadius: 8 });
    } else if (drawing.kind === 'ellipse') {
      shape = new Konva.Ellipse({ x: (drawing.x ?? 0) + (drawing.width ?? 1) / 2, y: (drawing.y ?? 0) + (drawing.height ?? 1) / 2, radiusX: (drawing.width ?? 1) / 2, radiusY: (drawing.height ?? 1) / 2, stroke, strokeWidth: drawing.strokeWidth ?? 2 });
    } else if (drawing.kind === 'arrow') {
      shape = new Konva.Arrow({ points: drawing.points ?? [], stroke, fill: stroke, strokeWidth: drawing.strokeWidth ?? 2, pointerLength: 10, pointerWidth: 10 });
    } else {
      shape = new Konva.Line({
        points: drawing.points ?? [],
        stroke: drawing.kind === 'highlighter' ? token('--q-bg-warning', '#f2b600') : stroke,
        strokeWidth: drawing.strokeWidth ?? (drawing.kind === 'highlighter' ? 18 : 3),
        opacity: drawing.opacity ?? (drawing.kind === 'highlighter' ? 0.28 : 1),
        lineCap: 'round',
        lineJoin: 'round',
      });
    }
    shape.on('pointerdown', (event) => {
      event.cancelBubble = true;
      actions.onSelect({ kind: 'drawing', id: drawing.id });
    });
    layer.add(shape);
  }

  for (const node of document.nodes) {
    const selected = selection?.kind === 'node' && selection.id === node.id;
    const group = new Konva.Group({ x: node.x, y: node.y, draggable: true, name: `canvas-node-${node.id}` });
    const groupNode = node.type === 'group';
    const rect = new Konva.Rect({
      width: node.width,
      height: node.height,
      fill: groupNode ? token('--q-bg-surface-subtle', 'rgba(0,0,0,.03)') : nodeFill(node),
      stroke: selected ? token('--q-border-accent', '#1471eb') : token('--q-border-solid', '#ddd'),
      strokeWidth: selected ? 2 : 1,
      cornerRadius: groupNode ? 12 : 10,
      dash: groupNode ? [8, 5] : undefined,
      shadowColor: groupNode ? undefined : token('--q-bg-overlay', 'rgba(0,0,0,.18)'),
      shadowBlur: groupNode ? 0 : 10,
      shadowOpacity: groupNode ? 0 : 0.12,
      shadowOffsetY: groupNode ? 0 : 3,
    });
    group.add(rect);
    group.add(new Konva.Text({
      x: 14,
      y: 12,
      width: Math.max(20, node.width - 28),
      height: Math.max(20, node.height - 24),
      text: relativeFileLabel(node),
      fontSize: node.type === 'group' ? 13 : 15,
      fontStyle: node.type === 'file' ? 'bold' : 'normal',
      lineHeight: 1.35,
      fill: token('--q-text-primary', '#111'),
      ellipsis: true,
      wrap: 'word',
      listening: false,
    }));
    group.on('pointerdown', (event) => {
      event.cancelBubble = true;
      actions.onSelect({ kind: 'node', id: node.id });
    });
    group.on('dragend', () => actions.onMoveNode(node.id, group.x(), group.y()));
    group.on('dblclick dbltap', () => {
      if (node.type === 'file' && typeof node.file === 'string') {
        actions.onOpenFile(absolutePath(actions.workspacePath, node.file));
      } else if (node.type === 'link' && typeof node.url === 'string') {
        window.open(node.url, '_blank', 'noopener,noreferrer');
      }
    });
    layer.add(group);
  }
  stage.off('.canvas-select');
  stage.on('pointerdown.canvas-select', (event) => {
    if (event.target === stage) actions.onSelect(null);
  });
  layer.draw();
}
