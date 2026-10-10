import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import { FrameClock } from './frameClock';
import {
  DIMMED_STRENGTH,
  dimmedBy,
  highlightState,
  MIN_LAYOUT_SPACING,
  MIN_SPREAD,
  MAX_NODE_PIXELS,
  nodeRadiusPixels,
  nodeWorldRadius,
  SUB_PIXEL_RADIUS,
} from './nodeMetrics';

const FRAME = 1 / 60;
const ZOOM_IN = 1.2;
const ZOOM_OUT = 1 / 1.2;

afterEach(() => {
  vi.unstubAllGlobals();
});

function setMotionPreference(motion: 'on' | 'off' | 'system', reducedMotion: boolean): void {
  vi.stubGlobal('document', { documentElement: { dataset: { motion } } });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

function settle(camera: Camera): void {
  for (let step = 0; step < 400 && camera.advance(FRAME); step += 1) {
    continue;
  }
}

describe('Camera', () => {
  it('a factor below one zooms out and above one zooms in', () => {
    const outward = new Camera();
    const inward = new Camera();

    outward.zoomBy(ZOOM_OUT, 0, 0);
    settle(outward);
    inward.zoomBy(ZOOM_IN, 0, 0);
    settle(inward);

    expect(outward.scale).toBeLessThan(1);
    expect(inward.scale).toBeGreaterThan(1);
  });

  it('reaches the target zoom over several frames instead of jumping', () => {
    const camera = new Camera();

    camera.zoomBy(ZOOM_IN, 0, 0);
    camera.advance(FRAME);
    const afterOneFrame = camera.scale;
    settle(camera);

    expect(afterOneFrame).toBeGreaterThan(1);
    expect(afterOneFrame).toBeLessThan(camera.scale);
    expect(camera.advance(FRAME)).toBe(false);
  });

  it('lands at the same place whatever the frame rate is', () => {
    const smooth = new Camera();
    const stuttering = new Camera();

    smooth.zoomBy(4, 0, 0);
    stuttering.zoomBy(4, 0, 0);
    smooth.advance(FRAME);
    smooth.advance(FRAME);
    stuttering.advance(FRAME * 2);

    expect(stuttering.scale).toBeCloseTo(smooth.scale, 9);
  });

  it('keeps the world point under the cursor while zooming', () => {
    const camera = new Camera();
    const before = camera.toWorld(120, -80);

    camera.zoomBy(ZOOM_IN, 120, -80);
    settle(camera);
    const after = camera.toWorld(120, -80);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('panning follows the pointer', () => {
    const camera = new Camera();

    camera.panBy(10, 5);

    expect(camera.centerX).toBeLessThan(0);
    expect(camera.centerY).toBeGreaterThan(0);
  });

  it('animates target pans and retargets from the previous destination', () => {
    const camera = new Camera();

    camera.panToBy(60, 30);
    expect(camera.centerX).toBe(0);
    camera.advance(FRAME);
    const firstFrame = camera.centerX;
    camera.panToBy(60, 30);
    settle(camera);

    expect(firstFrame).toBeLessThan(0);
    expect(camera.centerX).toBeCloseTo(-120, 6);
    expect(camera.centerY).toBeCloseTo(60, 6);
  });

  it('keeps pointer panning immediate and cancels an unfinished target pan', () => {
    const camera = new Camera();

    camera.panToBy(100, 0);
    camera.panBy(10, 0);

    expect(camera.centerX).toBe(-10);
    expect(camera.advance(FRAME)).toBe(false);
  });

  it('panning while zooming keeps the zoom going', () => {
    const camera = new Camera();

    camera.zoomBy(4, 0, 0);
    camera.advance(FRAME);
    camera.panBy(40, 0);
    settle(camera);

    expect(camera.scale).toBeCloseTo(4, 6);
  });

  it('fits the graph into the viewport at once', () => {
    const camera = new Camera();

    camera.jumpTo({ minX: -10, maxX: 10, minY: -5, maxY: 5 }, 400, 200);

    expect(camera.centerX).toBe(0);
    expect(camera.centerY).toBe(0);
    expect(camera.scale).toBe(20);
    expect(camera.advance(FRAME)).toBe(false);
  });

  it('glides to the fitted view over several frames', () => {
    const camera = new Camera();
    camera.jumpTo({ minX: -10, maxX: 10, minY: -5, maxY: 5 }, 400, 200);
    camera.panBy(300, 300);

    camera.glideTo({ minX: -10, maxX: 10, minY: -5, maxY: 5 }, 400, 200);
    const moving = camera.advance(FRAME);
    settle(camera);

    expect(moving).toBe(true);
    expect(camera.centerX).toBeCloseTo(0, 6);
    expect(camera.centerY).toBeCloseTo(0, 6);
    expect(camera.scale).toBeCloseTo(20, 6);
  });

  it('finishes camera transitions at their exact target when motion is disabled', () => {
    const camera = new Camera();
    camera.zoomBy(3, 120, -80);
    camera.glideTo({ minX: -10, maxX: 10, minY: -5, maxY: 5 }, 400, 200);

    expect(camera.finish()).toBe(true);
    expect(camera.scale).toBe(20);
    expect(camera.centerX).toBe(0);
    expect(camera.centerY).toBe(0);
    expect(camera.advance(FRAME)).toBe(false);
  });

  it('preserves the zoom anchor when a disabled-motion transition finishes', () => {
    const camera = new Camera();
    const anchor = { x: 120, y: -80 };
    const world = camera.toWorld(anchor.x, anchor.y);

    camera.zoomBy(3, anchor.x, anchor.y);
    camera.finish();

    expect(camera.toWorld(anchor.x, anchor.y)).toEqual(world);
    expect(camera.scale).toBe(3);
  });
});

describe('camera target pan and motion preference', () => {
  it('animates wheel pan while motion is on', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    setMotionPreference('on', false);
    const camera = new Camera();
    const clock = new FrameClock();
    camera.panToBy(60, 0);
    clock.request((seconds, _time, animate) => animate && camera.advance(seconds));

    expect(camera.centerX).toBe(0);
    for (let time = 16; frames.length > 0 && time < 2_000; time += 16) {
      frames.shift()?.(time);
    }

    expect(camera.centerX).toBeCloseTo(-60, 6);
    clock.stop();
  });

  it.each(['off', 'system'] as const)('snaps wheel pan immediately with motion=%s and reduced motion', (motion) => {
    setMotionPreference(motion, true);
    const camera = new Camera();
    const clock = new FrameClock();
    camera.panToBy(60, 0);

    clock.request((_seconds, _time, animate) => animate && camera.advance(_seconds) || camera.finish());

    expect(camera.centerX).toBe(-60);
    clock.stop();
  });

  it('animates wheel pan in system mode when reduced motion is disabled', () => {
    const frames: FrameRequestCallback[] = [];
    setMotionPreference('system', false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const camera = new Camera();
    const clock = new FrameClock();
    camera.panToBy(60, 0);
    clock.request((seconds, _time, animate) => animate && camera.advance(seconds));

    expect(frames).toHaveLength(1);
    expect(camera.centerX).toBe(0);
    clock.stop();
  });
});

describe('node size', () => {
  it('shrinks when zooming out and grows when zooming in', () => {
    const far = nodeRadiusPixels(4, 1);
    const near = nodeRadiusPixels(4, 40);

    expect(far).toBeLessThan(near);
    expect(nodeRadiusPixels(4, 0.01)).toBe(SUB_PIXEL_RADIUS);
    expect(nodeRadiusPixels(4, 1_000_000)).toBe(MAX_NODE_PIXELS);
  });

  it('never lets a hub swallow its neighbours at any spread', () => {
    for (const spread of [MIN_SPREAD, 1, 2.5]) {
      const hub = nodeWorldRadius(10_000, 1, spread);

      expect(hub * 2).toBeLessThan(MIN_LAYOUT_SPACING * spread);
    }
  });

  it('never lets the size slider push nodes into each other', () => {
    for (const spread of [MIN_SPREAD, 1, 2.5]) {
      for (const sizeScale of [0.4, 1, 1.8, 2.5]) {
        const hub = nodeWorldRadius(10_000, sizeScale, spread);

        expect(hub * 2).toBeLessThan(MIN_LAYOUT_SPACING * spread);
      }
    }
  });

  it('lets the size slider grow a node until it fills the promised gap', () => {
    expect(nodeWorldRadius(0, 2.5)).toBeGreaterThan(nodeWorldRadius(0, 1) * 2);
    expect(nodeWorldRadius(0, 100)).toBe(nodeWorldRadius(10_000, 100));
  });

  it('lets a hub grow past the tightest spread once the graph is loose', () => {
    expect(nodeWorldRadius(10_000, 1, 1))
      .toBeGreaterThan(nodeWorldRadius(10_000, 1, MIN_SPREAD) * 1.5);
    expect(nodeWorldRadius(10_000, 1, 2.5)).toBeGreaterThan(nodeWorldRadius(10_000, 1, 1));
  });

  it('a linked note is drawn larger than an orphan', () => {
    expect(nodeWorldRadius(8)).toBeGreaterThan(nodeWorldRadius(0));
  });

  it('draws a note without links the size of a note with one', () => {
    expect(nodeWorldRadius(0)).toBe(nodeWorldRadius(1));
  });

  it('makes a hub three times the diameter of an orphan', () => {
    expect(nodeWorldRadius(10_000) / nodeWorldRadius(0)).toBeGreaterThan(3);
  });

  it('keeps an orphan large enough to read as a dot, not a speck', () => {
    expect(nodeRadiusPixels(0, 100)).toBeGreaterThan(8);
  });

  it('keeps ordinary hubs telling themselves apart from the biggest ones', () => {
    expect(nodeWorldRadius(60)).toBeLessThan(nodeWorldRadius(10_000));
  });

  it('stays proportional to zoom once the node is larger than a pixel', () => {
    const zooms = [5, 20, 60, 169, 400];
    const radii = zooms.map((scale) => nodeRadiusPixels(24, scale));

    for (let step = 1; step < radii.length; step += 1) {
      const growth = radii[step] / radii[step - 1];
      const expected = zooms[step] / zooms[step - 1];
      expect(growth).toBeCloseTo(expected, 4);
    }
  });
});

describe('dimming a graph around what the pointer found', () => {
  it('leaves everything alone while nothing is hovered', () => {
    expect(dimmedBy(0, 0)).toBe(1);
    expect(dimmedBy(1, 0)).toBe(1);
  });

  it('keeps the hovered note at full strength', () => {
    expect(highlightState(1)).toBe(1);
    expect(dimmedBy(highlightState(1), 1)).toBeCloseTo(1, 6);
  });

  it('pushes an unrelated note down to the dimmed strength', () => {
    expect(highlightState(0)).toBe(0);
    expect(dimmedBy(highlightState(0), 1)).toBeCloseTo(DIMMED_STRENGTH, 6);
  });

  it('fades neighbours further with every step away', () => {
    const first = dimmedBy(highlightState(2), 1);
    const second = dimmedBy(highlightState(3), 1);

    expect(first).toBeLessThan(1);
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(DIMMED_STRENGTH);
  });
});
