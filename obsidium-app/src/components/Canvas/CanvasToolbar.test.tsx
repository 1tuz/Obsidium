// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasToolbar } from './CanvasToolbar';

const canvasStyles = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasView.css'), 'utf8');

describe('CanvasToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('uses the canvas ink token for tool icons on paper surfaces', () => {
    expect(canvasStyles).toMatch(/\.q-canvas\[data-paper-style\]\s*\{[^}]*--q-icon-button-icon:\s*var\(--q-canvas-ink\);/s);
    expect(canvasStyles).toMatch(/--q-canvas-grid-line:\s*color-mix\(in srgb, var\(--q-canvas-ink\) 26%, var\(--q-canvas-paper\)\)/);
    expect(canvasStyles).toMatch(/\.q-canvas__stage--lines\s*\{[^}]*var\(--q-canvas-grid-line/);
    expect(canvasStyles).toMatch(/\.q-canvas__object--rectangle[^}]*border-width:\s*var\(--q-canvas-shape-stroke-width/s);
  });

  it('dispatches tool, paper, grid and history actions with accessible controls', async () => {
    const onToolChange = vi.fn();
    const onPaperStyleChange = vi.fn();
    const onGridChange = vi.fn();
    const onColorChange = vi.fn();
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
          color=""
          paperStyle="ivory"
          grid="none"
          canUndo
          canRedo={false}
          onToolChange={onToolChange}
          onPaperStyleChange={onPaperStyleChange}
          onGridChange={onGridChange}
          onColorChange={onColorChange}
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
    selects[0].value = 'sepia';
    await actAndSettle(() => { selects[0].dispatchEvent(new Event('change', { bubbles: true })); });
    selects[1].value = 'dots';
    await actAndSettle(() => { selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
    selects[2].value = '4';
    await actAndSettle(() => { selects[2].dispatchEvent(new Event('change', { bubbles: true })); });
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
    expect(onColorChange).toHaveBeenCalledWith('4');
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
