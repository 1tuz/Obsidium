// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasToolbar } from './CanvasToolbar';

describe('CanvasToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
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
    await actAndSettle(() => button('Find and add a note').click());
    const selects = renderer!.container.querySelectorAll('select');
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
    expect(onAddNote).toHaveBeenCalledOnce();
    expect(onPaperStyleChange).toHaveBeenCalledWith('sepia');
    expect(onGridChange).toHaveBeenCalledWith('dots');
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).not.toHaveBeenCalled();
    expect(onExportSvg).toHaveBeenCalledOnce();
    expect(onExportPng).toHaveBeenCalledOnce();
    expect(button('Select').getAttribute('aria-pressed')).toBe('true');
    expect(button('Redo').disabled).toBe(true);
  });
});
