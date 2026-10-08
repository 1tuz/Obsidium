import type { PaneLayout, SessionTab } from './types';
import { paneLeaves, removePane, setSplitRatio, splitPane } from '../panes/layout';

export interface TabsState {
  tabs: SessionTab[];
  activeTabId: string;
  layout: PaneLayout;
}

export type TabsAction =
  | { type: 'reset'; tab: SessionTab }
  | { type: 'restore'; tabs: SessionTab[]; activeTabId: string; layout?: PaneLayout; fallbackTabs?: SessionTab[] }
  | { type: 'select'; path?: string; tabId?: string; paneId?: string }
  | { type: 'focus-pane'; paneId: string }
  | { type: 'open-file' | 'open-file-new-tab'; path: string; tabId: string }
  | { type: 'close'; path?: string; tabId?: string; fallback: SessionTab }
  | { type: 'new-tab' | 'open-graph'; tab: SessionTab }
  | { type: 'reorder'; from: number; to: number; paneId?: string }
  | { type: 'split-pane'; paneId: string; newPaneId: string; direction: 'horizontal' | 'vertical'; tab: SessionTab }
  | { type: 'move-tab'; tabId: string; paneId: string; to?: number; fallback: SessionTab }
  | { type: 'remove-pane'; paneId: string; targetPaneId?: string }
  | { type: 'collapse-panes' }
  | { type: 'resize-pane'; path: readonly number[]; ratio: number }
  | { type: 'rename'; oldPath: string; newPath: string }
  | { type: 'resolve-identity'; tabId: string; path: string; documentId: string };

function activePaneId(state: TabsState): string {
  return state.tabs.find((tab) => tab.tabId === state.activeTabId)?.paneId ?? paneLeaves(state.layout)[0].paneId;
}

function complete(tabs: SessionTab[], activeTabId: string, layout: PaneLayout, replacement?: SessionTab): TabsState {
  const active = tabs.find((tab) => tab.tabId === activeTabId) ?? tabs[0];
  function update(node: PaneLayout): PaneLayout {
    if (node.kind === 'split') {
      const children = node.children.map(update) as [PaneLayout, PaneLayout];
      return children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    const owned = tabs.filter((tab) => tab.paneId === node.paneId);
    const remembered = owned.find((tab) => tab.tabId === node.activeTabId)
      ?? (replacement?.paneId === node.paneId ? replacement : owned[0]);
    const selected = active?.paneId === node.paneId ? active : remembered;
    const tabId = selected?.tabId ?? null;
    return tabId === node.activeTabId ? node : { ...node, activeTabId: tabId };
  }
  return { tabs, activeTabId: active.tabId, layout: update(layout) };
}

function duplicate(tabs: SessionTab[], tab: SessionTab, paneId: string): SessionTab | undefined {
  return tabs.find((existing) => existing.tabId !== tab.tabId
    && ((existing.paneId === paneId && existing.path === tab.path)
      || (existing.kind === 'graph' && tab.kind === 'graph')));
}

function restored(state: TabsState, action: Extract<TabsAction, { type: 'restore' }>): TabsState {
  let layout: PaneLayout = action.layout ?? { kind: 'pane', paneId: 'main', activeTabId: action.activeTabId };
  function clamp(node: PaneLayout): PaneLayout {
    return node.kind === 'pane' ? node : setSplitRatio({
      ...node, children: node.children.map(clamp) as [PaneLayout, PaneLayout],
    }, [], Number.isFinite(node.ratio) ? node.ratio : 0.5);
  }
  layout = clamp(layout);
  const leaves = paneLeaves(layout);
  const validPanes = new Set(leaves.map((pane) => pane.paneId));
  const tabs: SessionTab[] = [];
  let activeTabId = action.activeTabId;
  for (const raw of [...action.tabs, ...(action.fallbackTabs ?? [])]) {
    const tab = { ...raw, paneId: validPanes.has(raw.paneId) ? raw.paneId : leaves[0].paneId };
    const existing = tabs.find((item) => item.tabId === tab.tabId) ?? duplicate(tabs, tab, tab.paneId);
    if (!existing) tabs.push(tab);
    else if (tab.tabId === activeTabId) activeTabId = existing.tabId;
  }
  if (tabs.length === 0) return state;
  for (const leaf of leaves) {
    if (!tabs.some((tab) => tab.paneId === leaf.paneId)) layout = removePane(layout, leaf.paneId);
  }
  let next = complete(tabs, activeTabId, layout);
  for (const leaf of paneLeaves(layout).slice(4)) next = removed(next, leaf.paneId, paneLeaves(layout)[0].paneId);
  return next;
}

function moved(state: TabsState, action: Extract<TabsAction, { type: 'move-tab' }>): TabsState {
  const moving = state.tabs.find((tab) => tab.tabId === action.tabId);
  if (!moving || !paneLeaves(state.layout).some((pane) => pane.paneId === action.paneId)) return state;
  const tabs = state.tabs.filter((tab) => tab.tabId !== moving.tabId);
  const existing = duplicate(tabs, moving, action.paneId);
  if (!existing) {
    const target = tabs.filter((tab) => tab.paneId === action.paneId);
    const position = Math.max(0, Math.min(target.length, Math.trunc(action.to ?? target.length)));
    const index = target[position] ? tabs.indexOf(target[position]) : target.length > 0 ? tabs.indexOf(target[target.length - 1]) + 1 : tabs.length;
    tabs.splice(index, 0, { ...moving, paneId: action.paneId });
  }
  if (!tabs.some((tab) => tab.paneId === moving.paneId)) {
    if (tabs.some((tab) => tab.tabId === action.fallback.tabId)) return state;
    tabs.push({ ...action.fallback, paneId: moving.paneId });
  }
  return complete(tabs, existing?.tabId ?? moving.tabId, state.layout);
}

function removed(state: TabsState, paneId: string, targetPaneId?: string): TabsState {
  const leaves = paneLeaves(state.layout);
  const target = leaves.find((pane) => pane.paneId !== paneId && (!targetPaneId || pane.paneId === targetPaneId));
  if (!target || !leaves.some((pane) => pane.paneId === paneId)) return state;
  const tabs = state.tabs.filter((tab) => tab.paneId !== paneId);
  let activeTabId = state.activeTabId;
  for (const tab of state.tabs.filter((item) => item.paneId === paneId)) {
    const existing = duplicate(tabs, tab, target.paneId);
    if (existing && activeTabId === tab.tabId) activeTabId = existing.tabId;
    if (!existing) tabs.push({ ...tab, paneId: target.paneId });
  }
  return complete(tabs, activeTabId, removePane(state.layout, paneId));
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'reset': {
      const tab = { ...action.tab, paneId: 'main' };
      return complete([tab], tab.tabId, { kind: 'pane', paneId: 'main', activeTabId: tab.tabId });
    }
    case 'restore':
      return restored(state, action);
    case 'focus-pane': {
      const pane = paneLeaves(state.layout).find((item) => item.paneId === action.paneId);
      const tab = state.tabs.find((item) => item.tabId === pane?.activeTabId);
      return tab ? complete(state.tabs, tab.tabId, state.layout) : state;
    }
    case 'select': {
      const paneId = action.paneId ?? activePaneId(state);
      const selected = state.tabs.find((tab) => action.tabId ? tab.tabId === action.tabId : tab.paneId === paneId && tab.path === action.path);
      return selected ? complete(state.tabs, selected.tabId, state.layout) : state;
    }
    case 'open-file':
    case 'open-file-new-tab': {
      const paneId = activePaneId(state);
      const existing = state.tabs.find((tab) => tab.paneId === paneId && tab.path === action.path);
      if (existing) return complete(state.tabs, existing.tabId, state.layout);
      const index = action.type === 'open-file' ? state.tabs.findIndex((tab) => tab.tabId === state.activeTabId) : -1;
      const tab: SessionTab = {
        tabId: index >= 0 ? state.tabs[index].tabId : action.tabId,
        documentId: null, kind: 'document', path: action.path, paneId,
        ...(action.type === 'open-file' ? { mountKey: action.tabId } : {}),
      };
      if (index < 0 && state.tabs.some((existingTab) => existingTab.tabId === tab.tabId)) return state;
      const tabs = [...state.tabs];
      if (index >= 0) tabs[index] = tab;
      else tabs.push(tab);
      return complete(tabs, tab.tabId, state.layout);
    }
    case 'close': {
      const closing = state.tabs.find((tab) => action.tabId ? tab.tabId === action.tabId : tab.paneId === activePaneId(state) && tab.path === action.path);
      if (!closing) return state;
      const owned = state.tabs.filter((tab) => tab.paneId === closing.paneId);
      const index = owned.indexOf(closing);
      const tabs = state.tabs.filter((tab) => tab.tabId !== closing.tabId);
      let replacement = owned[index - 1] ?? owned[index + 1];
      if (!replacement) {
        if (tabs.some((tab) => tab.tabId === action.fallback.tabId)) return state;
        replacement = { ...action.fallback, paneId: closing.paneId };
        tabs.push(replacement);
      }
      return complete(tabs, state.activeTabId === closing.tabId ? replacement.tabId : state.activeTabId, state.layout, replacement);
    }
    case 'new-tab':
    case 'open-graph': {
      const paneId = activePaneId(state);
      const existing = duplicate(state.tabs, action.tab, paneId);
      if (existing) return complete(state.tabs, existing.tabId, state.layout);
      if (state.tabs.some((tab) => tab.tabId === action.tab.tabId)) return state;
      const tab = { ...action.tab, paneId };
      return complete([...state.tabs, tab], tab.tabId, state.layout);
    }
    case 'reorder': {
      const owned = action.paneId ? state.tabs.filter((tab) => tab.paneId === action.paneId) : state.tabs;
      const moving = owned[action.from];
      const target = owned[action.to];
      if (!moving || !target || moving.paneId !== target.paneId || action.from === action.to) return state;
      const tabs = [...state.tabs];
      tabs.splice(tabs.indexOf(moving), 1);
      const index = tabs.indexOf(target) + (action.from < action.to ? 1 : 0);
      tabs.splice(index, 0, moving);
      return { ...state, tabs };
    }
    case 'split-pane': {
      if (state.tabs.some((tab) => tab.tabId === action.tab.tabId || (tab.kind === 'graph' && action.tab.kind === 'graph'))) return state;
      const layout = splitPane(state.layout, action.paneId, { kind: 'pane', paneId: action.newPaneId, activeTabId: action.tab.tabId }, action.direction);
      if (layout === state.layout) return state;
      const tab = { ...action.tab, paneId: action.newPaneId };
      return complete([...state.tabs, tab], tab.tabId, layout);
    }
    case 'move-tab':
      return moved(state, action);
    case 'remove-pane':
      return removed(state, action.paneId, action.targetPaneId);
    case 'collapse-panes': {
      const targetPaneId = paneLeaves(state.layout)[0].paneId;
      let next = state;
      for (const pane of paneLeaves(state.layout).slice(1)) next = removed(next, pane.paneId, targetPaneId);
      return next;
    }
    case 'resize-pane': {
      const layout = setSplitRatio(state.layout, action.path, action.ratio);
      return layout === state.layout ? state : { ...state, layout };
    }
    case 'rename':
      if (!state.tabs.some((tab) => tab.path === action.oldPath)) return state;
      return restored(state, {
        type: 'restore', layout: state.layout, activeTabId: state.activeTabId,
        tabs: state.tabs.map((tab) => tab.path === action.oldPath ? {
          ...tab,
          path: action.newPath,
          identityPath: tab.documentId ? undefined : (tab.identityPath ?? action.oldPath),
        } : tab),
      });
    case 'resolve-identity':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.tabId === action.tabId && tab.path === action.path
            ? { ...tab, documentId: action.documentId, identityPath: undefined }
            : tab),
      };
  }
}
