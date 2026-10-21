import { describe, expect, it } from 'vitest';
import type { CanvasTypedNode } from './model';
import {
  canvasAppearanceDefaults,
  canvasAppearanceStyle,
  canvasFontFamilyCss,
  canvasFontSizePixels,
  canvasStrokeDasharray,
  readCanvasAppearance,
  withCanvasAppearance,
} from './nodeProps';

const textNode = (obsidium?: Record<string, unknown>): CanvasTypedNode => ({
  id: 'n1',
  type: 'text',
  x: 0,
  y: 0,
  width: 120,
  height: 80,
  text: 'label',
  ...(obsidium ? { obsidium } : {}),
});

const shapeNode = (obsidium: Record<string, unknown> = {}): CanvasTypedNode =>
  textNode({ shape: 'rectangle', ...obsidium });

describe('canvas appearance', () => {
  it('centres text inside shapes and keeps plain text left aligned', () => {
    expect(canvasAppearanceDefaults(shapeNode()).textAlign).toBe('center');
    expect(canvasAppearanceDefaults(textNode()).textAlign).toBe('left');
  });

  it('reads stored values and clamps opacity', () => {
    const appearance = readCanvasAppearance(shapeNode({ strokeWidth: 4, strokeStyle: 'dotted', opacity: 2, fill: '3' }));
    expect(appearance).toMatchObject({ strokeWidth: 4, strokeStyle: 'dotted', opacity: 1, fill: '3' });
  });

  it('ignores values the schema does not know', () => {
    const appearance = readCanvasAppearance(shapeNode({ strokeWidth: 9, strokeStyle: 'wavy', fontSize: 'xxl', opacity: Number.NaN }));
    expect(appearance).toMatchObject({ strokeWidth: 2, strokeStyle: 'solid', fontSize: 'm', opacity: 1 });
  });

  it('writes only values that differ from the defaults and drops them again', () => {
    const painted = withCanvasAppearance(shapeNode(), { strokeWidth: 4, fill: '2', opacity: 0.5 });
    expect(painted.obsidium).toEqual({ shape: 'rectangle', strokeWidth: 4, fill: '2', opacity: 0.5 });
    const reset = withCanvasAppearance(painted, { strokeWidth: 2, fill: null, opacity: 1 });
    expect(reset.obsidium).toEqual({ shape: 'rectangle', fill: 'transparent' });
  });

  it('keeps unknown obsidium fields untouched', () => {
    const node = shapeNode({ custom: 'keep', opacity: 0.4 });
    expect(withCanvasAppearance(node, { fontSize: 'l' }).obsidium).toMatchObject({ custom: 'keep', opacity: 0.4, fontSize: 'l' });
  });

  it('maps stroke styles and font sizes to render values', () => {
    expect(canvasStrokeDasharray('solid', 2)).toBeUndefined();
    expect(canvasStrokeDasharray('dashed', 2)).toBe('8 6');
    expect(canvasStrokeDasharray('dotted', 1)).toBe('1 2');
    expect(canvasFontSizePixels('xl')).toBe(24);
    expect(canvasFontFamilyCss('mono')).toContain('mono');
  });

  it('exposes text styling through css custom properties', () => {
    const opaque = canvasAppearanceStyle(readCanvasAppearance(shapeNode()));
    expect(opaque).toEqual({
      '--q-canvas-font-size': '14px',
      '--q-canvas-font-family': canvasFontFamilyCss('sans'),
      '--q-canvas-text-align': 'center',
    });
  });

  it('keeps an explicit no-fill choice in the file', () => {
    expect(withCanvasAppearance(shapeNode(), { fill: '2' }).obsidium).toMatchObject({ fill: '2' });
    expect(withCanvasAppearance(shapeNode({ fill: '2' }), { fill: null }).obsidium).toMatchObject({ fill: 'transparent' });
  });
});
