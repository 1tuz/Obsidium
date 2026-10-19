import { describe, expect, it } from 'vitest';
import { canvasFreehandPath } from './freehand';

describe('canvas freehand paths', () => {
  it('renders an empty path for an empty stroke', () => {
    expect(canvasFreehandPath([])).toBe('');
  });

  it('renders single and two point strokes', () => {
    expect(canvasFreehandPath([{ x: 10, y: 20 }])).toBe('M 10 20');
    expect(canvasFreehandPath([{ x: 10, y: 20 }, { x: 40, y: 50 }])).toBe('M 10 20 L 40 50');
  });

  it('renders a collinear three point stroke with a midpoint control', () => {
    expect(canvasFreehandPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]))
      .toBe('M 0 0 Q 10 10 15 15 L 20 20');
    expect(canvasFreehandPath([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]))
      .toBe('M 0 0 Q 1 1 1.5 1.5 L 2 2');
  });

  it('renders a four point curve through consecutive midpoints', () => {
    expect(canvasFreehandPath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 60, y: 50 },
    ])).toBe('M 0 0 Q 10 20 20 30 Q 30 40 45 45 L 60 50');
  });
});
