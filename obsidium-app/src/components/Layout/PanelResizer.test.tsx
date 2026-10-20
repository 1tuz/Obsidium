// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { PANEL_LIMITS } from '../../modules/layout/panelWidth';
import { mountDom } from '../../testing/mountDom';
import { PanelResizer } from './PanelResizer';

function pointer(target: Element, type: string, clientX: number, button = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function keydown(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('PanelResizer', () => {
  it('exposes separator semantics and panel limits', () => {
    const resizer = mountDom(
      <PanelResizer
        side="left"
        width={224}
        onResize={() => {}}
        onReset={() => {}}
        label="Resize the file panel"
      />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-label')).toBe('Resize the file panel');
    expect(separator.getAttribute('aria-valuenow')).toBe('224');
    expect(separator.getAttribute('aria-valuemin')).toBe(String(PANEL_LIMITS.left.min));
    expect(separator.getAttribute('aria-valuemax')).toBe(String(PANEL_LIMITS.left.max));
    expect(separator.classList.contains('q-panel-resizer')).toBe(true);
    expect(separator.classList.contains('q-panel-resizer--left')).toBe(true);
    expect(separator.getAttribute('tabindex')).toBe('0');
    act(() => resizer.unmount());
  });

  it('resizes the left panel while dragging', () => {
    const onResize = vi.fn();
    const resizer = mountDom(
      <PanelResizer side="left" width={224} onResize={onResize} onReset={() => {}} label="left" />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    pointer(separator, 'pointerdown', 300);
    pointer(separator, 'pointermove', 350);
    expect(onResize).toHaveBeenLastCalledWith(274);

    pointer(separator, 'pointermove', 10_000);
    expect(onResize).toHaveBeenLastCalledWith(PANEL_LIMITS.left.max);

    pointer(separator, 'pointerup', 10_000);
    const calls = onResize.mock.calls.length;
    pointer(separator, 'pointermove', 320);
    expect(onResize).toHaveBeenCalledTimes(calls);
    act(() => resizer.unmount());
  });

  it('resizes the right panel in the opposite direction', () => {
    const onResize = vi.fn();
    const resizer = mountDom(
      <PanelResizer side="right" width={320} onResize={onResize} onReset={() => {}} label="right" />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    pointer(separator, 'pointerdown', 500);
    pointer(separator, 'pointermove', 450);
    expect(onResize).toHaveBeenLastCalledWith(370);

    pointer(separator, 'pointermove', 0);
    expect(onResize).toHaveBeenLastCalledWith(PANEL_LIMITS.right.max);
    act(() => resizer.unmount());
  });

  it('ignores non-primary pointer buttons', () => {
    const onResize = vi.fn();
    const resizer = mountDom(
      <PanelResizer side="left" width={224} onResize={onResize} onReset={() => {}} label="left" />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    pointer(separator, 'pointerdown', 300, 1);
    pointer(separator, 'pointermove', 400);
    expect(onResize).not.toHaveBeenCalled();
    act(() => resizer.unmount());
  });

  it('resizes with arrow keys and jumps to the bounds', () => {
    const onResize = vi.fn();
    const resizer = mountDom(
      <PanelResizer side="left" width={224} onResize={onResize} onReset={() => {}} label="left" />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    expect(keydown(separator, 'ArrowRight').defaultPrevented).toBe(true);
    expect(onResize).toHaveBeenLastCalledWith(240);

    expect(keydown(separator, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(onResize).toHaveBeenLastCalledWith(208);

    expect(keydown(separator, 'Home').defaultPrevented).toBe(true);
    expect(onResize).toHaveBeenLastCalledWith(PANEL_LIMITS.left.min);

    expect(keydown(separator, 'End').defaultPrevented).toBe(true);
    expect(onResize).toHaveBeenLastCalledWith(PANEL_LIMITS.left.max);

    expect(keydown(separator, 'Enter').defaultPrevented).toBe(false);
    act(() => resizer.unmount());
  });

  it('resets on double click', () => {
    const onReset = vi.fn();
    const resizer = mountDom(
      <PanelResizer side="right" width={400} onResize={() => {}} onReset={onReset} label="right" />,
    );
    const separator = resizer.container.querySelector('[role="separator"]')!;

    act(() => {
      separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onReset).toHaveBeenCalledOnce();
    act(() => resizer.unmount());
  });
});
