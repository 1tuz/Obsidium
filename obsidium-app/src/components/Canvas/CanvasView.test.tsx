// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
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
vi.mock('./CanvasCard', () => ({ CanvasCard: () => null }));

const { CanvasView } = await import('./CanvasView');
const { writeFileAtomic } = await import('../../modules/documents/fileGateway');

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
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true })); });
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
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })); });
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
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true })); });
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
    const route = renderer!.container.querySelector<HTMLSelectElement>('select[aria-label="canvas.edgeRoute"]')!;
    await actAndSettle(() => {
      route.value = 'curved';
      route.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = JSON.parse(String(writes[writes.length - 1]?.[1]));
    expect(saved.edges[0]).toMatchObject({ id: 'edge', fromNode: 'a', toNode: 'b', obsidium: { route: 'curved' } });
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
    const color = renderer!.container.querySelector<HTMLSelectElement>('select[aria-label="canvas.toolbar.colorLabel"]')!;
    await actAndSettle(() => {
      color.value = '4';
      color.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));

    const writes = vi.mocked(writeFileAtomic).mock.calls;
    const saved = writes[writes.length - 1]?.[1];
    expect(JSON.parse(String(saved)).nodes[0].color).toBe('4');
  });
});
