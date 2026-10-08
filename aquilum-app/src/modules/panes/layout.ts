import type { PaneLayout } from '../ui-state/types';

type Pane = Extract<PaneLayout, { kind: 'pane' }>;
type Split = Extract<PaneLayout, { kind: 'split' }>;

export function paneLeaves(layout: PaneLayout): Pane[] {
  return layout.kind === 'pane'
    ? [layout]
    : layout.children.flatMap(paneLeaves);
}

function withChildren(layout: Split, children: [PaneLayout, PaneLayout]): PaneLayout {
  return children.every((child, index) => child === layout.children[index])
    ? layout
    : { ...layout, children };
}

export function splitPane(
  layout: PaneLayout,
  paneId: string,
  newPane: Pane,
  direction: Split['direction'],
): PaneLayout {
  const leaves = paneLeaves(layout);
  if (leaves.length >= 4 || leaves.some((pane) => pane.paneId === newPane.paneId)) return layout;
  if (layout.kind === 'pane') {
    return layout.paneId === paneId
      ? { kind: 'split', direction, ratio: 0.5, children: [layout, newPane] }
      : layout;
  }
  return withChildren(layout, [
    splitPane(layout.children[0], paneId, newPane, direction),
    splitPane(layout.children[1], paneId, newPane, direction),
  ]);
}

export function removePane(layout: PaneLayout, paneId: string): PaneLayout {
  if (layout.kind === 'pane') return layout;
  const [first, second] = layout.children;
  if (first.kind === 'pane' && first.paneId === paneId) return second;
  if (second.kind === 'pane' && second.paneId === paneId) return first;
  return withChildren(layout, [removePane(first, paneId), removePane(second, paneId)]);
}

export function setSplitRatio(layout: PaneLayout, path: readonly number[], ratio: number): PaneLayout {
  if (layout.kind === 'pane' || !Number.isFinite(ratio)) return layout;
  if (path.length === 0) {
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    return clamped === layout.ratio ? layout : { ...layout, ratio: clamped };
  }
  const index = path[0];
  if (index !== 0 && index !== 1) return layout;
  const children: [PaneLayout, PaneLayout] = [...layout.children];
  children[index] = setSplitRatio(children[index], path.slice(1), ratio);
  return withChildren(layout, children);
}
