import { describe, expect, it } from 'vitest';
import { canvasNodeStyle, canvasPixels } from './renderStyle';

describe('canvasNodeStyle', () => {
  it('emits pixel units because the browser rejects unitless CSS lengths', () => {
    const style = canvasNodeStyle({ x: 120, y: -40, width: 160, height: 100 }, 3);
    expect(style).toEqual({ left: '120px', top: '-40px', width: '160px', height: '100px', zIndex: 3 });
  });

  it('keeps fractional coordinates that existing boards may contain', () => {
    const style = canvasNodeStyle({ x: 12.5, y: 8.25, width: 100.5, height: 80.75 }, 1);
    expect(style.left).toBe('12.5px');
    expect(style.width).toBe('100.5px');
  });

  it('formats overlay offsets with pixels as well', () => {
    expect(canvasPixels(0)).toBe('0px');
    expect(canvasPixels(41.5)).toBe('41.5px');
  });
});
