import { describe, expect, it } from 'vitest';
import { paneLeaves, removePane, setSplitRatio, splitPane } from './layout';
import type { PaneLayout } from '../ui-state/types';

const main: PaneLayout = { kind: 'pane', paneId: 'main', activeTabId: 'tab-a' };
const other: PaneLayout = { kind: 'pane', paneId: 'other', activeTabId: null };

describe('pane layout', () => {
  it('enumerates nested panes in visual order', () => {
    const layout = splitPane(splitPane(main, 'main', other, 'horizontal'), 'other', {
      kind: 'pane', paneId: 'bottom', activeTabId: 'tab-b',
    }, 'vertical');
    expect(paneLeaves(layout).map((pane) => pane.paneId)).toEqual(['main', 'other', 'bottom']);
    expect(main.activeTabId).toBe('tab-a');
  });

  it('preserves the selected pane and adds a half-sized sibling', () => {
    expect(splitPane(main, 'main', other, 'horizontal')).toEqual({
      kind: 'split', direction: 'horizontal', ratio: 0.5, children: [main, other],
    });
  });

  it('ignores missing targets and duplicate pane identities', () => {
    expect(splitPane(main, 'missing', other, 'horizontal')).toBe(main);
    expect(splitPane(main, 'main', main, 'vertical')).toBe(main);
  });

  it('collapses only the removed pane parent and preserves its sibling', () => {
    const inner = splitPane(other, 'other', {
      kind: 'pane', paneId: 'bottom', activeTabId: null,
    }, 'vertical');
    const layout: PaneLayout = { kind: 'split', direction: 'horizontal', ratio: 0.3, children: [main, inner] };
    expect(removePane(layout, 'other')).toEqual({
      ...layout, children: [main, { kind: 'pane', paneId: 'bottom', activeTabId: null }],
    });
    expect(removePane(layout, 'main')).toBe(inner);
  });

  it('cannot remove the final pane and leaves missing targets unchanged', () => {
    expect(removePane(main, 'main')).toBe(main);
    const layout = splitPane(main, 'main', other, 'horizontal');
    expect(removePane(layout, 'missing')).toBe(layout);
  });

  it('updates nested split ratios without mutating the original tree', () => {
    const inner = splitPane(other, 'other', {
      kind: 'pane', paneId: 'bottom', activeTabId: null,
    }, 'vertical');
    const layout: PaneLayout = { kind: 'split', direction: 'horizontal', ratio: 0.5, children: [main, inner] };
    const updated = setSplitRatio(layout, [1], 0.7);
    expect(updated).toEqual({ ...layout, children: [main, { ...inner, ratio: 0.7 }] });
    expect(updated).not.toBe(layout);
    expect(inner.kind === 'split' && inner.ratio).toBe(0.5);
  });

  it('clamps ratios and rejects invalid paths or non-finite values', () => {
    const layout = splitPane(main, 'main', other, 'horizontal');
    expect(setSplitRatio(layout, [], -1)).toEqual({ ...layout, ratio: 0.1 });
    expect(setSplitRatio(layout, [], 2)).toEqual({ ...layout, ratio: 0.9 });
    expect(setSplitRatio(layout, [0], 0.6)).toBe(layout);
    expect(setSplitRatio(layout, [2], 0.6)).toBe(layout);
    expect(setSplitRatio(layout, [], Number.NaN)).toBe(layout);
    expect(setSplitRatio(layout, [], Infinity)).toBe(layout);
  });
});
