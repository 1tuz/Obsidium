// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { importIntoFiles } from '../../modules/docs/vaultFiles';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('../../modules/export/markdownToHtml', () => ({
  renderMarkdownToHtml: (markdown: string, options?: { noteLinks?: boolean; resolveImageUrl?: (target: string) => string }) => {
    const images = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, target: string) => (
      `<img alt="${alt}" src="${options?.resolveImageUrl?.(target) ?? target}" />`
    ));
    if (!options?.noteLinks) return `<p>${images}</p>`;
    return images
      .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|[^\]]+)?\]\]/g, (_match, target: string, fragment?: string) => (
        `<a class="q-print-wikilink" href="#" data-note-target="${target}${fragment ? `#${fragment}` : ''}" data-note-source="wiki" tabindex="0">${target}</a>`
      ))
      .replace(/\[([^\]]+)\]\(([^)#]+)(?:#([^)]+))?\)/g, (match: string, label: string, target: string) => (
        /^[a-z][a-z\d+.-]*:/i.test(target)
          ? `<a class="q-print-link" href="${target}" tabindex="0">${label}</a>`
          : `<a class="q-print-link" href="${target}" data-note-target="${target}${match.includes('#') ? `#${match.split('#').slice(1).join('#').replace(/\)$/, '')}` : ''}" data-note-source="markdown" tabindex="0">${label}</a>`
      ));
  },
}));
vi.mock('../../modules/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
const canvasSource = vi.hoisted(() => ({ content: '{"nodes":[],"edges":[]}' }));
vi.mock('../../modules/documents/fileGateway', () => ({
  isCanvasPath: () => true,
  isFileCommandError: () => false,
  isMarkdownPath: () => false,
  readFileSnapshot: vi.fn(async () => ({
    content: canvasSource.content,
    hash: 'original-hash',
    textHash: 'original-text-hash',
  })),
  writeFileAtomic: vi.fn(async () => ({ hash: 'saved-hash' })),
}));
vi.mock('../../modules/documents/documentFactory', () => ({ createUniqueFile: vi.fn(async () => '/vault/New note.md') }));
vi.mock('../../modules/search', () => ({
  useKnowledgeSearch: () => ({
    failed: false,
    queryTerms: [],
    results: [],
    status: { state: 'ready', updating: false, generation: 1, revision: 1, indexedDocuments: 0, scannedDocuments: 0 },
  }),
}));
vi.mock('../../modules/canvas/recentNotes', () => ({
  CANVAS_RECENT_NOTES_LIMIT: 20,
  loadRecentCanvasNotes: vi.fn(async () => []),
}));
vi.mock('../Common/CodeMirrorField', () => ({
  CodeMirrorField: ({
    value,
    onChange,
    onKeyDown,
    ariaLabel,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    ariaLabel: string;
    placeholder: string;
  }) => (
    <input
      className="q-canvas-search-input"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));
vi.mock('../../modules/docs/vaultFiles', () => ({ importIntoFiles: vi.fn(async () => 'Files/image.png') }));

function settleAutosave(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, 450); });
}

const { CanvasView } = await import('./CanvasView');
const { writeFileAtomic } = await import('../../modules/documents/fileGateway');
const { createUniqueFile } = await import('../../modules/documents/documentFactory');

describe('CanvasView', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    canvasSource.content = '{"nodes":[],"edges":[]}';
    vi.clearAllMocks();
  });

  it('does not rewrite an unchanged Obsidian canvas when opened and closed', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));
    act(() => renderer?.unmount());
    renderer = null;

    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('draws a freehand shape with the P shortcut and saves it in the Canvas extension', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true })); });
    expect(canvas.dataset.activeTool).toBe('draw');
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 42, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 42, bubbles: true })); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = writes[writes.length - 1]?.[1];
    expect(JSON.parse(String(saved)).nodes[0]).toMatchObject({
      type: 'text',
      text: '',
      obsidium: { shape: 'freehand', points: [{ x: 8, y: 8 }, { x: 68, y: 20 }] },
    });
  });

  it('draws a rectangle by dragging in either direction', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 120, clientY: 90, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 10, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 20, clientY: 10, bubbles: true })); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = writes[writes.length - 1]?.[1];
    expect(JSON.parse(String(saved)).nodes[0]).toMatchObject({
      x: 20, y: 10, width: 100, height: 80, obsidium: { shape: 'rectangle' },
    });
  });

  it('keeps created shapes visible when selecting a different object', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'shape', type: 'text', x: 0, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'ellipse' } },
        { id: 'note', type: 'text', x: 180, y: 0, width: 160, height: 100, text: 'Note' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });

    expect(renderer!.container.querySelectorAll('.q-canvas__object')).toHaveLength(2);
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(1);
  });

  it('connects two clicked objects with the edge tool', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 120, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { objects[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges).toHaveLength(1);
    expect(saved.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b', toEnd: 'arrow' });
    expect(renderer!.container.querySelector('path[aria-label="a → b"]')).not.toBeNull();
  });

  it('creates sequential numbered markers from the number tool', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'number-4', type: 'text', x: 0, y: 0, width: 48, height: 48, text: '4', obsidium: { shape: 'number' } }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 80, clientY: 90, button: 0, bubbles: true })); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[1]).toMatchObject({ text: '5', width: 48, height: 48, obsidium: { shape: 'number' } });
  });

  it('saves the selected connection route without changing its endpoints', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 160, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', toEnd: 'arrow' }],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const edge = renderer!.container.querySelector<SVGPathElement>('path[aria-label="a → b"]')!;
    await actAndSettle(() => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const route = renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="canvas.route.curved"]')!;
    await actAndSettle(() => { route.click(); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges[0]).toMatchObject({ id: 'edge', fromNode: 'a', toNode: 'b', obsidium: { route: 'curved' } });
  });

  it('starts a text card as one line so the caret is visible instead of an empty box', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 50, button: 0, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'text', text: '', width: 280, height: 40 });
    expect(renderer!.container.querySelector('.q-canvas-card--text textarea')).not.toBeNull();
  });

  it('opens a note when its card is clicked and stays put when the card is dragged', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 200, height: 120, file: 'Notes/Plan.md' }],
      edges: [],
    });
    const onOpenFile = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={onOpenFile} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 70, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 90, clientY: 70, bubbles: true })); });
    expect(onOpenFile).not.toHaveBeenCalled();

    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 90, clientY: 70, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 90, clientY: 70, bubbles: true })); });
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Notes/Plan.md');
  });

  it('places a vault note on the board when it is dropped from the file tree', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [],
        getData: (kind: string) => kind === 'application/x-obsidium-file-path' ? '/vault/Notes/Plan.md' : '',
      },
    });
    await actAndSettle(() => { stage.dispatchEvent(drop); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'file', file: 'Notes/Plan.md' });
  });

  it('creates a connection by dragging from one card to another with the arrow tool', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 160, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true })); });
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[0].dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 30, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 30, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b', fromEnd: 'none', toEnd: 'arrow' });
  });

  it('shows board actions when the empty canvas is right-clicked', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('contextmenu', { clientX: 300, clientY: 200, bubbles: true, cancelable: true })); });

    const menu = renderer!.container.querySelector<HTMLElement>('.q-canvas__menu')!;
    expect(menu.getAttribute('aria-label')).toBe('canvas.menu.label');
    const items = [...menu.querySelectorAll('button')].map((item) => item.textContent);
    expect(items).toEqual([
      'canvas.menu.addText', 'canvas.slash.findNote', 'canvas.menu.selectAll',
      'canvas.toolbar.fitView', 'canvas.toolbar.resetView',
      'canvas.toolbar.exportSvg', 'canvas.toolbar.exportPng', 'canvas.menu.exportJson',
    ]);

    await actAndSettle(() => { [...menu.querySelectorAll<HTMLButtonElement>('button')][2].click(); });
    expect(renderer!.container.querySelector('.q-canvas__selection-count')?.textContent).toBe('canvas.selectionCount');
  });

  it('keeps a selected connection when the user selects a card and deletes it', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 160, y: 0, width: 100, height: 80, text: 'B' },
        { id: 'c', type: 'text', x: 320, y: 0, width: 100, height: 80, text: 'C' },
      ],
      edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', toEnd: 'arrow' }],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const edge = renderer!.container.querySelector<SVGPathElement>('path[aria-label="a → b"]')!;
    await actAndSettle(() => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[2].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges).toHaveLength(1);
    expect(saved.nodes.map((node: { id: string }) => node.id)).toEqual(['a', 'b']);
  });

  it('keeps autosaving after an unrelated action reports an error', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: (kind: string) => kind === 'text/plain' ? '/elsewhere/note.md' : '' },
    });
    await actAndSettle(() => { stage.dispatchEvent(drop); });
    expect(renderer!.container.querySelector('.q-canvas__warning')).not.toBeNull();

    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 30, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 30, bubbles: true })); });
    await act(settleAutosave);

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalled();
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0].x).toBe(40);
  });

  it('does not burn an undo step when panning the board', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 1, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 40, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 40, bubbles: true })); });
    const panned = renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform;
    expect(panned).not.toBe('');
    expect(renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.toolbar.undo"]')!.disabled).toBe(true);
  });

  it('does not save to a board whose content failed to load', async () => {
    canvasSource.content = '{not json';
    vi.mocked(writeFileAtomic).mockClear();
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Broken.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();
    expect(renderer!.container.querySelector('[role="alert"]')).not.toBeNull();
    await act(settleAutosave);

    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('undoes a content edit without resetting the panned view', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 1, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 70, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 90, clientY: 70, bubbles: true })); });
    const panned = renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
    await act(settleAutosave);

    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform).toBe(panned);
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!.style.left).toBe('0px');
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.obsidium.canvas.camera).toEqual({ x: 80, y: 60, zoom: 1 });
  });

  it('opens wiki and relative note links from cards and keeps unsafe targets inert', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'text', type: 'text', x: 0, y: 0, width: 320, height: 200, text: 'See [[Topics/Plan#Part two|plan]] and [local](Notes/Other.md#Section) and [web](https://example.test)' },
        { id: 'file', type: 'file', x: 360, y: 0, width: 320, height: 200, file: 'Notes/Source.md' },
      ],
      edges: [],
    });
    const onOpenNoteLink = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Boards/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
          onOpenNoteLink={onOpenNoteLink}
        />,
      );
    });
    await actAndSettle();

    const anchors = [...renderer!.container.querySelectorAll<HTMLAnchorElement>('.q-canvas-card__markdown a')];
    const wiki = anchors.find((anchor) => anchor.dataset.noteTarget === 'Topics/Plan#Part two')!;
    expect(wiki.getAttribute('href')).toBe('#');
    expect(wiki.dataset.noteSource).toBe('wiki');
    await actAndSettle(() => { wiki.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenNoteLink).toHaveBeenNthCalledWith(1, {
      target: 'Topics/Plan',
      fragment: 'Part two',
      source: 'wiki',
      path: null,
    }, null);

    const relative = anchors.find((anchor) => anchor.dataset.noteSource === 'markdown')!;
    await actAndSettle(() => { relative.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenNoteLink).toHaveBeenNthCalledWith(2, {
      target: 'Notes/Other.md',
      fragment: 'Section',
      source: 'markdown',
      path: { relative: 'Boards/Notes/Other.md', absolute: '/vault/Boards/Notes/Other.md' },
    }, null);

    await actAndSettle(() => { wiki.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onOpenNoteLink).toHaveBeenNthCalledWith(3, {
      target: 'Topics/Plan',
      fragment: 'Part two',
      source: 'wiki',
      path: null,
    }, null);

    const external = anchors.find((anchor) => anchor.getAttribute('href') === 'https://example.test')!;
    expect(external.dataset.noteTarget).toBeUndefined();

    expect(anchors.some((anchor) => anchor.href.startsWith('javascript:'))).toBe(false);
  });

  it('never falls back to the wiki resolver for a rejected markdown link', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'text', type: 'text', x: 0, y: 0, width: 320, height: 200, text: '[escape](../../../Outside.md)' }],
      edges: [],
    });
    const onOpenNoteLink = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} onOpenNoteLink={onOpenNoteLink} />,
      );
    });
    await actAndSettle();

    const link = renderer!.container.querySelector<HTMLAnchorElement>('a[data-note-source="markdown"]')!;
    await actAndSettle(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenNoteLink).not.toHaveBeenCalled();
    expect(renderer!.container.querySelector('.q-canvas__warning')?.textContent)
      .toBe('canvas.errors.noteLinkOutsideWorkspace');
  });

  it('opens the slash menu and creates a linked note', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelector('[role="dialog"][aria-label="canvas.slash.label"]')).not.toBeNull();
    await actAndSettle(() => renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.slash.newNote"]')!.click());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = writes[writes.length - 1]?.[1];
    expect(JSON.parse(String(saved)).nodes[0]).toMatchObject({ type: 'file', file: 'New note.md' });
  });

  it('applies a canvas palette color to selected cards', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'note-1', type: 'text', x: 0, y: 0, width: 160, height: 100, text: 'Note' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView
          path="/vault/Board.canvas"
          workspacePath="/vault"
          inactive={false}
          indexRevision={0}
          onOpenFile={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    expect(renderer!.container.querySelectorAll('.q-canvas__resize')).toHaveLength(8);
    const swatch = renderer!.container.querySelector<HTMLButtonElement>('.q-canvas-properties__section--stroke button[aria-label="canvas.toolbar.color.4"]')!;
    await actAndSettle(() => swatch.click());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = writes[writes.length - 1]?.[1];
    expect(JSON.parse(String(saved)).nodes[0].color).toBe('4');
  });

  it('pans with a plain wheel and keeps the camera after the debounce', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    const world = renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!;
    await actAndSettle(() => { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); });
    expect(world.style.transform).toBe('translate(0px, -100px) scale(1)');
    await act(settleAutosave);
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.obsidium.canvas.camera).toMatchObject({ x: 0, y: -100, zoom: 1 });
  });

  it('zooms around the pointer with the command modifier and resets with Cmd+0', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, metaKey: true, clientX: 0, clientY: 0, bubbles: true, cancelable: true }));
    });
    const zoomed = renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform;
    expect(zoomed).not.toBe('translate(0px, 0px) scale(1)');

    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('pans instead of moving a card while space is held', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'note', type: 'text', x: 10, y: 20, width: 160, height: 100, text: 'Note' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 50, bubbles: true })); });

    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform)
      .toBe('translate(30px, 40px) scale(1)');
    expect(object.style.left).toBe('10px');
    expect(object.style.top).toBe('20px');
  });

  it('adds a link card through the dialog instead of a prompt', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 40, button: 0, bubbles: true })); });
    const field = renderer!.container.querySelector<HTMLInputElement>('.q-canvas-link-dialog__field')!;
    expect(field).not.toBeNull();
    await actAndSettle(() => {
      field.value = 'https://example.com/page';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await actAndSettle(() => {
      renderer!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'link', url: 'https://example.com/page' });
  });

  it('removes a plain text card that was left empty', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'empty', type: 'text', x: 0, y: 0, width: 200, height: 120, text: '' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const textarea = renderer!.container.querySelector<HTMLTextAreaElement>('.q-canvas-card--text textarea')!;
    expect(textarea).not.toBeNull();
    await actAndSettle(() => { textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });

    expect(renderer!.container.querySelectorAll('.q-canvas__object')).toHaveLength(0);
  });

  it('connects cards by dragging a side handle onto another card', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 160, height: 100, text: 'A' },
        { id: 'b', type: 'text', x: 400, y: 0, width: 160, height: 100, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__connect[data-side="right"]')!;
    expect(handle).not.toBeNull();
    await actAndSettle(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 160, clientY: 50, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 480, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 480, clientY: 50, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges).toHaveLength(1);
    expect(saved.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' });
  });

  it('imports a dropped image into the vault and places a file card', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    await actAndSettle(() => {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: { files: [file], getData: () => '' },
      });
      stage.dispatchEvent(drop);
    });
    await act(settleAutosave);

    expect(vi.mocked(importIntoFiles)).toHaveBeenCalledTimes(1);
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'file', file: 'Files/image.png' });
  });

  it('imports an image pasted onto the board', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    await actAndSettle(() => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { files: [file] } });
      canvas.dispatchEvent(paste);
    });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'file', file: 'Files/image.png' });
  });

  it('draws shapes as SVG geometry that survives losing the selection', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'rect', type: 'text', x: 0, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'rectangle' } },
        { id: 'diamond', type: 'text', x: 200, y: 0, width: 160, height: 100, text: 'D', obsidium: { shape: 'diamond' } },
        { id: 'ellipse', type: 'text', x: 400, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'ellipse', fill: 'transparent' } },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelectorAll('.q-canvas__shape-body')).toHaveLength(3);
    expect(renderer!.container.querySelectorAll('.q-canvas__shape')).toHaveLength(3);
    expect(renderer!.container.querySelectorAll('polygon.q-canvas__shape-body')).toHaveLength(1);
    expect(renderer!.container.querySelectorAll('ellipse.q-canvas__shape-body')).toHaveLength(1);
    expect(renderer!.container.querySelector('.q-canvas__object--shape[data-fill="transparent"]')).not.toBeNull();
    expect(renderer!.container.querySelector('.q-canvas-card')?.getAttribute('style')).toContain('--q-canvas-font-size');
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas-card')!.style.getPropertyValue('--q-canvas-node-color')).toBe('');

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 700, clientY: 700, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 700, clientY: 700, bubbles: true })); });

    expect(renderer!.container.querySelectorAll('.q-canvas__shape-body')).toHaveLength(3);
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(0);
  });

  it('grows a rectangle while typing so centred text is never clipped', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'rect', type: 'text', x: 0, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'rectangle' } }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const textarea = renderer!.container.querySelector<HTMLTextAreaElement>('.q-canvas-card--shape textarea')!;
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea, 'clientHeight', { value: 100 });
    Object.defineProperty(textarea, 'scrollHeight', { value: 260 });

    const line = 'a wrapped line that is longer than the rectangle can show';
    await actAndSettle(() => {
      textarea.value = line;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(settleAutosave);

    expect(textarea.value).toBe(line);
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0].height).toBe(260);
    expect(saved.nodes[0]).toMatchObject({ type: 'text', text: line, obsidium: { shape: 'rectangle' } });
  });

  it('counter-scales shape strokes and resize handles with the zoom', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'rect', type: 'text', x: 0, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'rectangle' } }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true })); });
    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__resize')!;
    expect(handle.style.transform).toBe('translate(-50%, -50%) scale(1)');
    expect(Number(renderer!.container.querySelector('.q-canvas__shape-body')!.getAttribute('stroke-width'))).toBe(2);

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    await actAndSettle(() => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true, cancelable: true }));
    });
    const zoom = Number(renderer!.container.querySelector<HTMLElement>('.q-canvas__world')!.style.transform.match(/scale\(([\d.]+)\)/)?.[1]);
    expect(zoom).toBeGreaterThan(1);
    expect(Number(renderer!.container.querySelector('.q-canvas__shape-body')!.getAttribute('stroke-width'))).toBeCloseTo(2 / zoom, 4);
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__resize')!.style.transform)
      .toBe(`translate(-50%, -50%) scale(${1 / zoom})`);
  });

  it('shows resize handles on the single node and on the multi-selection frame', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    expect(renderer!.container.querySelectorAll('.q-canvas__resize')).toHaveLength(0);
    expect(renderer!.container.querySelector('.q-canvas__selection-frame')).toBeNull();
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(2);
    expect(renderer!.container.querySelector('.q-canvas__selection-frame')).not.toBeNull();
    expect(renderer!.container.querySelectorAll('.q-canvas__selection-frame .q-canvas__resize')).toHaveLength(8);

    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas__selection-frame')).toBeNull();
    expect(renderer!.container.querySelectorAll('.q-canvas__resize')).toHaveLength(8);
  });

  it('renders image file nodes from the workspace root and videos with controls', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'image', type: 'file', x: 0, y: 0, width: 200, height: 160, file: 'Files/photo.png' },
        { id: 'video', type: 'file', x: 240, y: 0, width: 200, height: 160, file: 'Files/clip.mp4' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Boards/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const image = renderer!.container.querySelector<HTMLImageElement>('.q-canvas-card__media-image')!;
    expect(image.getAttribute('src')).toBe('/vault/Files/photo.png');
    expect(renderer!.container.querySelector('.q-canvas-card__title')).toBeNull();
    const video = renderer!.container.querySelector<HTMLVideoElement>('video.q-canvas-card__media-video')!;
    expect(video.getAttribute('src')).toBe('/vault/Files/clip.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
  });

  it('resolves images in text cards from the board directory', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'text', type: 'text', x: 0, y: 0, width: 300, height: 200, text: '![x](pics/diagram.png)' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Boards/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const image = renderer!.container.querySelector<HTMLImageElement>('.q-canvas-card__markdown img')!;
    expect(image.getAttribute('src')).toBe('/vault/Boards/pics/diagram.png');
  });

  it('imports a screenshot exposed only as a clipboard item', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'screenshot.png', { type: 'image/png' });
    await actAndSettle(() => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          files: [],
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
          getData: () => '',
        },
      });
      canvas.dispatchEvent(paste);
    });
    await act(settleAutosave);

    expect(vi.mocked(importIntoFiles)).toHaveBeenCalledTimes(1);
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'file', file: 'Files/image.png' });
  });

  it('creates a link card from a pasted image URL', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    await actAndSettle(() => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          files: [],
          items: [],
          getData: (kind: string) => kind === 'text/plain' ? 'https://example.test/pic.png' : '',
        },
      });
      canvas.dispatchEvent(paste);
    });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'link', url: 'https://example.test/pic.png' });
    expect(renderer!.container.querySelector('.q-canvas-card__media-image')?.getAttribute('src'))
      .toBe('https://example.test/pic.png');
  });

  it('changes visible paint order and duplicates from the selection toolbar', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'back', type: 'text', x: 0, y: 0, width: 200, height: 140, text: 'Back' },
        { id: 'front', type: 'text', x: 40, y: 20, width: 200, height: 140, text: 'Front' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const objects = () => [...renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object')];
    expect(objects().map((node) => node.style.zIndex)).toEqual(['1', '2']);

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { objects()[0].dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 20, clientY: 20, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="nodes"]')).not.toBeNull();
    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.selection.front"]')!.click(); });
    expect(objects().map((node) => node.style.zIndex)).toEqual(['1', '2']);
    expect(objects()[1].textContent).toContain('Back');

    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.selection.duplicate"]')!.click(); });
    expect(objects()).toHaveLength(3);
  });

  it('ungroups without deleting the members', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'group', type: 'group', x: 0, y: 0, width: 320, height: 220, label: 'Group' },
        { id: 'member', type: 'text', x: 40, y: 40, width: 160, height: 100, text: 'Member' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.selection.ungroup"]')!.click(); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes.map((node: { id: string }) => node.id)).toEqual(['member']);
    expect(renderer!.container.querySelector('.q-canvas__object.is-selected')).not.toBeNull();
  });

  it('moves an existing object instead of drawing when a shape tool is armed', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'shape', type: 'text', x: 0, y: 0, width: 160, height: 110, text: '', obsidium: { shape: 'diamond' } }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true, cancelable: true })); });
    expect(canvas.dataset.activeTool).toBe('diamond');

    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 50, bubbles: true })); });
    await act(settleAutosave);

    expect(renderer!.container.querySelectorAll('.q-canvas__object')).toHaveLength(1);
    expect(object.style.left).toBe('40px');
    expect(canvas.dataset.activeTool).toBe('select');
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes).toHaveLength(1);
    expect(saved.nodes[0]).toMatchObject({ id: 'shape', x: 40, y: 30 });
  });

  it('selects the whole group when a member is clicked', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'group', type: 'group', x: 0, y: 0, width: 360, height: 260, label: 'Group' },
        { id: 'first', type: 'text', x: 40, y: 40, width: 120, height: 80, text: 'First' },
        { id: 'second', type: 'text', x: 200, y: 140, width: 120, height: 80, text: 'Second' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true })); });

    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(1);
    expect(renderer!.container.querySelector('.q-canvas__object.is-selected')?.textContent).toContain('Group');
    expect(renderer!.container.querySelectorAll('.q-canvas__resize')).toHaveLength(8);
    expect(renderer!.container.querySelectorAll('.q-canvas__connect')).toHaveLength(0);
  });

  it('moves a group and its members together when reordering', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'group', type: 'group', x: 0, y: 0, width: 360, height: 260, label: 'Group' },
        { id: 'first', type: 'text', x: 40, y: 40, width: 120, height: 80, text: 'First' },
        { id: 'second', type: 'text', x: 200, y: 140, width: 120, height: 80, text: 'Second' },
        { id: 'outside', type: 'text', x: 500, y: 0, width: 120, height: 80, text: 'Outside' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    expect([...renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object')].map((object) => object.textContent))
      .toEqual(['Group', 'First', 'Second', 'Outside']);

    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true })); });
    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('[aria-label="canvas.selection.front"]')!.click(); });

    expect([...renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object')].map((object) => object.textContent))
      .toEqual(['Outside', 'Group', 'First', 'Second']);
  });

  it('scales group members when the group is resized from a handle', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'group', type: 'group', x: 0, y: 0, width: 320, height: 220, label: 'Group' },
        { id: 'first', type: 'text', x: 40, y: 40, width: 160, height: 100, text: 'First' },
        { id: 'second', type: 'text', x: 200, y: 120, width: 100, height: 80, text: 'Second' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true })); });

    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__resize[data-handle="bottom-right"]')!;
    expect(handle).not.toBeNull();
    await actAndSettle(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 320, clientY: 220, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 640, clientY: 440, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 640, clientY: 440, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    const byId = Object.fromEntries(saved.nodes.map((node: { id: string }) => [node.id, node]));
    expect(byId.group).toMatchObject({ x: 0, y: 0, width: 640, height: 440 });
    expect(byId.first).toMatchObject({ x: 80, y: 80, width: 320, height: 200 });
    expect(byId.second).toMatchObject({ x: 400, y: 240, width: 200, height: 160 });
  });

  it('creates a default-sized shape when the tool is clicked without dragging', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 40, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 40, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ width: 160, height: 100, obsidium: { shape: 'ellipse' } });
    expect(renderer!.container.querySelector('.q-canvas__shape-body')).not.toBeNull();
  });

  it('creates unfilled shapes and fills them from the properties panel', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 90, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 120, clientY: 90, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0].obsidium).toEqual({ shape: 'rectangle', fill: 'transparent' });
    expect(renderer!.container.querySelector('.q-canvas__object--shape[data-fill="transparent"]')).not.toBeNull();

    const background = renderer!.container.querySelector<HTMLElement>('.q-canvas-properties__section--background')!;
    const swatch = [...background.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.getAttribute('aria-label') === 'canvas.toolbar.color.4',
    )!;
    await actAndSettle(() => { swatch.click(); });
    await act(settleAutosave);

    const filledWrites = vi.mocked(writeFileAtomic).mock.calls;
    const filled = JSON.parse(String(filledWrites[filledWrites.length - 1]?.[1]));
    expect(filled.nodes[0].obsidium).toMatchObject({ shape: 'rectangle', fill: '4' });
  });

  it('keeps the drawing tool active until Escape', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 90, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 120, clientY: 90, bubbles: true })); });
    expect(canvas.dataset.activeTool).toBe('rectangle');

    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, clientY: 200, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 260, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 280, clientY: 260, bubbles: true })); });
    await act(settleAutosave);
    expect(renderer!.container.querySelectorAll('.q-canvas__object--shape')).toHaveLength(2);

    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(canvas.dataset.activeTool).toBe('select');
  });

  it('keeps the freehand and number tools active after one use', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0, bubbles: true })); });
    expect(canvas.dataset.activeTool).toBe('number');

    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 80, clientY: 60, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 120, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 120, bubbles: true })); });
    expect(canvas.dataset.activeTool).toBe('draw');
  });

  it('keeps connection dots reachable from the card edge', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 160, height: 100, text: 'A' },
        { id: 'b', type: 'text', x: 400, y: 0, width: 160, height: 100, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__connect[data-side="right"]')!;
    expect(handle.style.transform).toBe('translate(-50%, -50%) scale(1)');
    await actAndSettle(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 160, clientY: 50, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 480, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 480, clientY: 50, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges).toHaveLength(1);
    expect(saved.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b' });
  });

  it('restores a moved object with undo and redo', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 50, bubbles: true })); });
    expect(object.style.left).toBe('40px');

    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!.style.left).toBe('0px');
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!.style.left).toBe('40px');
  });

  it('keeps the connection panel until the edge selection is cleared', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', toEnd: 'arrow' }],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const edge = renderer!.container.querySelector<SVGPathElement>('path[aria-label="a → b"]')!;
    await actAndSettle(() => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="edge"]')).not.toBeNull();

    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 300, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties')).toBeNull();

    await actAndSettle(() => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="edge"]')).not.toBeNull();
    await actAndSettle(() => { renderer!.container.querySelector<HTMLElement>('.q-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties')).toBeNull();
  });

  it('hides the panel while dragging and closes it from the header', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const object = renderer!.container.querySelector<HTMLElement>('.q-canvas__object')!;
    await actAndSettle(() => { object.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="nodes"]')).not.toBeNull();

    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 60, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties')).toBeNull();
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 60, bubbles: true })); });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="nodes"]')).not.toBeNull();

    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="canvas.props.close"]')!.click(); });
    expect(renderer!.container.querySelector('.q-canvas-properties')).toBeNull();
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(0);
  });

  it('applies appearance patches to every selected node', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="canvas.props.size.xl"]')!.click(); });
    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="canvas.props.width.4"]')!.click(); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0].obsidium).toMatchObject({ fontSize: 'xl', strokeWidth: 4 });
    expect(saved.nodes[1].obsidium).toMatchObject({ fontSize: 'xl', strokeWidth: 4 });
    const card = renderer!.container.querySelector<HTMLElement>('[data-node-id="a"]')!;
    expect(card.style.getPropertyValue('--q-canvas-font-size')).toBe('24px');
    expect(card.style.getPropertyValue('--q-canvas-text-align')).toBe('left');
  });

  it('resizes a multi-selection from the selection frame handles', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 80, text: 'B' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const canvas = renderer!.container.querySelector<HTMLElement>('.q-canvas')!;
    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__selection-frame .q-canvas__resize[data-handle="bottom-right"]')!;
    expect(handle).not.toBeNull();
    await actAndSettle(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 80, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, clientY: 160, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 600, clientY: 160, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ x: 0, y: 0, width: 200, height: 160 });
    expect(saved.nodes[1]).toMatchObject({ x: 400, y: 0, width: 200, height: 160 });
  });

  it('moves a group and its members together when dragging', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'group', type: 'group', x: 0, y: 0, width: 360, height: 260, label: 'Group' },
        { id: 'first', type: 'text', x: 40, y: 40, width: 120, height: 80, text: 'First' },
        { id: 'second', type: 'text', x: 200, y: 140, width: 120, height: 80, text: 'Second' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[1].dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 110, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 120, clientY: 110, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    const byId = Object.fromEntries(saved.nodes.map((node: { id: string }) => [node.id, node]));
    expect(byId.group).toMatchObject({ x: 60, y: 50 });
    expect(byId.first).toMatchObject({ x: 100, y: 90 });
    expect(byId.second).toMatchObject({ x: 260, y: 190 });
  });

  it('connects a shape node to a link node from a side handle', async () => {
    canvasSource.content = JSON.stringify({
      nodes: [
        { id: 'shape', type: 'text', x: 0, y: 0, width: 160, height: 100, text: '', obsidium: { shape: 'rectangle', fill: 'transparent' } },
        { id: 'link', type: 'link', x: 400, y: 0, width: 160, height: 100, url: 'https://example.com' },
      ],
      edges: [],
    });
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() });
    const handle = renderer!.container.querySelector<HTMLElement>('.q-canvas__object--shape .q-canvas__connect[data-side="right"]')!;
    expect(handle).not.toBeNull();
    await actAndSettle(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 160, clientY: 50, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 480, clientY: 50, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 480, clientY: 50, bubbles: true })); });
    await act(settleAutosave);

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges[0]).toMatchObject({ fromNode: 'shape', toNode: 'link', fromSide: 'right' });
    expect(renderer!.container.querySelector('.q-canvas-properties[data-target="edge"]')).not.toBeNull();
  });

  it('creates a note from the picker at the pointer placement', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    await actAndSettle(() => { renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="canvas.toolbar.addNote"]')!.click(); });
    const field = renderer!.container.querySelector<HTMLInputElement>('.q-canvas-search-input')!;
    expect(field).not.toBeNull();
    await actAndSettle(() => {
      field.value = 'Idea';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await actAndSettle(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await act(settleAutosave);

    expect(vi.mocked(createUniqueFile)).toHaveBeenCalledWith('/vault', 'Idea');
    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.nodes[0]).toMatchObject({ type: 'file', file: 'New note.md' });
  });
});
