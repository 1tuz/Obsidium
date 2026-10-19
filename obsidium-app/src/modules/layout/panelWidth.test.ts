import { describe, expect, it } from 'vitest';
import { PANEL_LIMITS, clampPanelWidth, resizePanel } from './panelWidth';

describe('clampPanelWidth', () => {
  it('falls back for non-finite values', () => {
    expect(clampPanelWidth('left', Number.NaN)).toBe(PANEL_LIMITS.left.fallback);
    expect(clampPanelWidth('left', Number.POSITIVE_INFINITY)).toBe(PANEL_LIMITS.left.fallback);
    expect(clampPanelWidth('right', Number.NEGATIVE_INFINITY)).toBe(PANEL_LIMITS.right.fallback);
  });

  it('rounds fractional widths', () => {
    expect(clampPanelWidth('left', 250.6)).toBe(251);
    expect(clampPanelWidth('right', 320.4)).toBe(320);
  });

  it('clamps to the configured bounds', () => {
    expect(clampPanelWidth('left', 10)).toBe(PANEL_LIMITS.left.min);
    expect(clampPanelWidth('left', 10_000)).toBe(PANEL_LIMITS.left.max);
    expect(clampPanelWidth('right', 10)).toBe(PANEL_LIMITS.right.min);
    expect(clampPanelWidth('right', 10_000)).toBe(PANEL_LIMITS.right.max);
  });
});

describe('resizePanel', () => {
  it('grows the left panel with a positive delta', () => {
    expect(resizePanel('left', 224, 40)).toBe(264);
    expect(resizePanel('left', 224, -40)).toBe(184);
  });

  it('grows the right panel with a negative delta', () => {
    expect(resizePanel('right', 320, -40)).toBe(360);
    expect(resizePanel('right', 320, 40)).toBe(280);
  });

  it('clamps the result to the panel bounds', () => {
    expect(resizePanel('left', 224, 10_000)).toBe(PANEL_LIMITS.left.max);
    expect(resizePanel('left', 224, -10_000)).toBe(PANEL_LIMITS.left.min);
    expect(resizePanel('right', 320, -10_000)).toBe(PANEL_LIMITS.right.max);
    expect(resizePanel('right', 320, 10_000)).toBe(PANEL_LIMITS.right.min);
  });
});
