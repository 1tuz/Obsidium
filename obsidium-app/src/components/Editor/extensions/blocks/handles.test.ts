// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../../../../modules/blocks/model';
import { moveBlocks } from '../../../../modules/blocks/move';
import { blockHandlesExtension } from './handles';
import type { MenuEntry, MenuItem } from '../../../Common/Menu';
import { setBlockMenuHost, type BlockMenuRequest } from './menuHost';

const DOC = ['alpha', '', 'beta', '', '- one', '- two', '', 'gamma'].join('\n');

let view: EditorView | null = null;
let parent: HTMLElement | null = null;
let menuRequest: BlockMenuRequest | null = null;

async function mount(doc: string, options: { enabled?: boolean; readOnly?: boolean; path?: () => string } = {}): Promise<void> {
  parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    doc,
    extensions: [
      blockHandlesExtension({
        enabled: options.enabled ?? true,
        readOnly: options.readOnly ?? false,
        path: options.path ?? (() => 'notes/test.md'),
      }),
    ],
    parent,
  });
  setBlockMenuHost(view, (request) => {
    menuRequest = request;
  });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}
function menuItems(): { id: string; onSelect: () => void }[] {
  const entries: MenuEntry[] = menuRequest?.items ?? [];
  return entries.filter((entry): entry is MenuItem => entry.type !== 'separator');
}

afterEach(() => {
  setBlockMenuHost(view!, null);
  view?.destroy();
  parent?.remove();
  view = null;
  parent = null;
  menuRequest = null;
  vi.restoreAllMocks();
});

function findItem(id: string): { id: string; onSelect: () => void } {
  const item = menuItems().find((entry) => entry.id === id);
  expect(item).toBeDefined();
  return item!;
}

describe('block handles extension', () => {
  it('mounts handle and indicator overlays without changing block layout', async () => {
    await mount(DOC);
    const scroller = view!.scrollDOM;
    expect(scroller.querySelector('.q-block-handle')).not.toBeNull();
    expect(scroller.querySelector('.q-block-drop-indicator')).not.toBeNull();
    const lines = scroller.querySelectorAll('.cm-line');
    expect(lines.length).toBeGreaterThan(0);
    for (const element of scroller.querySelectorAll('.cm-line')) {
      expect(getComputedStyle(element).margin).toBe('');
    }
  });

  it('installs nothing when disabled or read-only', async () => {
    await mount(DOC, { enabled: false, readOnly: false });
    expect(view!.scrollDOM.querySelector('.q-block-handle')).toBeNull();
    setBlockMenuHost(view!, null);
    view!.destroy();
    parent!.remove();
    view = null;
    parent = null;
    menuRequest = null;

    await mount(DOC, { enabled: true, readOnly: true });
    expect(view!.scrollDOM.querySelector('.q-block-handle')).toBeNull();
  });

  it('exposes menu items for duplicate, copy link, synced, delete and turn targets', async () => {
    await mount(DOC);
    const block = scanDocument(view!.state.doc)[0]!;
    view!.dispatch({ selection: { anchor: block.from } });
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    expect(menuRequest).not.toBeNull();
    expect(menuRequest!.ariaLabel).toBe('Block actions');
    const ids = menuItems().map((item) => item.id);
    expect(ids).toContain('duplicate');
    expect(ids).toContain('copyLink');
    expect(ids).toContain('insertSynced');
    expect(ids).toContain('delete');
    expect(ids.filter((id) => id.startsWith('turnInto-'))).toHaveLength(13);
  });

  it('dispatches a delete change from the menu', async () => {
    await mount(DOC);
    const block = scanDocument(view!.state.doc)[1]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    findItem('delete').onSelect();
    expect(view!.state.doc.toString()).toBe('alpha\n\n- one\n- two\n\ngamma');
  });

  it('dispatches a duplicate change from the menu', async () => {
    await mount(DOC);
    const block = scanDocument(view!.state.doc)[0]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    findItem('duplicate').onSelect();
    expect(view!.state.doc.toString()).toBe('alpha\nalpha\n\nbeta\n\n- one\n- two\n\ngamma');
  });

  it('dispatches turn into changes from the menu', async () => {
    await mount(DOC);
    const block = scanDocument(view!.state.doc)[0]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    findItem('turnInto-heading2').onSelect();
    expect(view!.state.doc.toString()).toBe('## alpha\n\nbeta\n\n- one\n- two\n\ngamma');
  });

  it('adds a block reference and copies the link from the menu', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(DOC, { path: () => 'notes/linked.md' });
    const block = scanDocument(view!.state.doc)[0]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    findItem('copyLink').onSelect();
    expect(view!.state.doc.toString()).toBe('alpha ^blk-1\n\nbeta\n\n- one\n- two\n\ngamma');
    expect(writeText).toHaveBeenCalledWith('[[notes/linked.md#^blk-1]]');
  });

  it('reuses an existing block reference when copying the link', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount('text ^existing\n\nother');
    const block = scanDocument(view!.state.doc)[0]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(block.from);
    handle.click();
    findItem('copyLink').onSelect();
    expect(view!.state.doc.toString()).toBe('text ^existing\n\nother');
    expect(writeText).toHaveBeenCalledWith('[[notes/test.md#^existing]]');
  });
});

describe('drag move via moveBlocks', () => {
  it('moves a block when its handle is dragged to another block', async () => {
    await mount(DOC);
    const blocks = scanDocument(view!.state.doc);
    const start = blocks[0]!;
    const target = blocks[1]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(start.from);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    vi.spyOn(view!, 'posAtCoords').mockImplementation(({ y }) => y < 50 ? start.from : target.from);
    vi.spyOn(view!, 'coordsAtPos').mockImplementation((pos) => {
      const top = pos <= start.to ? 0 : 100;
      return { top, bottom: top + 20 } as DOMRect;
    });
    vi.spyOn(view!.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 500 } as DOMRect));
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 10 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 0, clientY: 119 }));
    expect(view!.scrollDOM.querySelector('.q-block-drop-indicator--visible')).not.toBeNull();
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0, clientY: 119 }));
    expect(view!.state.doc.toString()).toBe('beta\n\nalpha\n\n- one\n- two\n\ngamma');
  });

  it('moves a block inside a list item when its handle is dragged into the container', async () => {
    await mount(DOC);
    const blocks = scanDocument(view!.state.doc);
    const start = blocks[0]!;
    const target = blocks[2]!;
    const handle = view!.scrollDOM.querySelector<HTMLElement>('.q-block-handle')!;
    handle.dataset.blockFrom = String(start.from);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    vi.spyOn(view!, 'posAtCoords').mockImplementation(({ y }) => y < 50 ? start.from : target.from);
    vi.spyOn(view!, 'coordsAtPos').mockImplementation((pos) => {
      const top = pos <= start.to ? 0 : 100;
      return { top, bottom: top + (pos <= start.to ? 20 : 60) } as DOMRect;
    });
    vi.spyOn(view!.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 500 } as DOMRect));
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 10 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 0, clientY: 130 }));
    const indicator = view!.scrollDOM.querySelector<HTMLElement>('.q-block-drop-indicator--visible');
    expect(indicator?.dataset.mode).toBe('inside');
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0, clientY: 130 }));
    expect(view!.state.doc.toString()).toBe('beta\n\n- one\n  alpha\n- two\n\ngamma');
  });

  it('applies a single undoable change for a block move', async () => {
    await mount(DOC);
    const doc = scanDocument(view!.state.doc);
    const change = moveBlocks(
      view!.state.doc.toString(),
      [{ from: doc[2]!.from, to: doc[2]!.to }],
      { mode: 'after', block: doc[1]! },
    );
    expect(change).not.toBeNull();
    const before = view!.state.doc.toString();
    view!.dispatch({ changes: change! });
    expect(view!.state.doc.toString()).not.toBe(before);
    view!.dispatch({ changes: { from: change!.from, to: change!.from + change!.insert.length, insert: '' } });
    expect(view!.state.doc.toString()).toContain('alpha');
    expect(view!.state.doc.toString()).toContain('- one');
  });
});
