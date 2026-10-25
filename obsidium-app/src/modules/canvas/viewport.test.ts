import { describe, expect, it } from 'vitest';
import {
  CANVAS_PAN_PADDING_PX,
  CANVAS_VIEW_MARGIN_PX,
  CANVAS_ZOOM_LEVELS,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  canvasContentBounds,
  canvasNodeVisible,
  canvasVisibleBounds,
  clampCanvasCamera,
  clampCanvasZoom,
  fitCanvasCamera,
  nextCanvasZoom,
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

describe('nextCanvasZoom', () => {
  it('steps up through every level and stops at the maximum', () => {
    const visited = [MIN_CANVAS_ZOOM];
    let zoom = MIN_CANVAS_ZOOM;
    while (zoom < MAX_CANVAS_ZOOM) {
      zoom = nextCanvasZoom(zoom, 1);
      visited.push(zoom);
    }
    expect(visited).toEqual([...CANVAS_ZOOM_LEVELS]);
    expect(nextCanvasZoom(MAX_CANVAS_ZOOM, 1)).toBe(MAX_CANVAS_ZOOM);
    expect(nextCanvasZoom(MAX_CANVAS_ZOOM + 5, 1)).toBe(MAX_CANVAS_ZOOM);
  });

  it('steps down through every level and stops at the minimum', () => {
    const visited = [MAX_CANVAS_ZOOM];
    let zoom = MAX_CANVAS_ZOOM;
    while (zoom > MIN_CANVAS_ZOOM) {
      zoom = nextCanvasZoom(zoom, -1);
      visited.push(zoom);
    }
    expect(visited).toEqual([...CANVAS_ZOOM_LEVELS].reverse());
    expect(nextCanvasZoom(MIN_CANVAS_ZOOM, -1)).toBe(MIN_CANVAS_ZOOM);
    expect(nextCanvasZoom(MIN_CANVAS_ZOOM - 5, -1)).toBe(MIN_CANVAS_ZOOM);
  });

  it('moves off a level strictly in the requested direction', () => {
    expect(nextCanvasZoom(1, 1)).toBe(1.5);
    expect(nextCanvasZoom(1, -1)).toBe(0.5);
    expect(nextCanvasZoom(1.5, 1)).toBe(2);
    expect(nextCanvasZoom(1.5, -1)).toBe(1);
    expect(nextCanvasZoom(0.5, 1)).toBe(1);
    expect(nextCanvasZoom(0.5, -1)).toBe(MIN_CANVAS_ZOOM);
  });

  it('snaps between levels from an in-between zoom', () => {
    expect(nextCanvasZoom(1.37, 1)).toBe(1.5);
    expect(nextCanvasZoom(1.37, -1)).toBe(1);
    expect(nextCanvasZoom(0.3, 1)).toBe(0.5);
    expect(nextCanvasZoom(0.3, -1)).toBe(MIN_CANVAS_ZOOM);
  });

  it('treats a zoom within epsilon of a level as that level', () => {
    expect(nextCanvasZoom(1 + 1e-9, 1)).toBe(1.5);
    expect(nextCanvasZoom(1 - 1e-9, -1)).toBe(0.5);
  });

  it('falls back to 1 for non-finite zoom', () => {
    expect(nextCanvasZoom(Number.NaN, 1)).toBe(1);
    expect(nextCanvasZoom(Number.NaN, -1)).toBe(1);
    expect(nextCanvasZoom(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(nextCanvasZoom(Number.NEGATIVE_INFINITY, -1)).toBe(1);
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

describe('canvasVisibleBounds', () => {
  it('maps the viewport into world space', () => {
    const bounds = canvasVisibleBounds(
      { x: 100, y: 50, zoom: 2 },
      { width: 800, height: 600 },
    );
    expect(bounds).toEqual({ x: -50, y: -25, width: 400, height: 300 });
  });

  it('defaults to no margin', () => {
    const camera = { x: -40, y: 25, zoom: 1.5 };
    const viewport = { width: 900, height: 700 };
    expect(canvasVisibleBounds(camera, viewport, 0)).toEqual(canvasVisibleBounds(camera, viewport));
  });

  it('inflates the rect by the margin on all sides', () => {
    const bounds = canvasVisibleBounds(
      { x: 100, y: 50, zoom: 2 },
      { width: 800, height: 600 },
      CANVAS_VIEW_MARGIN_PX,
    );
    expect(bounds).toEqual({
      x: -50 - CANVAS_VIEW_MARGIN_PX,
      y: -25 - CANVAS_VIEW_MARGIN_PX,
      width: 400 + 2 * CANVAS_VIEW_MARGIN_PX,
      height: 300 + 2 * CANVAS_VIEW_MARGIN_PX,
    });
  });

  it('returns null for a degenerate viewport or zoom', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(canvasVisibleBounds(camera, { width: 0, height: 600 })).toBeNull();
    expect(canvasVisibleBounds(camera, { width: 800, height: 0 })).toBeNull();
    expect(canvasVisibleBounds({ x: 0, y: 0, zoom: 0 }, { width: 800, height: 600 })).toBeNull();
  });
});

describe('canvasNodeVisible', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 };

  it('accepts nodes inside the bounds', () => {
    expect(canvasNodeVisible({ x: 10, y: 10, width: 20, height: 20 }, bounds)).toBe(true);
    expect(canvasNodeVisible({ x: 0, y: 0, width: 100, height: 100 }, bounds)).toBe(true);
  });

  it('rejects nodes fully outside the bounds', () => {
    expect(canvasNodeVisible({ x: 101, y: 10, width: 20, height: 20 }, bounds)).toBe(false);
    expect(canvasNodeVisible({ x: -30, y: 10, width: 20, height: 20 }, bounds)).toBe(false);
    expect(canvasNodeVisible({ x: 10, y: 101, width: 20, height: 20 }, bounds)).toBe(false);
    expect(canvasNodeVisible({ x: 10, y: -30, width: 20, height: 20 }, bounds)).toBe(false);
  });

  it('treats touching edges as visible', () => {
    expect(canvasNodeVisible({ x: 100, y: 10, width: 20, height: 20 }, bounds)).toBe(true);
    expect(canvasNodeVisible({ x: -20, y: 10, width: 20, height: 20 }, bounds)).toBe(true);
    expect(canvasNodeVisible({ x: 10, y: 100, width: 20, height: 20 }, bounds)).toBe(true);
    expect(canvasNodeVisible({ x: 10, y: -20, width: 20, height: 20 }, bounds)).toBe(true);
  });
});

describe('clampCanvasCamera', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const viewport = { width: 800, height: 600 };

  it('returns the camera unchanged for missing bounds', () => {
    const camera = { x: 99999, y: -99999, zoom: 1 };
    expect(clampCanvasCamera(camera, null, viewport)).toBe(camera);
  });

  it('returns the camera unchanged for an unmeasured viewport', () => {
    const camera = { x: 99999, y: -99999, zoom: 1 };
    expect(clampCanvasCamera(camera, bounds, { width: 0, height: 600 })).toBe(camera);
    expect(clampCanvasCamera(camera, bounds, { width: 800, height: 0 })).toBe(camera);
  });

  it('returns the camera unchanged for a non-positive zoom', () => {
    const camera = { x: 99999, y: -99999, zoom: 0 };
    expect(clampCanvasCamera(camera, bounds, viewport)).toBe(camera);
  });

  it('clamps a far pan to the padded boundary', () => {
    expect(clampCanvasCamera({ x: 100000, y: -100000, zoom: 1 }, bounds, viewport))
      .toEqual({
        x: CANVAS_PAN_PADDING_PX,
        y: -(bounds.height + CANVAS_PAN_PADDING_PX - viewport.height),
        zoom: 1,
      });
    expect(clampCanvasCamera({ x: -100000, y: 100000, zoom: 1 }, bounds, viewport))
      .toEqual({
        x: -(bounds.width + CANVAS_PAN_PADDING_PX - viewport.width),
        y: CANVAS_PAN_PADDING_PX,
        zoom: 1,
      });
  });

  it('keeps a camera already inside the padded range', () => {
    const camera = { x: 12, y: -34, zoom: 1 };
    expect(clampCanvasCamera(camera, bounds, viewport)).toEqual(camera);
  });

  it('centers content smaller than the viewport', () => {
    const small = { x: 0, y: 0, width: 200, height: 100 };
    expect(clampCanvasCamera({ x: 100000, y: -100000, zoom: 1 }, small, viewport))
      .toEqual({
        x: viewport.width / 2 - (small.x + small.width / 2),
        y: viewport.height / 2 - (small.y + small.height / 2),
        zoom: 1,
      });
  });

  it('centers content smaller than the viewport at any zoom', () => {
    const zoom = 0.5;
    expect(clampCanvasCamera({ x: 100000, y: -100000, zoom }, bounds, viewport))
      .toEqual({
        x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      });
  });

  it('honors custom padding', () => {
    const padding = 40;
    expect(clampCanvasCamera({ x: 100000, y: -100000, zoom: 1 }, bounds, viewport, padding))
      .toEqual({
        x: padding,
        y: -(bounds.height + padding - viewport.height),
        zoom: 1,
      });
  });

  it('never produces non-finite camera coordinates', () => {
    const camera = clampCanvasCamera({ x: Number.NaN, y: Number.NaN, zoom: 1 }, bounds, viewport);
    expect(Number.isFinite(camera.x)).toBe(true);
    expect(Number.isFinite(camera.y)).toBe(true);
    expect(camera.zoom).toBe(1);
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
