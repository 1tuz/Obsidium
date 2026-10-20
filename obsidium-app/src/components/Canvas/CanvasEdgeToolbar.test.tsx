// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasEdgeToolbar, type CanvasEdgeToolbarProps } from './CanvasEdgeToolbar';

type ToolbarHandlers = Pick<
  CanvasEdgeToolbarProps,
  'onRouteChange' | 'onFromEndChange' | 'onToEndChange' | 'onLabelChange' | 'onDelete'
>;

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  return container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

describe('CanvasEdgeToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  const mount = (handlers: ToolbarHandlers, props: Partial<CanvasEdgeToolbarProps> = {}) => {
    act(() => {
      renderer = mountDom(
        <CanvasEdgeToolbar
          x={40}
          y={80}
          route="elbow"
          fromEnd="none"
          toEnd="none"
          label=""
          {...handlers}
          {...props}
        />,
      );
    });
    return renderer!.container.querySelector('.q-canvas__edge-toolbar') as HTMLElement;
  };

  it('renders the route buttons with the active route pressed', () => {
    const spies = {
      onRouteChange: vi.fn(),
      onFromEndChange: vi.fn(),
      onToEndChange: vi.fn(),
      onLabelChange: vi.fn(),
      onDelete: vi.fn(),
    };
    const toolbar = mount(spies, { route: 'elbow' });

    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe(t('canvas.edge.toolbar'));
    expect(toolbar.style.left).toBe('40px');
    expect(toolbar.style.top).toBe('80px');

    const straight = buttonByLabel(toolbar, t('canvas.route.straight'));
    const elbow = buttonByLabel(toolbar, t('canvas.route.elbow'));
    const curved = buttonByLabel(toolbar, t('canvas.route.curved'));

    expect(toolbar.querySelectorAll('button')).toHaveLength(6);
    expect(straight.getAttribute('aria-pressed')).toBe('false');
    expect(elbow.getAttribute('aria-pressed')).toBe('true');
    expect(curved.getAttribute('aria-pressed')).toBe('false');

    for (const button of [straight, elbow, curved]) {
      const glyph = button.querySelector('svg') as SVGSVGElement;
      expect(glyph.getAttribute('width')).toBe('16');
      expect(glyph.getAttribute('height')).toBe('10');
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
      expect(glyph.getAttribute('fill')).toBe('none');
      expect(glyph.getAttribute('stroke')).toBe('currentColor');
      expect(glyph.getAttribute('stroke-width')).toBe('1.5');
      expect(glyph.querySelector('path')?.getAttribute('d')).toBeTruthy();
    }

    act(() => curved.click());
    expect(spies.onRouteChange).toHaveBeenCalledTimes(1);
    expect(spies.onRouteChange).toHaveBeenCalledWith('curved');
  });

  it('reflects the arrow ends and toggles them', () => {
    const spies = {
      onRouteChange: vi.fn(),
      onFromEndChange: vi.fn(),
      onToEndChange: vi.fn(),
      onLabelChange: vi.fn(),
      onDelete: vi.fn(),
    };
    const toolbar = mount(spies, { fromEnd: 'arrow', toEnd: 'none' });

    const start = buttonByLabel(toolbar, t('canvas.edge.startArrow'));
    const end = buttonByLabel(toolbar, t('canvas.edge.endArrow'));

    expect(start.getAttribute('aria-pressed')).toBe('true');
    expect(end.getAttribute('aria-pressed')).toBe('false');
    expect(start.querySelector('polygon')).not.toBeNull();
    expect(end.querySelector('polygon')).not.toBeNull();

    act(() => start.click());
    expect(spies.onFromEndChange).toHaveBeenCalledTimes(1);
    expect(spies.onFromEndChange).toHaveBeenCalledWith('none');
    expect(spies.onToEndChange).not.toHaveBeenCalled();

    act(() => end.click());
    expect(spies.onToEndChange).toHaveBeenCalledTimes(1);
    expect(spies.onToEndChange).toHaveBeenCalledWith('arrow');
  });

  it('reports label edits from the input', () => {
    const spies = {
      onRouteChange: vi.fn(),
      onFromEndChange: vi.fn(),
      onToEndChange: vi.fn(),
      onLabelChange: vi.fn(),
      onDelete: vi.fn(),
    };
    const toolbar = mount(spies, { label: 'Related' });

    const input = toolbar.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe(t('canvas.edgeLabel'));
    expect(input.getAttribute('placeholder')).toBe(t('canvas.edgeLabel'));
    expect(input.value).toBe('Related');

    act(() => {
      input.value = 'Depends on';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(spies.onLabelChange).toHaveBeenCalledTimes(1);
    expect(spies.onLabelChange).toHaveBeenCalledWith('Depends on');
  });

  it('deletes the connection', () => {
    const spies = {
      onRouteChange: vi.fn(),
      onFromEndChange: vi.fn(),
      onToEndChange: vi.fn(),
      onLabelChange: vi.fn(),
      onDelete: vi.fn(),
    };
    const toolbar = mount(spies);

    const remove = buttonByLabel(toolbar, t('canvas.menu.delete'));
    expect(remove.querySelector('svg')?.getAttribute('data-icon-name')).toBe('trash2');

    act(() => remove.click());
    expect(spies.onDelete).toHaveBeenCalledTimes(1);
  });
});