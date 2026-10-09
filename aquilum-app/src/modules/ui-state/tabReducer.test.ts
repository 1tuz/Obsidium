import { describe, expect, it } from 'vitest';
import { tabsReducer, type TabsState } from './tabReducer';
import { emptyTabPath, GRAPH_TAB_PATH, type PaneLayout, type SessionTab } from './types';

function empty(id: string): SessionTab {
  return { tabId: id, documentId: null, kind: 'empty', path: emptyTabPath(id), paneId: 'main' };
}

function graph(id: string): SessionTab {
  return { tabId: id, documentId: null, kind: 'graph', path: GRAPH_TAB_PATH, paneId: 'main' };
}

describe('tabsReducer', () => {
  it('atomically selects and replaces tabs without mutating the previous state', () => {
    const initial: TabsState = { tabs: [empty('one')], activeTabId: 'one', layout: pane('main', 'one') };
    const next = tabsReducer(initial, { type: 'open-file', path: 'note.md', tabId: 'unused' });
    expect(next.tabs).toEqual([expect.objectContaining({
      tabId: 'one', documentId: null, kind: 'document', path: 'note.md',
    })]);
    expect(next.activeTabId).toBe('one');
    expect(initial.tabs[0].kind).toBe('empty');
  });

  it('opens the graph in its own tab and never opens a second one', () => {
    const initial: TabsState = { tabs: [empty('one')], activeTabId: 'one', layout: pane('main', 'one') };

    const opened = tabsReducer(initial, { type: 'open-graph', tab: graph('two') });
    const reopened = tabsReducer(
      { ...opened, activeTabId: 'one' },
      { type: 'open-graph', tab: graph('three') },
    );

    expect(opened.tabs.map((tab) => tab.kind)).toEqual(['empty', 'graph']);
    expect(opened.activeTabId).toBe('two');
    expect(reopened.tabs).toEqual(opened.tabs);
    expect(reopened.activeTabId).toBe('two');
  });

  it('closes the graph tab like any other', () => {
    const state: TabsState = { tabs: [empty('one'), graph('two')], activeTabId: 'two', layout: pane('main', 'two') };

    const next = tabsReducer(state, { type: 'close', path: GRAPH_TAB_PATH, fallback: empty('x') });

    expect(next.tabs.map((tab) => tab.tabId)).toEqual(['one']);
    expect(next.activeTabId).toBe('one');
  });

  it('is deterministic when React evaluates the same action twice', () => {
    const initial: TabsState = { tabs: [empty('one')], activeTabId: 'one', layout: pane('main', 'one') };
    const action = { type: 'new-tab', tab: empty('two') } as const;
    expect(tabsReducer(initial, action)).toEqual(tabsReducer(initial, action));
  });

  it('clears documentId when the active tab is reused for another file', () => {
    const state: TabsState = {
      tabs: [{ tabId: 'one', documentId: 'doc-a', kind: 'document', paneId: 'main', path: 'a.md' }],
      activeTabId: 'one', layout: pane('main', 'one'),
    };
    const next = tabsReducer(state, { type: 'open-file', path: 'b.md', tabId: 'unused' });
    expect(next.tabs).toEqual([expect.objectContaining({
      tabId: 'one', documentId: null, kind: 'document', paneId: 'main', path: 'b.md',
    })]);
    expect(next.activeTabId).toBe('one');
  });

  it('keeps the mount key when a tab is renamed and renews it for another file', () => {
    const state: TabsState = {
      tabs: [{
        tabId: 'one', documentId: 'doc-a', kind: 'document', paneId: 'main', path: 'a.md', mountKey: 'mount-a',
      }],
      activeTabId: 'one', layout: pane('main', 'one'),
    };
    const renamed = tabsReducer(state, { type: 'rename', oldPath: 'a.md', newPath: 'b.md' });
    expect(renamed.tabs[0].mountKey).toBe('mount-a');

    const reused = tabsReducer(state, { type: 'open-file', path: 'c.md', tabId: 'unused' });
    expect(reused.tabs[0].mountKey).not.toBe('mount-a');
  });

  it('opens a search result in a separate tab when requested', () => {
    const initial: TabsState = { tabs: [empty('one')], activeTabId: 'one', layout: pane('main', 'one') };
    const next = tabsReducer(initial, {
      type: 'open-file-new-tab',
      path: 'result.md',
      tabId: 'result-tab',
    });
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1]).toEqual(expect.objectContaining({
      tabId: 'result-tab',
      path: 'result.md',
    }));
    expect(next.activeTabId).toBe('result-tab');
  });

  it('keeps the identity source when a pending document is renamed', () => {
    const state: TabsState = {
      tabs: [{ tabId: 'one', documentId: null, kind: 'document', paneId: 'main', path: 'old.md' }],
      activeTabId: 'one', layout: pane('main', 'one'),
    };
    const next = tabsReducer(state, { type: 'rename', oldPath: 'old.md', newPath: 'new.md' });
    expect(next.tabs[0]).toEqual(expect.objectContaining({
      path: 'new.md',
      identityPath: 'old.md',
    }));
  });
  it('moves a tab to a new position and keeps the active one', () => {
    const state: TabsState = {
      tabs: [
        { tabId: 'one', documentId: null, kind: 'document', paneId: 'main', path: 'a.md' },
        { tabId: 'two', documentId: null, kind: 'document', paneId: 'main', path: 'b.md' },
        { tabId: 'three', documentId: null, kind: 'document', paneId: 'main', path: 'c.md' },
      ],
      activeTabId: 'two', layout: pane('main', 'two'),
    };
    const next = tabsReducer(state, { type: 'reorder', from: 0, to: 2 });
    expect(next.tabs.map((tab) => tab.path)).toEqual(['b.md', 'c.md', 'a.md']);
    expect(next.activeTabId).toBe('two');
  });

  it('ignores a move that changes nothing or points outside', () => {
    const state: TabsState = {
      tabs: [{ tabId: 'one', documentId: null, kind: 'document', paneId: 'main', path: 'a.md' }],
      activeTabId: 'one', layout: pane('main', 'one'),
    };
    expect(tabsReducer(state, { type: 'reorder', from: 0, to: 0 })).toBe(state);
    expect(tabsReducer(state, { type: 'reorder', from: 0, to: 4 })).toBe(state);
  });
});

function pane(paneId: string, activeTabId: string): PaneLayout {
  return { kind: 'pane', paneId, activeTabId };
}

function twoPanes(): TabsState {
  return {
    tabs: [
      { tabId: 'a', documentId: 'doc-a', kind: 'document', path: 'a.md', paneId: 'main' },
      { tabId: 'b', documentId: 'doc-b', kind: 'document', path: 'b.md', paneId: 'right' },
    ],
    activeTabId: 'a',
    layout: { kind: 'split', direction: 'horizontal', ratio: 0.5, children: [pane('main', 'a'), pane('right', 'b')] },
  };
}

describe('pane-aware tabs', () => {
  it('restores legacy tabs into the main pane', () => {
    const legacy = { tabId: 'legacy', documentId: null, kind: 'document', path: 'old.md' } as SessionTab;
    const next = tabsReducer(twoPanes(), { type: 'restore', tabs: [legacy], activeTabId: 'legacy' });
    expect(next.tabs[0].paneId).toBe('main');
    expect(next.layout).toEqual(pane('main', 'legacy'));
  });

  it('splits with an independent duplicate document tab', () => {
    const state = twoPanes();
    const next = tabsReducer(state, {
      type: 'split-pane', paneId: 'main', newPaneId: 'lower', direction: 'vertical',
      tab: { ...state.tabs[0], tabId: 'a-copy', paneId: 'lower' },
    });
    expect(next.tabs.map((tab) => [tab.tabId, tab.paneId])).toEqual([['a', 'main'], ['b', 'right'], ['a-copy', 'lower']]);
    expect(next.activeTabId).toBe('a-copy');
    expect(next.layout).toMatchObject({ children: [{ kind: 'split', direction: 'vertical' }, pane('right', 'b')] });
    expect(state.tabs).toHaveLength(2);
  });

  it('focuses the remembered tab of a pane', () => {
    const next = tabsReducer(twoPanes(), { type: 'focus-pane', paneId: 'right' });
    expect(next.activeTabId).toBe('b');
    expect(tabsReducer(next, { type: 'open-file-new-tab', path: 'a.md', tabId: 'a-right' }).tabs)
      .toContainEqual(expect.objectContaining({ tabId: 'a-right', paneId: 'right', path: 'a.md' }));
  });

  it('closing the final tab keeps its pane with the supplied empty fallback', () => {
    const next = tabsReducer(twoPanes(), { type: 'close', tabId: 'a', fallback: empty('fallback') });
    expect(next.tabs.map((tab) => [tab.tabId, tab.paneId])).toEqual([['b', 'right'], ['fallback', 'main']]);
    expect(next.layout).toEqual({ kind: 'split', direction: 'horizontal', ratio: 0.5, children: [pane('main', 'fallback'), pane('right', 'b')] });
    expect(next.activeTabId).toBe('fallback');
  });

  it('moves tabs between panes and fills an emptied source', () => {
    const next = tabsReducer(twoPanes(), { type: 'move-tab', tabId: 'a', paneId: 'right', to: 0, fallback: empty('fallback') });
    expect(next.tabs.filter((tab) => tab.paneId === 'right').map((tab) => tab.tabId)).toEqual(['a', 'b']);
    expect(next.tabs.find((tab) => tab.paneId === 'main')?.tabId).toBe('fallback');
    expect(next.activeTabId).toBe('a');
  });

  it('merges duplicate document copies when collapsing panes', () => {
    const state = twoPanes();
    state.tabs[1] = { ...state.tabs[0], tabId: 'copy', paneId: 'right' };
    state.activeTabId = 'copy';
    state.layout = { kind: 'split', direction: 'horizontal', ratio: 0.5, children: [pane('main', 'a'), pane('right', 'copy')] };
    const next = tabsReducer(state, { type: 'remove-pane', paneId: 'right', targetPaneId: 'main' });
    expect(next.tabs.map((tab) => tab.tabId)).toEqual(['a']);
    expect(next.activeTabId).toBe('a');
    expect(next.layout).toEqual(pane('main', 'a'));
  });

  it('preserves distinct tabs when disabling splits', () => {
    const next = tabsReducer(twoPanes(), { type: 'collapse-panes' });
    expect(next.tabs.map((tab) => [tab.tabId, tab.paneId])).toEqual([['a', 'main'], ['b', 'main']]);
    expect(next.layout).toEqual(pane('main', 'a'));
  });

  it('clamps split ratios without changing tabs', () => {
    const state = twoPanes();
    const next = tabsReducer(state, { type: 'resize-pane', path: [], ratio: 5 });
    expect(next.layout).toMatchObject({ ratio: 0.9 });
    expect(next.tabs).toBe(state.tabs);
  });

  it('replaces only the active pane tab when opening a file', () => {
    const state = tabsReducer(twoPanes(), { type: 'focus-pane', paneId: 'right' });
    const next = tabsReducer(state, { type: 'open-file', path: 'a.md', tabId: 'mount' });
    expect(next.tabs.map((tab) => [tab.tabId, tab.path, tab.paneId])).toEqual([['a', 'a.md', 'main'], ['b', 'a.md', 'right']]);
    expect(next.layout).toMatchObject({ children: [pane('main', 'a'), pane('right', 'b')] });
  });
  it('preserves pane selection when another pane receives focus', () => {
    const state = twoPanes();
    state.tabs.push({ ...state.tabs[1], tabId: 'c', path: 'c.md' });
    const selected = tabsReducer(state, { type: 'select', tabId: 'c' });
    const next = tabsReducer(selected, { type: 'focus-pane', paneId: 'main' });
    expect(next.activeTabId).toBe('a');
    expect(tabsReducer(next, { type: 'focus-pane', paneId: 'right' }).activeTabId).toBe('c');
  });

  it('does not close a duplicate copy in another pane', () => {
    const state = twoPanes();
    state.tabs[1] = { ...state.tabs[0], tabId: 'copy', paneId: 'right' };
    const next = tabsReducer(state, { type: 'close', path: 'a.md', fallback: empty('fallback') });
    expect(next.tabs.find((tab) => tab.tabId === 'copy')?.paneId).toBe('right');
    expect(next.tabs.some((tab) => tab.tabId === 'a')).toBe(false);
  });

  it('selects the previous pane tab after closing its selected tab while focus is elsewhere', () => {
    const state = twoPanes();
    state.tabs.push({ ...state.tabs[1], tabId: 'c', path: 'c.md' }, { ...state.tabs[1], tabId: 'd', path: 'd.md' });
    const selected = tabsReducer(state, { type: 'select', tabId: 'd' });
    const focused = tabsReducer(selected, { type: 'focus-pane', paneId: 'main' });
    const next = tabsReducer(focused, { type: 'close', tabId: 'd', fallback: empty('fallback') });
    expect(next.activeTabId).toBe('a');
    expect(tabsReducer(next, { type: 'focus-pane', paneId: 'right' }).activeTabId).toBe('c');
  });

  it('merges a moved duplicate into the existing destination copy', () => {
    const state = twoPanes();
    state.tabs[1] = { ...state.tabs[0], tabId: 'copy', paneId: 'right' };
    const next = tabsReducer(state, { type: 'move-tab', tabId: 'a', paneId: 'right', fallback: empty('fallback') });
    expect(next.tabs.map((tab) => tab.tabId)).toEqual(['copy', 'fallback']);
    expect(next.activeTabId).toBe('copy');
  });

  it('keeps restored pane geometry when callers supply empty fallbacks', () => {
    const state = twoPanes();
    const next = tabsReducer(state, {
      type: 'restore', tabs: [state.tabs[0]], activeTabId: 'missing', layout: state.layout,
      fallbackTabs: [{ ...empty('fallback'), paneId: 'right' }],
    });
    expect(next.activeTabId).toBe('a');
    expect(next.layout).toMatchObject({ children: [pane('main', 'a'), pane('right', 'fallback')] });
  });

  it('deduplicates restored graph and document tabs while preserving copies in separate panes', () => {
    const state = twoPanes();
    const next = tabsReducer(state, {
      type: 'restore', activeTabId: 'a', layout: state.layout,
      tabs: [state.tabs[0], { ...state.tabs[0], tabId: 'dup' }, { ...state.tabs[0], tabId: 'copy', paneId: 'right' }, graph('g'), { ...graph('g2'), paneId: 'right' }],
    });
    expect(next.tabs.map((tab) => tab.tabId)).toEqual(['a', 'copy', 'g']);
  });

  it('ignores invalid pane targets and repeated split IDs', () => {
    const state = twoPanes();
    expect(tabsReducer(state, { type: 'focus-pane', paneId: 'missing' })).toBe(state);
    expect(tabsReducer(state, { type: 'move-tab', tabId: 'a', paneId: 'missing', fallback: empty('fallback') })).toBe(state);
    expect(tabsReducer(state, { type: 'split-pane', paneId: 'main', newPaneId: 'right', direction: 'horizontal', tab: empty('c') })).toBe(state);
    expect(tabsReducer(state, { type: 'split-pane', paneId: 'main', newPaneId: 'lower', direction: 'horizontal', tab: state.tabs[0] })).toBe(state);
  });

  it('reorders only the requested pane while preserving other panes', () => {
    const state = twoPanes();
    state.tabs.push({ ...state.tabs[0], tabId: 'c', path: 'c.md' });
    const next = tabsReducer(state, { type: 'reorder', paneId: 'main', from: 0, to: 1 });
    expect(next.tabs.filter((tab) => tab.paneId === 'main').map((tab) => tab.tabId)).toEqual(['c', 'a']);
    expect(next.tabs.find((tab) => tab.paneId === 'right')).toEqual(state.tabs[1]);
  });

  it('caps layouts at four panes to bound mounted editors', () => {
    let state = twoPanes();
    for (const id of ['third', 'fourth']) {
      state = tabsReducer(state, { type: 'split-pane', paneId: 'main', newPaneId: id, direction: 'vertical', tab: empty(id) });
    }
    const next = tabsReducer(state, { type: 'split-pane', paneId: 'main', newPaneId: 'fifth', direction: 'horizontal', tab: empty('fifth') });
    expect(next).toBe(state);
    expect(next.tabs).toHaveLength(4);
  });

  it('normalizes restored ratios to the same bounds as resizing', () => {
    const state = twoPanes();
    const layout: PaneLayout = { kind: 'split', direction: 'horizontal', ratio: 8, children: [pane('main', 'a'), pane('right', 'b')] };
    const next = tabsReducer(state, { type: 'restore', tabs: state.tabs, activeTabId: 'a', layout });
    expect(next.layout).toMatchObject({ ratio: 0.9 });
  });

  it('merges path collisions from rename only within the same pane', () => {
    const state = twoPanes();
    state.tabs.push({ ...state.tabs[0], tabId: 'collision', path: 'target.md' });
    state.tabs[1] = { ...state.tabs[1], path: 'a.md' };
    const next = tabsReducer(state, { type: 'rename', oldPath: 'a.md', newPath: 'target.md' });
    expect(next.tabs.filter((tab) => tab.paneId === 'main')).toHaveLength(1);
    expect(next.tabs.find((tab) => tab.paneId === 'right')?.path).toBe('target.md');
    expect(next.activeTabId).toBe('a');
  });

  it('bounds restored pane counts while keeping distinct documents', () => {
    const state = twoPanes();
    const layout: PaneLayout = { kind: 'split', direction: 'horizontal', ratio: 0.5, children: [
      state.layout,
      { kind: 'split', direction: 'vertical', ratio: 0.5, children: [
        pane('third', 'c'),
        { kind: 'split', direction: 'horizontal', ratio: 0.5, children: [pane('fourth', 'd'), pane('fifth', 'e')] },
      ] },
    ] };
    const tabs = [...state.tabs, ...['third', 'fourth', 'fifth'].map((id) => ({ ...empty(id), paneId: id }))];
    const next = tabsReducer(state, { type: 'restore', tabs, layout, activeTabId: 'a' });
    expect(new Set(next.tabs.map((tab) => tab.paneId)).size).toBe(4);
    expect(next.tabs).toHaveLength(5);
    expect(next.tabs.find((tab) => tab.tabId === 'fifth')?.paneId).toBe('main');
  });

});
