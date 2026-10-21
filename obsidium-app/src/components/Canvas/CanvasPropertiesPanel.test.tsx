// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import type { CanvasAppearance } from '../../modules/canvas/nodeProps';
import { CanvasPropertiesPanel, type CanvasPanelTarget, type CanvasPropertiesPanelProps } from './CanvasPropertiesPanel';

const panelSource = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasPropertiesPanel.tsx'), 'utf8');
const panelStyles = readFileSync(resolve(process.cwd(), 'src/components/Canvas/CanvasPropertiesPanel.css'), 'utf8');

const NODE_APPEARANCE: CanvasAppearance = {
  strokeWidth: 2,
  strokeStyle: 'solid',
  corners: 'round',
  fontFamily: 'sans',
  fontSize: 'm',
  textAlign: 'left',
  opacity: 1,
  fill: null,
};

type Handlers = Pick<
  CanvasPropertiesPanelProps,
  'onAppearance' | 'onStroke' | 'onFill' | 'onFront' | 'onBack' | 'onDuplicate' | 'onCopy' | 'onPaste'
  | 'onGroup' | 'onUngroup' | 'onDelete' | 'onRoute' | 'onFromEnd' | 'onToEnd' | 'onLabel' | 'onClose'
>;

function createHandlers(): Handlers {
  return {
    onAppearance: vi.fn(),
    onStroke: vi.fn(),
    onFill: vi.fn(),
    onFront: vi.fn(),
    onBack: vi.fn(),
    onDuplicate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onDelete: vi.fn(),
    onRoute: vi.fn(),
    onFromEnd: vi.fn(),
    onToEnd: vi.fn(),
    onLabel: vi.fn(),
    onClose: vi.fn(),
  };
}

function buttonByLabel(scope: ParentNode, label: string): HTMLButtonElement {
  return scope.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

describe('CanvasPropertiesPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  const mount = async (target: CanvasPanelTarget, handlers: Handlers) => {
    await actAndSettle(() => {
      renderer = mountDom(<CanvasPropertiesPanel target={target} {...handlers} />);
    });
    return renderer!.container.querySelector('.q-canvas-properties') as HTMLElement;
  };

  const nodesTarget = (overrides: Partial<Extract<CanvasPanelTarget, { kind: 'nodes' }>> = {}): CanvasPanelTarget => ({
    kind: 'nodes',
    appearance: NODE_APPEARANCE,
    count: 1,
    canGroup: false,
    canUngroup: false,
    ...overrides,
  });

  it('paints only with design tokens', () => {
    expect(`${panelSource}\n${panelStyles}`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(`${panelSource}\n${panelStyles}`).not.toMatch(/\brgba?\(/i);
    expect(`${panelSource}\n${panelStyles}`).not.toMatch(/\bhsla?\(/i);
    expect(panelStyles).toMatch(/pointer-events:\s*auto/);
    expect(panelStyles).toMatch(/top:\s*calc\(var\(--q-space-52\)/);
    expect(panelStyles).toMatch(/bottom:\s*calc\(var\(--q-space-40\)/);
    expect(panelStyles).toMatch(/overflow-y:\s*auto/);
  });

  it('renders the node sections in order with the header', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget({ count: 3 }), handlers);

    expect(panel.getAttribute('data-target')).toBe('nodes');
    expect(panel.textContent).toContain(t('canvas.props.title'));
    expect(panel.textContent).toContain(t('canvas.selectionCount', { count: 3 }));

    const sections = [...panel.querySelectorAll('.q-canvas-properties__section')];
    const labels = sections
      .map((section) => section.querySelector('.q-canvas-properties__label')?.textContent)
      .filter((label): label is string => Boolean(label));

    expect(labels).toEqual([
      t('canvas.props.stroke'),
      t('canvas.props.background'),
      t('canvas.props.strokeWidth'),
      t('canvas.props.strokeStyle'),
      t('canvas.props.corners'),
      t('canvas.props.fontFamily'),
      t('canvas.props.fontSize'),
      t('canvas.props.textAlign'),
      t('canvas.props.opacity'),
      t('canvas.props.layers'),
      t('canvas.props.actions'),
    ]);

    expect(panel.querySelector('input[type="range"]')).not.toBeNull();
    expect(panel.querySelector('.q-canvas-properties__input')).toBeNull();
  });

  it('omits the count for a single selection and closes from the header', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget(), handlers);

    expect(panel.querySelector('.q-canvas-properties__count')).toBeNull();

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.close')).click());
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports stroke swatch picks, including the default swatch', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget({ stroke: '2' }), handlers);
    const swatches = [...panel.querySelectorAll<HTMLButtonElement>('.q-canvas-properties__section--stroke .q-canvas-properties__swatch')];

    expect(swatches).toHaveLength(7);
    expect(swatches.map((swatch) => swatch.getAttribute('aria-pressed'))).toEqual([
      'false', 'false', 'true', 'false', 'false', 'false', 'false',
    ]);
    expect(swatches[0].getAttribute('aria-label')).toBe(t('canvas.toolbar.color.default'));
    for (const swatch of swatches) {
      expect(swatch.getAttribute('type')).toBe('button');
    }

    await actAndSettle(() => swatches[3].click());
    expect(handlers.onStroke).toHaveBeenCalledWith('3');

    await actAndSettle(() => swatches[0].click());
    expect(handlers.onStroke).toHaveBeenCalledWith('');
  });

  it('reports fill swatch picks and marks the empty fill', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget({ appearance: { ...NODE_APPEARANCE, fill: null } }), handlers);
    const swatches = [...panel.querySelectorAll<HTMLButtonElement>('.q-canvas-properties__section--background .q-canvas-properties__swatch')];

    expect(swatches).toHaveLength(7);
    expect(swatches[0].getAttribute('aria-pressed')).toBe('true');
    expect(swatches[0].getAttribute('aria-label')).toBe(t('canvas.props.none'));

    await actAndSettle(() => swatches[5].click());
    expect(handlers.onFill).toHaveBeenCalledWith('5');

    await actAndSettle(() => swatches[0].click());
    expect(handlers.onFill).toHaveBeenCalledWith(null);
  });

  it('dispatches appearance patches from the toggles and the opacity slider', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget(), handlers);

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.width.4')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ strokeWidth: 4 });

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.style.dotted')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ strokeStyle: 'dotted' });

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.corner.sharp')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ corners: 'sharp' });

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.font.serif')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ fontFamily: 'serif' });

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.size.xl')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ fontSize: 'xl' });

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.align.right')).click());
    expect(handlers.onAppearance).toHaveBeenCalledWith({ textAlign: 'right' });

    const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.getAttribute('aria-label')).toBe(t('canvas.props.opacity'));
    expect(slider.value).toBe('100');
    slider.value = '50';
    await actAndSettle(() => { slider.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(handlers.onAppearance).toHaveBeenCalledWith({ opacity: 0.5 });
  });

  it('dispatches layer and action commands with group availability', async () => {
    const handlers = createHandlers();
    const panel = await mount(nodesTarget({ canGroup: true, canUngroup: false }), handlers);

    expect(buttonByLabel(panel, t('canvas.selection.group')).disabled).toBe(false);
    expect(buttonByLabel(panel, t('canvas.selection.ungroup')).disabled).toBe(true);

    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.front')).click());
    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.back')).click());
    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.duplicate')).click());
    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.group')).click());
    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.delete')).click());

    expect(handlers.onFront).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(handlers.onGroup).toHaveBeenCalledTimes(1);
    expect(handlers.onUngroup).not.toHaveBeenCalled();
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders edge controls and reports route, arrows, label and delete', async () => {
    const handlers = createHandlers();
    const panel = await mount({ kind: 'edge', route: 'elbow', fromEnd: 'none', toEnd: 'arrow', label: 'Draft' }, handlers);

    expect(panel.querySelector('.q-canvas-properties__section--route')).not.toBeNull();
    expect(panel.querySelector('.q-canvas-properties__section--stroke')).toBeNull();
    expect(buttonByLabel(panel, t('canvas.route.elbow')).getAttribute('aria-pressed')).toBe('true');
    expect(buttonByLabel(panel, t('canvas.route.straight')).getAttribute('aria-pressed')).toBe('false');

    await actAndSettle(() => buttonByLabel(panel, t('canvas.route.curved')).click());
    expect(handlers.onRoute).toHaveBeenCalledWith('curved');

    await actAndSettle(() => buttonByLabel(panel, t('canvas.edge.startArrow')).click());
    expect(handlers.onFromEnd).toHaveBeenCalledWith('arrow');
    expect(buttonByLabel(panel, t('canvas.edge.endArrow')).getAttribute('aria-pressed')).toBe('true');
    await actAndSettle(() => buttonByLabel(panel, t('canvas.edge.endArrow')).click());
    expect(handlers.onToEnd).toHaveBeenCalledWith('none');

    const input = panel.querySelector<HTMLInputElement>('.q-canvas-properties__input')!;
    expect(input.getAttribute('placeholder')).toBe(t('canvas.edgeLabel'));
    expect(input.value).toBe('Draft');
    input.value = 'Renamed';
    await actAndSettle(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(handlers.onLabel).toHaveBeenCalledWith('Renamed');

    await actAndSettle(() => buttonByLabel(panel, t('canvas.selection.delete')).click());
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);

    await actAndSettle(() => buttonByLabel(panel, t('canvas.props.close')).click());
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});