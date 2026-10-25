import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushCanvasDocuments,
  forgetCanvasCamera,
  recalledCanvasCamera,
  registerCanvasFlush,
  rememberCanvasCamera,
} from './persistence';

describe('Canvas persistence', () => {
  const unregister: Array<() => void> = [];

  afterEach(() => {
    unregister.splice(0).forEach((dispose) => dispose());
  });

  it('waits for every open board before allowing the app to close', async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => false);
    unregister.push(registerCanvasFlush(first), registerCanvasFlush(second));

    await expect(flushCanvasDocuments()).resolves.toBe(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('Canvas camera memory', () => {
  const paths = ['board-a.canvas', 'board-b.canvas'];

  afterEach(() => {
    paths.forEach((path) => forgetCanvasCamera(path));
  });

  it('round-trips a remembered camera', () => {
    rememberCanvasCamera('board-a.canvas', { x: 12, y: -4, zoom: 1.5 });
    expect(recalledCanvasCamera('board-a.canvas')).toEqual({ x: 12, y: -4, zoom: 1.5 });
  });

  it('returns null for an unknown path', () => {
    expect(recalledCanvasCamera('board-a.canvas')).toBeNull();
  });

  it('returns null after the camera is forgotten', () => {
    rememberCanvasCamera('board-a.canvas', { x: 1, y: 2, zoom: 1 });
    forgetCanvasCamera('board-a.canvas');
    expect(recalledCanvasCamera('board-a.canvas')).toBeNull();
  });

  it('overwrites the camera on a second remember for the same path', () => {
    rememberCanvasCamera('board-a.canvas', { x: 1, y: 2, zoom: 1 });
    rememberCanvasCamera('board-a.canvas', { x: 40, y: 50, zoom: 2 });
    expect(recalledCanvasCamera('board-a.canvas')).toEqual({ x: 40, y: 50, zoom: 2 });
  });

  it('keeps the cached camera isolated from caller-side mutation', () => {
    const stored = { x: 3, y: 6, zoom: 1.25 };
    rememberCanvasCamera('board-a.canvas', stored);
    stored.x = 999;
    stored.y = 999;
    stored.zoom = 0.25;

    const recalled = recalledCanvasCamera('board-a.canvas');
    expect(recalled).toEqual({ x: 3, y: 6, zoom: 1.25 });
    if (!recalled) throw new Error('expected a remembered camera');

    recalled.x = -50;
    recalled.zoom = 2;
    expect(recalledCanvasCamera('board-a.canvas')).toEqual({ x: 3, y: 6, zoom: 1.25 });
  });

  it('keeps cache entries independent per path', () => {
    rememberCanvasCamera('board-a.canvas', { x: 1, y: 1, zoom: 1 });
    rememberCanvasCamera('board-b.canvas', { x: 2, y: 2, zoom: 2 });

    forgetCanvasCamera('board-a.canvas');
    expect(recalledCanvasCamera('board-a.canvas')).toBeNull();
    expect(recalledCanvasCamera('board-b.canvas')).toEqual({ x: 2, y: 2, zoom: 2 });
  });
});
