import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  canvasContentBounds,
  clampCanvasZoom,
  fitCanvasCamera,
  panCanvas,
  screenToCanvas,
  zoomCanvasAt,
  zoomCanvasAtCenter,
} from './viewport';

describe('clampCanvasZoom', () => {
  it('falls back to 1 for non-finite input', () => {
    expect(clampCanvasZoom(Number.NaN)).toBe(1);
    expect(clampCanvasZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampCanvasZoom(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it('clamps below and above the zoom range', () => {
    expect(clampCanvasZoom(0.01)).toBe(MIN_CANVAS_ZOOM);
    expect(clampCanvasZoom(10)).toBe(MAX_CANVAS_ZOOM);
    expect(clampCanvasZoom(1)).toBe(1);
  });
});

describe('zoomCanvasAt', () => {
  it('keeps the world point under the anchor fixed', () => {
    const camera = { x: 100, y: 50, zoom: 1 };
    const anchor = { x: 300, y: 200 };
    const next = zoomCanvasAt(camera, anchor, 2);
    expect(next).toEqual({ x: -100, y: -100, zoom: 2 });
    expect(screenToCanvas(next, anchor)).toEqual(screenToCanvas(camera, anchor));
  });

  it('clamps the resulting zoom while still anchoring the point', () => {
    const camera = { x: 10, y: 20, zoom: 2 };
    const anchor = { x: 400, y: 300 };
    const next = zoomCanvasAt(camera, anchor, 10);
    expect(next.zoom).toBe(MAX_CANVAS_ZOOM);
    expect(screenToCanvas(next, anchor)).toEqual(screenToCanvas(camera, anchor));
  });

  it('returns the same camera for a non-positive factor', () => {
    const camera = { x: 10, y: 20, zoom: 1 };
    expect(zoomCanvasAt(camera, { x: 0, y: 0 }, 0)).toBe(camera);
    expect(zoomCanvasAt(camera, { x: 0, y: 0 }, -2)).toBe(camera);
  });

  it('returns the same camera for a non-positive zoom', () => {
    const camera = { x: 10, y: 20, zoom: 0 };
    expect(zoomCanvasAt(camera, { x: 0, y: 0 }, 2)).toBe(camera);
  });

  it('round-trips screen and canvas coordinates', () => {
    const camera = { x: -40, y: 25, zoom: 1.5 };
    const screen = { x: 320, y: 240 };
    const next = zoomCanvasAt(camera, { x: 500, y: 400 }, 0.5);
    const world = screenToCanvas(next, screen);
    expect(screenToCanvas(next, { x: world.x * next.zoom + next.x, y: world.y * next.zoom + next.y }))
      .toEqual(world);
    expect(screenToCanvas(camera, { x: camera.x, y: camera.y })).toEqual({ x: 0, y: 0 });
  });
});

describe('zoomCanvasAtCenter', () => {
  it('zooms around the viewport center', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(zoomCanvasAtCenter(camera, { width: 800, height: 600 }, 2))
      .toEqual({ x: -400, y: -300, zoom: 2 });
  });
});

describe('panCanvas', () => {
  it('adds the delta without changing zoom', () => {
    const camera = { x: 10, y: -5, zoom: 1.25 };
    expect(panCanvas(camera, { x: 30, y: 15 })).toEqual({ x: 40, y: 10, zoom: 1.25 });
    expect(camera).toEqual({ x: 10, y: -5, zoom: 1.25 });
  });
});

describe('canvasContentBounds', () => {
  it('returns null for no nodes', () => {
    expect(canvasContentBounds([])).toBeNull();
  });

  it('computes bounds across negative coordinates', () => {
    expect(canvasContentBounds([
      { x: -50, y: -20, width: 100, height: 40 },
      { x: 20, y: 30, width: 10, height: 10 },
    ])).toEqual({ x: -50, y: -20, width: 100, height: 60 });
  });

  it('allows zero width and height', () => {
    expect(canvasContentBounds([{ x: 5, y: 7, width: 0, height: 0 }]))
      .toEqual({ x: 5, y: 7, width: 0, height: 0 });
  });
});

describe('fitCanvasCamera', () => {
  it('falls back to identity for missing or degenerate input', () => {
    expect(fitCanvasCamera(null, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitCanvasCamera({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 600 }))
      .toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitCanvasCamera({ x: 0, y: 0, width: 0, height: 10 }, { width: 800, height: 600 }))
      .toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('centers the content and caps zoom at 1', () => {
    const camera = fitCanvasCamera({ x: 100, y: 50, width: 200, height: 100 }, { width: 800, height: 600 });
    expect(camera).toEqual({ x: 200, y: 200, zoom: 1 });
    expect(camera.x + 100 * camera.zoom).toBe(300);
    expect(camera.y + 50 * camera.zoom).toBe(250);
  });

  it('scales down large content with padding', () => {
    const camera = fitCanvasCamera({ x: 0, y: 0, width: 2000, height: 1000 }, { width: 800, height: 600 });
    expect(camera.zoom).toBeCloseTo(0.352);
    expect(camera.x).toBeCloseTo(48);
    expect(camera.y).toBeCloseTo(124);
  });

  it('honors custom padding', () => {
    const camera = fitCanvasCamera({ x: 0, y: 0, width: 2000, height: 1000 }, { width: 800, height: 600 }, 0);
    expect(camera.zoom).toBe(0.4);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(100);
  });
});

describe('screenToCanvas', () => {
  it('divides by zoom and offsets by the camera', () => {
    expect(screenToCanvas({ x: 100, y: 50, zoom: 2 }, { x: 300, y: 150 }))
      .toEqual({ x: 100, y: 50 });
  });

  it('returns the point unchanged at zero zoom', () => {
    const point = { x: 12, y: 34 };
    expect(screenToCanvas({ x: 100, y: 50, zoom: 0 }, point)).toEqual(point);
  });
});
