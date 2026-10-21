// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasMedia } from './CanvasMedia';
import { CanvasShape } from './CanvasShape';

describe('CanvasShape', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders a rectangle body with zoom-scaled stroke and no outline when unselected', () => {
    act(() => {
      renderer = mountDom(<CanvasShape shape="rectangle" width={200} height={100} zoom={2} selected={false} />);
    });
    const bodies = renderer!.container.querySelectorAll('.q-canvas__shape-body');
    expect(bodies).toHaveLength(1);
    const rect = bodies[0] as SVGRectElement;
    expect(rect.tagName.toLowerCase()).toBe('rect');
    expect(rect.getAttribute('x')).toBe('1');
    expect(rect.getAttribute('width')).toBe('198');
    expect(rect.getAttribute('rx')).toBe('10');
    expect(rect.getAttribute('stroke-width')).toBe('1');
    expect(rect.getAttribute('stroke')).toBeNull();
    expect(rect.getAttribute('fill')).toBeNull();
    expect(renderer!.container.querySelector('.q-canvas__shape-outline')).toBeNull();
  });

  it('renders diamond, ellipse and number geometry', () => {
    act(() => {
      renderer = mountDom(<CanvasShape shape="diamond" width={200} height={100} zoom={1} selected={false} />);
    });
    const polygon = renderer!.container.querySelector('polygon.q-canvas__shape-body')!;
    expect(polygon.getAttribute('points')).toBe('100,1 199,50 100,99 1,50');

    act(() => {
      renderer!.update(<CanvasShape shape="number" width={200} height={100} zoom={1} selected={false} />);
    });
    const ellipse = renderer!.container.querySelector('ellipse.q-canvas__shape-body')!;
    expect(ellipse.getAttribute('cx')).toBe('100');
    expect(ellipse.getAttribute('cy')).toBe('50');
    expect(ellipse.getAttribute('rx')).toBe('99');
    expect(ellipse.getAttribute('ry')).toBe('49');
  });

  it('adds a dashed outline and explicit colors when selected', () => {
    act(() => {
      renderer = mountDom(
        <CanvasShape shape="ellipse" width={120} height={80} zoom={2} selected stroke="#f00" fill="#00f" />,
      );
    });
    const body = renderer!.container.querySelector('.q-canvas__shape-body')!;
    expect(body.getAttribute('stroke')).toBe('#f00');
    expect(body.getAttribute('fill')).toBe('#00f');
    const outline = renderer!.container.querySelector('.q-canvas__shape-outline')!;
    expect(outline.getAttribute('fill')).toBe('none');
    expect(outline.getAttribute('stroke-width')).toBe('0.75');
    expect(outline.getAttribute('stroke-dasharray')).toBe('2 1.5');
    expect(outline.getAttribute('pointer-events')).toBe('none');
  });
});

describe('CanvasMedia', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows loading until the image loads', () => {
    act(() => {
      renderer = mountDom(<CanvasMedia kind="image" src="a.png" label="Diagram" />);
    });
    const media = renderer!.container.querySelector('.q-canvas-card__media')!;
    expect(media.getAttribute('data-state')).toBe('loading');
    expect(media.querySelector('.q-canvas-card__media-state')?.getAttribute('role')).toBe('status');
    const image = media.querySelector('img.q-canvas-card__media-image') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('a.png');
    expect(image.getAttribute('alt')).toBe('Diagram');
    expect(image.getAttribute('loading')).toBe('lazy');
    act(() => { image.dispatchEvent(new Event('load')); });
    expect(media.getAttribute('data-state')).toBe('ready');
    expect(media.querySelector('.q-canvas-card__media-state')).toBeNull();
  });

  it('shows the error message and hides the media element on failure', () => {
    act(() => {
      renderer = mountDom(<CanvasMedia kind="video" src="clip.mp4" label="Clip" />);
    });
    const video = renderer!.container.querySelector('video.q-canvas-card__media-video') as HTMLVideoElement;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.hasAttribute('autoplay')).toBe(false);
    act(() => { video.dispatchEvent(new Event('error')); });
    const media = renderer!.container.querySelector('.q-canvas-card__media')!;
    expect(media.getAttribute('data-state')).toBe('error');
    const error = media.querySelector('.q-canvas-card__media-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('Clip');
    expect((video as HTMLElement).style.visibility).toBe('hidden');
  });

  it('resets to loading when the source changes', () => {
    act(() => {
      renderer = mountDom(<CanvasMedia kind="image" src="a.png" label="Diagram" />);
    });
    const image = renderer!.container.querySelector('img') as HTMLImageElement;
    act(() => { image.dispatchEvent(new Event('load')); });
    const media = renderer!.container.querySelector('.q-canvas-card__media')!;
    expect(media.getAttribute('data-state')).toBe('ready');
    act(() => renderer!.update(<CanvasMedia kind="image" src="b.png" label="Diagram" />));
    expect(renderer!.container.querySelector('.q-canvas-card__media')!.getAttribute('data-state')).toBe('loading');
  });
});


