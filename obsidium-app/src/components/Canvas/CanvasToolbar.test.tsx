// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasToolbar } from './CanvasToolbar';
import { t as translatePaperStyle } from '../../i18n';

const canvasStyles = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasView.css'), 'utf8');
const canvasToolbarSource = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasToolbar.tsx'), 'utf8');
const canvasToolbarStyles = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasToolbar.css'), 'utf8');

describe('CanvasToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('uses the canvas ink token for tool icons on paper surfaces', () => {
    expect(canvasStyles).toMatch(/\.q-canvas\[data-paper-style\]\s*\{[^}]*--q-icon-button-icon:\s*var\(--q-canvas-ink\);/s);
    expect(canvasStyles).toMatch(/--q-canvas-grid-line:\s*color-mix\(in srgb, var\(--q-canvas-ink-solid\) 34%, var\(--q-canvas-paper-solid\)\)/);
    expect(canvasStyles).toMatch(/\.q-canvas__stage--lines\s*\{[^}]*var\(--q-canvas-grid-line/);
    expect(canvasStyles).toMatch(/\.q-canvas__object--shape\s*\{[^}]*--q-canvas-shape-stroke:/s);
    expect(canvasStyles).toMatch(/--q-canvas-shape-fill:\s*color-mix\(in srgb, var\(--q-canvas-node-color, var\(--q-canvas-ink-solid\)\) 20%/);
    expect(canvasStyles).not.toMatch(/clip-path:\s*polygon/);
    expect(canvasStyles).toMatch(/\.q-canvas__connect\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('never nests color-mix inside a canvas token', () => {
    const declarations = [...canvasStyles.matchAll(/(--[\w-]+):\s*([^;]+);/g)];
    const nested = declarations.filter(([, name, value]) => (
      name.startsWith('--q-canvas-')
      && /color-mix\(/u.test(value)
      && /var\(--q-canvas-(?:ink|paper|card)(?![\w-])/u.test(value)
    ));
    expect(nested.map(([, name]) => name)).toEqual([]);
  });

  it('keeps the dark grid line visible against the dark paper', () => {
    expect(canvasStyles).toMatch(/:root\[data-theme='dark'\] \.q-canvas\[data-paper-style\]\s*\{[^}]*--q-canvas-grid-line:\s*color-mix\(in srgb, var\(--q-canvas-ink-solid\) 46%/s);
  });

  it('tints the armed tool with accent tokens instead of the neutral pressed wash', () => {
    expect(canvasToolbarStyles).toMatch(/\.q-canvas-toolbar__tools \.q-icon-button\[aria-pressed='true'\]\s*\{[^}]*background-color:\s*var\(--q-bg-accent-subtle\);/s);
    expect(canvasToolbarStyles).toMatch(/\.q-canvas-toolbar__tools \.q-icon-button\[aria-pressed='true'\]\s*\{[^}]*color:\s*var\(--q-icon-accent\);/s);
    expect(canvasToolbarStyles).toMatch(/\.q-canvas-toolbar__tools \.q-icon-button\[aria-pressed='true'\]\s*\{[^}]*inset 0 0 0 var\(--q-border-1\) var\(--q-border-accent-subtle\)/s);
    expect(canvasToolbarStyles).toMatch(/\.q-icon-button\[aria-pressed='true'\](?::hover|:active)[^{]*\{[^}]*background-color:\s*var\(--q-bg-accent-subtle\);/s);
  });

  it('labels paper styles through the existing settings translation namespace', () => {
    expect(translatePaperStyle('settings.editor.styles.ivory')).toBe('Ivory');
    expect(translatePaperStyle('editor.styles.ivory')).toBe('editor.styles.ivory');
    expect(canvasToolbarSource).toContain('settings.editor.styles.');
  });

  it('renders a shortcut badge and aria key shortcut on every tool button', () => {
    act(() => {
      renderer = mountDom(
        <CanvasToolbar
          activeTool="select"
          paperStyle="ivory"
          grid="none"
          canUndo
          canRedo={false}
          onToolChange={() => {}}
          onPaperStyleChange={() => {}}
          onGridChange={() => {}}
          onOpenSlash={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />,
      );
    });

    const expected: [string, string][] = [
      ['Select and move', 'V'],
      ['Text card', 'T'],
      ['File card', 'F'],
      ['Link card', 'L'],
      ['Group', 'G'],
      ['Connection', 'A'],
      ['Rectangle', 'R'],
      ['Diamond', 'D'],
      ['Ellipse', 'E'],
      ['Number marker', 'N'],
      ['Freehand', 'P'],
    ];
    for (const [label, shortcut] of expected) {
      const tool = renderer!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
      expect(tool.getAttribute('aria-keyshortcuts')).toBe(shortcut);
      expect(tool.title).toBe(`${label} (${shortcut})`);
      expect(tool.querySelector('kbd.q-canvas-toolbar__key')?.textContent).toBe(shortcut);
    }
  });

  it('draws the diamond tool as a rhombus outline instead of the lucide gem', () => {
    act(() => {
      renderer = mountDom(
        <CanvasToolbar
          activeTool="diamond"
          paperStyle="ivory"
          grid="none"
          canUndo
          canRedo={false}
          onToolChange={() => {}}
          onPaperStyleChange={() => {}}
          onGridChange={() => {}}
          onOpenSlash={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />,
      );
    });

    const diamond = renderer!.container.querySelector<HTMLButtonElement>('button[aria-label="Diamond"]')!;
    const path = diamond.querySelector('path');
    expect(path?.getAttribute('d')?.startsWith('M12 2.5')).toBe(true);
  });

  it('dispatches tool, paper, grid and history actions with accessible controls', async () => {
    const onToolChange = vi.fn();
    const onPaperStyleChange = vi.fn();
    const onGridChange = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onExportSvg = vi.fn();
    const onExportPng = vi.fn();
    const onAddNote = vi.fn();
    const onOpenSlash = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasToolbar
          activeTool="select"
          paperStyle="ivory"
          grid="none"
          canUndo
          canRedo={false}
          onToolChange={onToolChange}
          onPaperStyleChange={onPaperStyleChange}
          onGridChange={onGridChange}
          onOpenSlash={onOpenSlash}
          onUndo={onUndo}
          onRedo={onRedo}
          onAddNote={onAddNote}
          onExportSvg={onExportSvg}
          onExportPng={onExportPng}
        />,
      );
    });

    const button = (label: string) => renderer!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    await actAndSettle(() => button('Text card').click());
    await actAndSettle(() => button('Connection').click());
    await actAndSettle(() => button('Ellipse').click());
    await actAndSettle(() => button('Freehand').click());
    await actAndSettle(() => button('Find and add a note').click());
    await actAndSettle(() => renderer!.container.querySelector<HTMLButtonElement>('.q-canvas-toolbar__slash')!.click());
    const selects = renderer!.container.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    selects[0].value = 'sepia';
    await actAndSettle(() => { selects[0].dispatchEvent(new Event('change', { bubbles: true })); });
    selects[1].value = 'dots';
    await actAndSettle(() => { selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
    await actAndSettle(() => button('Undo').click());
    await actAndSettle(() => button('Export as SVG').click());
    await actAndSettle(() => button('Export as PNG').click());
    button('Redo').click();

    expect(onToolChange).toHaveBeenCalledWith('text');
    expect(onToolChange).toHaveBeenCalledWith('edge');
    expect(onToolChange).toHaveBeenCalledWith('ellipse');
    expect(onToolChange).toHaveBeenCalledWith('draw');
    expect(onAddNote).toHaveBeenCalledOnce();
    expect(onPaperStyleChange).toHaveBeenCalledWith('sepia');
    expect(onGridChange).toHaveBeenCalledWith('dots');
    expect(onOpenSlash).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).not.toHaveBeenCalled();
    expect(onExportSvg).toHaveBeenCalledOnce();
    expect(onExportPng).toHaveBeenCalledOnce();
    expect(button('Select and move').getAttribute('aria-pressed')).toBe('true');
    expect(button('Freehand').title).toBe('Freehand (P)');
    expect(button('Redo').disabled).toBe(true);
  });
});
