// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { colorInputValue, customEdgeColor, observePaletteChanges } from './palette';

describe('observePaletteChanges', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refreshes graph colors when the selected palette changes', async () => {
    const refresh = vi.fn();
    const observer = observePaletteChanges(document.documentElement, refresh);
    document.documentElement.dataset.palette = 'nord';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledOnce();
    observer.disconnect();
  });

  it('refreshes graph colors when the active accent token changes', async () => {
    const refresh = vi.fn();
    const observer = observePaletteChanges(document.documentElement, refresh);
    document.documentElement.style.setProperty('--q-blue-alpha-main', '#1471eb');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledOnce();
    observer.disconnect();
  });
});

describe('customEdgeColor', () => {
  it('converts valid picker colors to WebGL channels', () => {
    expect(customEdgeColor('#1471eb', [0, 0, 0, 1])).toEqual([20 / 255, 113 / 255, 235 / 255, 1]);
  });

  it('uses the current theme edge when stored color is missing or invalid', () => {
    const themeEdge = [0.2, 0.3, 0.4, 0.5] as [number, number, number, number];

    expect(customEdgeColor(null, themeEdge)).toBe(themeEdge);
    expect(customEdgeColor('#1471', themeEdge)).toBe(themeEdge);
  });

  it('formats the current theme edge for the native color picker', () => {
    expect(colorInputValue([20 / 255, 113 / 255, 235 / 255, 0.5])).toBe('#1471eb');
  });
});
