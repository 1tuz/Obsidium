import { describe, expect, it } from 'vitest';
import type { CanvasNode } from './model';
import { snapToGuides } from './guides';

const node = (x: number, y: number, width = 100, height = 100): CanvasNode => ({
  id: `${x}:${y}:${width}:${height}`,
  type: 'text',
  x,
  y,
  width,
  height,
  text: '',
});

describe('snapToGuides', () => {
  it('returns no snap when the empty set of others is given', () => {
    expect(snapToGuides({ x: 104, y: 104, width: 100, height: 100 }, [])).toEqual({
      offset: { x: 0, y: 0 },
      guides: [],
    });
  });

  it('returns no snap beyond the threshold', () => {
    const result = snapToGuides(
      { x: 100, y: 0, width: 100, height: 100 },
      [node(110, 1000)],
    );
    expect(result).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
  });

  it('returns no snap for a non-positive threshold', () => {
    const rect = { x: 104, y: 0, width: 100, height: 100 };
    const others = [node(100, 1000)];
    expect(snapToGuides(rect, others, 0)).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
    expect(snapToGuides(rect, others, -6)).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
  });

  it('snaps the left edge', () => {
    const result = snapToGuides(
      { x: 104, y: 0, width: 100, height: 100 },
      [node(100, 1000, 400)],
    );
    expect(result.offset).toEqual({ x: -4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 100 }]);
  });

  it('snaps the center', () => {
    const result = snapToGuides(
      { x: 146, y: 0, width: 100, height: 100 },
      [node(100, 1000, 200)],
    );
    expect(result.offset).toEqual({ x: 4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 200 }]);
  });

  it('snaps the right edge', () => {
    const result = snapToGuides(
      { x: 396, y: 0, width: 100, height: 100 },
      [node(100, 1000, 400)],
    );
    expect(result.offset).toEqual({ x: 4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 500 }]);
  });

  it('snaps the top edge', () => {
    const result = snapToGuides(
      { x: 0, y: 104, width: 100, height: 100 },
      [node(1000, 100, 400)],
    );
    expect(result.offset).toEqual({ x: 0, y: -4 });
    expect(result.guides).toEqual([{ axis: 'y', at: 100 }]);
  });

  it('snaps the middle', () => {
    const result = snapToGuides(
      { x: 0, y: 146, width: 100, height: 100 },
      [node(1000, 100, 200, 200)],
    );
    expect(result.offset).toEqual({ x: 0, y: 4 });
    expect(result.guides).toEqual([{ axis: 'y', at: 200 }]);
  });

  it('snaps the bottom edge', () => {
    const result = snapToGuides(
      { x: 0, y: 204, width: 100, height: 100 },
      [node(1000, 100, 400, 400)],
    );
    expect(result.offset).toEqual({ x: 0, y: -4 });
    expect(result.guides).toEqual([{ axis: 'y', at: 300 }]);
  });

  it('keeps the moving candidate with the smallest difference', () => {
    const result = snapToGuides(
      { x: 104, y: 0, width: 96, height: 100 },
      [node(100, 1000, 100)],
    );
    expect(result.offset).toEqual({ x: 0, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 200 }]);
  });

  it('prefers the left or top candidate on ties', () => {
    const result = snapToGuides(
      { x: 104, y: 0, width: 100, height: 100 },
      [node(100, 1000, 100)],
    );
    expect(result.offset).toEqual({ x: -4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 100 }]);
  });

  it('snaps both axes at once in x then y order', () => {
    const result = snapToGuides(
      { x: 104, y: 104, width: 100, height: 100 },
      [node(100, 100)],
    );
    expect(result.offset).toEqual({ x: -4, y: -4 });
    expect(result.guides).toEqual([
      { axis: 'x', at: 100 },
      { axis: 'y', at: 100 },
    ]);
  });

  it('honours a custom threshold', () => {
    const rect = { x: 104, y: 0, width: 100, height: 100 };
    const others = [node(100, 1000, 400)];
    expect(snapToGuides(rect, others, 3)).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
    expect(snapToGuides(rect, others, 4).offset).toEqual({ x: -4, y: 0 });
    expect(snapToGuides(rect, others, 5).offset).toEqual({ x: -4, y: 0 });
  });

  it('moves the rect onto the line with the correct sign', () => {
    const right = snapToGuides(
      { x: 104, y: 0, width: 100, height: 100 },
      [node(100, 1000, 400)],
    );
    expect(right.offset.x).toBe(-4);

    const left = snapToGuides(
      { x: 96, y: 0, width: 100, height: 100 },
      [node(100, 1000, 400)],
    );
    expect(left.offset.x).toBe(4);
    expect(left.guides).toEqual([{ axis: 'x', at: 100 }]);
  });

  it('uses each other node as a snap source', () => {
    const result = snapToGuides(
      { x: 304, y: 0, width: 100, height: 100 },
      [node(0, 1000, 100), node(300, 2000, 400)],
    );
    expect(result.offset).toEqual({ x: -4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 300 }]);
  });
});
