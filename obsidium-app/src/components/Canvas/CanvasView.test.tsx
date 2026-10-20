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
vi.mock('../../modules/docs/vaultFiles', () => ({ importIntoFiles: vi.fn(async () => 'Files/image.png') }));

function settleAutosave(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, 450); });
}

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
    expect(renderer!.container.querySelector('.q-canvas-card')?.getAttribute('style')).toBeNull();

    const stage = renderer!.container.querySelector<HTMLElement>('.q-canvas__stage')!;
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 700, clientY: 700, button: 0, bubbles: true })); });
    await actAndSettle(() => { stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 700, clientY: 700, bubbles: true })); });

    expect(renderer!.container.querySelectorAll('.q-canvas__shape-body')).toHaveLength(3);
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(0);
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

  it('shows resize handles only for a single selection', async () => {
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
    await actAndSettle(() => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(renderer!.container.querySelectorAll('.q-canvas__object.is-selected')).toHaveLength(2);
    expect(renderer!.container.querySelectorAll('.q-canvas__resize')).toHaveLength(0);

    const objects = renderer!.container.querySelectorAll<HTMLElement>('.q-canvas__object');
    await actAndSettle(() => { objects[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })); });
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
    expect(renderer!.container.querySelector('[role="toolbar"][aria-label="canvas.selection.label"]')).not.toBeNull();
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

  it('creates unfilled shapes when the fill control is set to none', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasView path="/vault/Board.canvas" workspacePath="/vault" inactive={false} indexRevision={0} onOpenFile={vi.fn()} />,
      );
    });
    await actAndSettle();

    const fill = renderer!.container.querySelector<HTMLSelectElement>('select[aria-label="canvas.fill.label"]')!;
    await actAndSettle(() => {
      fill.value = 'transparent';
      fill.dispatchEvent(new Event('change', { bubbles: true }));
    });
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
});
