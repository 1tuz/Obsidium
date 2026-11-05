// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView, type BlockInfo } from '@codemirror/view';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { HeadingMinimap, dockFactor, markWidth, minimapRows, rowStep } from './HeadingMinimap';
import { minimapExtension, subscribeMinimap, type MinimapMark, type MinimapState } from './extensions/blocks/minimapBridge';

const HEADINGS = ['# Alpha', '## Middle', '# Omega'].join('\n\n');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('minimapRows', () => {
  const marks = (count: number): MinimapMark[] => Array.from({ length: count }, (_, index) => ({
    level: (index % 6) + 1,
    text: `heading ${index}`,
    pos: index * 10,
  }));

  it('keeps every heading as its own row while the viewport has room', () => {
    const rows = minimapRows(marks(3), 300, 0);
    expect(rows.map((row) => row.mark.text)).toEqual(['heading 0', 'heading 1', 'heading 2']);
    expect(rows.map((row) => row.source)).toEqual([0, 1, 2]);
  });

  it('keeps every heading while the viewport is not measured yet', () => {
    expect(minimapRows(marks(200), 0, 0)).toHaveLength(200);
  });

  it('drops rows instead of growing past the viewport', () => {
    const rows = minimapRows(marks(200), 300, 0);
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows[0]!.source).toBe(0);
    expect(rows[rows.length - 1]!.source).toBe(198);
  });

  it('always keeps the heading owning the caret', () => {
    const rows = minimapRows(marks(200), 300, 101);
    expect(rows.some((row) => row.source === 101)).toBe(true);
    expect(rows.map((row) => row.source)).toEqual([...rows.map((row) => row.source)].sort((a, b) => a - b));
  });
});

describe('rowStep', () => {
  it('keeps the dock compact while marks are few', () => {
    expect(rowStep(3, 300)).toBe(12);
    expect(rowStep(1, 800)).toBe(12);
  });

  it('shrinks rows, but not below 3px, when headings outgrow the viewport', () => {
    expect(rowStep(100, 300)).toBe(3);
    expect(rowStep(40, 300)).toBe(7);
    expect(rowStep(1000, 300)).toBe(3);
  });

  it('falls back to the max step without marks or measurement', () => {
    expect(rowStep(0, 300)).toBe(12);
    expect(rowStep(3, 0)).toBe(12);
  });
});

describe('dockFactor', () => {
  it('peaks under the pointer and decays over three rows', () => {
    expect(dockFactor(0, 12)).toBeCloseTo(1.6);
    expect(dockFactor(12, 12)).toBeCloseTo(1.4);
    expect(dockFactor(36, 12)).toBeCloseTo(1);
    expect(dockFactor(120, 12)).toBeCloseTo(1);
  });
});

describe('markWidth', () => {
  it('scales the level base width by the dock factor and caps it inside the rail', () => {
    expect(markWidth(1, 1)).toBe(15);
    expect(markWidth(1, 1.6)).toBe(23);
    expect(markWidth(3, 1.4)).toBe(18);
    expect(markWidth(6, 1)).toBe(10);
    expect(markWidth(1, 1.6)).toBeLessThanOrEqual(24);
  });
});

describe('HeadingMinimap', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  function setup(source = HEADINGS) {
    const container = document.createElement('div');
    container.className = 'q-editor-container';
    const content = document.createElement('div');
    content.className = 'q-editor-content';
    const body = document.createElement('div');
    container.append(content); content.append(body); document.body.append(container);
    const view = new EditorView({
      parent: body,
      state: EditorState.create({ doc: source, extensions: [minimapExtension()] }),
    });
    Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 300 });
    Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 300 });
    vi.spyOn(view, 'lineBlockAt').mockImplementation((pos: number) => ({ top: pos * 10 }) as BlockInfo);
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 300, height: 300 } as DOMRect));
    vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 300, height: 300 } as DOMRect));
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 300, height: 300 } as DOMRect));
    const host = document.createElement('div');
    body.append(host);
    act(() => { renderer = mountDom(<HeadingMinimap view={view} />); });
    const nav = renderer!.container.querySelector<HTMLElement>('.q-block-minimap')!;
    const strokes = [...nav.querySelectorAll<HTMLButtonElement>('.q-block-minimap__stroke')];
    const widths = () => strokes.map((stroke) => Number(/width: (\d+)px/u.exec(stroke.getAttribute('style') ?? '')?.[1]));
    const tops = () => strokes.map((stroke) => Number(/top: ([\d.]+)px/u.exec(stroke.getAttribute('style') ?? '')?.[1]));
    const hover = (clientY: number) => {
      vi.spyOn(nav, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 300, height: 300 } as DOMRect));
      act(() => { nav.dispatchEvent(new PointerEvent('pointermove', { clientY, bubbles: true })); });
    };
    return { nav, strokes, widths, tops, hover, view };
  }

  it('stacks one stroke per heading at a fixed dock step', () => {
    const { nav, strokes, tops, widths } = setup();
    expect(strokes.length).toBe(3);
    expect(strokes.map((stroke) => stroke.dataset.level)).toEqual(['1', '2', '1']);
    expect(tops()).toEqual([6, 18, 30]);
    expect(nav.style.height).toBe('36px');
    expect(widths()).toEqual([markWidth(1, 1), markWidth(2, 1), markWidth(1, 1)]);
    expect(nav.querySelector('.q-block-minimap__label')).toBeNull();
  });

  it('grows the stroke under the pointer most and neighbours less', () => {
    const { widths, hover } = setup();
    hover(18);
    expect(widths()).toEqual([markWidth(1, 1.4), markWidth(2, 1.5), markWidth(1, 1.4)]);
    hover(6);
    expect(widths()).toEqual([markWidth(1, 1.5), markWidth(2, 1.4), markWidth(1, 1.2)]);
  });

  it('shows the hovered heading text on the rail and clears it on leave', () => {
    const { nav, hover } = setup();
    hover(18);
    const label = nav.querySelector<HTMLElement>('.q-block-minimap__label')!;
    expect(label.textContent).toBe('Middle');
    expect(label.style.top).toBe('18px');
    act(() => { nav.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); });
    expect(nav.querySelector('.q-block-minimap__label')).toBeNull();
  });

  it('marks the heading owning the current scroll position and labels strokes for assistive tech', () => {
    const { strokes } = setup();
    expect(strokes.map((stroke) => stroke.getAttribute('aria-current'))).toEqual(['true', null, null]);
    expect(strokes.map((stroke) => stroke.getAttribute('aria-label'))).toEqual(['Alpha', 'Middle', 'Omega']);
  });

  it('jumps to the heading position on click', () => {
    const { strokes, view } = setup();
    act(() => { strokes[2]!.click(); });
    expect(view.state.selection.main.anchor).toBe(HEADINGS.indexOf('# Omega'));
    view.destroy();
  });

  it('compresses rows so a long outline stays inside the viewport', () => {
    const source = Array.from({ length: 100 }, (_, index) => `# heading ${index}`).join('\n\n');
    const { nav, strokes, tops } = setup(source);
    expect(strokes.length).toBe(100);
    expect(nav.style.height).toBe('300px');
    expect(tops()[1]).toBe(4.5);
    expect(nav.style.top).toBe('0px');
  });

  it('drops rows of a dense outline so the rail never grows past the viewport', () => {
    const source = Array.from({ length: 400 }, (_, index) => `# heading ${index}`).join('\n\n');
    const { nav, strokes } = setup(source);
    expect(strokes.length).toBeLessThan(400);
    expect(Number.parseFloat(nav.style.height)).toBeLessThanOrEqual(300);
  });

  it('pins the dock to the visible top of the scroll viewport', () => {
    const body = document.createElement('div');
    body.className = 'q-editor-content__body';
    document.body.append(body);
    const view = new EditorView({
      parent: body,
      state: EditorState.create({ doc: '# Only', extensions: [minimapExtension()] }),
    });
    Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 100 });
    vi.spyOn(view, 'lineBlockAt').mockImplementation(() => ({ top: 0 }) as BlockInfo);
    vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 100, height: 100 } as DOMRect));
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 100, height: 100 } as DOMRect));
    let state: MinimapState | undefined;
    const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
    expect(state!.top).toBe(0);
    expect(state!.viewportHeight).toBe(100);
    unsubscribe();
    view.destroy();
  });
});
