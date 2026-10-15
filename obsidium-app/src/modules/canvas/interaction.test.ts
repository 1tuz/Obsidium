import { describe, expect, it } from 'vitest';
import type { CanvasNode } from './model';
import {
  alignCanvasNodes,
  canvasRectBetweenPoints,
  commitCanvasHistory,
  createCanvasHistory,
  getCanvasGroupMemberIds,
  getCanvasEdgeGeometry,
  getCanvasEdgePath,
  redoCanvasHistory,
  resizeCanvasNode,
  resizeCanvasNodeFromHandle,
  selectCanvasNode,
  selectCanvasNodesInRect,
  translateCanvasNodes,
  undoCanvasHistory,
} from './interaction';

const nodes: CanvasNode[] = [
  { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'a', custom: { keep: true } },
  { id: 'b', type: 'file', x: 240, y: 20, width: 80, height: 100, file: 'b.md' },
  { id: 'c', type: 'link', x: 500, y: 500, width: 90, height: 90, url: 'https://example.com' },
];

describe('canvas interactions', () => {
  it('normalizes drag rectangles in either direction and keeps dimensions positive', () => {
    expect(canvasRectBetweenPoints({ x: 120, y: 90 }, { x: 20, y: 10 }))
      .toEqual({ x: 20, y: 10, width: 100, height: 80 });
    expect(canvasRectBetweenPoints({ x: 2.4, y: 1.2 }, { x: 2.4, y: 1.2 }))
      .toEqual({ x: 2, y: 1, width: 1, height: 1 });
    expect(canvasRectBetweenPoints({ x: 0.4, y: 0.6 }, { x: 21.8, y: 35.2 }))
      .toEqual({ x: 0, y: 1, width: 22, height: 34 });
  });

  it('selects by click, shift toggle, and intersecting marquee', () => {
    expect(selectCanvasNode(['a'], 'b')).toEqual(['b']);
    expect(selectCanvasNode(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(selectCanvasNode(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(selectCanvasNodesInRect(nodes, { x: 90, y: 40, width: 200, height: 60 })).toEqual(['a', 'b']);
    expect(selectCanvasNodesInRect(nodes, { x: 200, y: 0, width: 100, height: 100 }, ['c'], true)).toEqual(['c', 'b']);
  });

  it('translates selected nodes immutably and snaps to an optional grid', () => {
    const moved = translateCanvasNodes(nodes, new Set(['a', 'b']), { x: 13, y: -6 }, 10);
    expect(moved[0]).toMatchObject({ x: 10, y: -10, custom: { keep: true } });
    expect(moved[1]).toMatchObject({ x: 250, y: 10 });
    expect(moved[2]).toBe(nodes[2]);
    expect(nodes[0].x).toBe(0);
  });

  it('aligns multiple objects and moves a group with its contained objects', () => {
    const group: CanvasNode = { id: 'group', type: 'group', x: 0, y: 0, width: 400, height: 200 };
    expect(getCanvasGroupMemberIds(group, [group, nodes[0], nodes[1], nodes[2]])).toEqual(['a', 'b']);
    expect(alignCanvasNodes(nodes, new Set(['a', 'b']), 'left').map(node => node.x)).toEqual([0, 0, 500]);
    expect(alignCanvasNodes(nodes, new Set(['a', 'b']), 'center-y').map(node => node.y)).toEqual([30, 10, 500]);
    expect(alignCanvasNodes([
      { ...nodes[0], width: 101 },
      { ...nodes[1], x: 200, width: 100 },
    ], new Set(['a', 'b']), 'center-x').map(node => node.x).every(Number.isInteger)).toBe(true);
  });

  it('resizes with minimum dimensions and optional grid snap', () => {
    expect(resizeCanvasNode(nodes[0], { width: 161, height: 91 }, 120, 80, 20))
      .toMatchObject({ width: 160, height: 100, text: 'a', custom: { keep: true } });
    expect(resizeCanvasNode(nodes[0], { width: 30, height: 20 })).toMatchObject({ width: 120, height: 80 });
    expect(resizeCanvasNode(nodes[0], { width: 160.4, height: 90.7 })).toMatchObject({ width: 160, height: 91 });
  });

  it('resizes from every anchor while keeping the opposite edge fixed and supports square ratios', () => {
    expect(resizeCanvasNodeFromHandle(nodes[0], 'top-left', { x: -30, y: -20 }))
      .toMatchObject({ x: -30, y: -20, width: 130, height: 80 });
    expect(resizeCanvasNodeFromHandle(nodes[0], 'left', { x: -30, y: 0 }))
      .toMatchObject({ x: -30, y: 0, width: 130, height: 60 });
    expect(resizeCanvasNodeFromHandle(nodes[0], 'bottom-right', { x: 30, y: 20 }, true))
      .toMatchObject({ x: 0, y: 0, width: 133, height: 80 });
    expect(resizeCanvasNodeFromHandle(nodes[0], 'top-left', { x: 200, y: 200 }))
      .toMatchObject({ x: -20, y: -20, width: 120, height: 80 });
  });

  it('builds straight, elbow, and curved edge paths with an editable bend', () => {
    const geometry = { from: { x: 10, y: 20 }, to: { x: 110, y: 80 } };
    expect(getCanvasEdgePath(geometry, 'straight')).toBe('M 10 20 L 110 80');
    expect(getCanvasEdgePath(geometry, 'elbow')).toBe('M 10 20 L 60 20 L 60 80 L 110 80');
    expect(getCanvasEdgePath(geometry, 'curved', { x: 0, y: -30 })).toBe('M 10 20 Q 60 20 110 80');
  });

  it('recomputes edge endpoints from current bounds and respects explicit sides', () => {
    const edge = { id: 'e', fromNode: 'a', toNode: 'b' };
    expect(getCanvasEdgeGeometry(edge, nodes)).toEqual({ from: { x: 100, y: 30 }, to: { x: 240, y: 70 } });
    expect(getCanvasEdgeGeometry(edge, new Map(nodes.map((node) => [node.id, node])))).toEqual({ from: { x: 100, y: 30 }, to: { x: 240, y: 70 } });
    const moved = translateCanvasNodes(nodes, new Set(['b']), { x: 100, y: 0 });
    expect(getCanvasEdgeGeometry(edge, moved)?.to).toEqual({ x: 340, y: 70 });
    expect(getCanvasEdgeGeometry({ ...edge, fromSide: 'bottom', toSide: 'top' }, nodes))
      .toEqual({ from: { x: 50, y: 60 }, to: { x: 280, y: 20 } });
  });

  it('undoes and redoes bounded immutable snapshots', () => {
    let history = createCanvasHistory('start', 2);
    history = commitCanvasHistory(history, 'one');
    history = commitCanvasHistory(history, 'two');
    history = commitCanvasHistory(history, 'three');
    expect(history.past).toEqual(['one', 'two']);
    history = undoCanvasHistory(history);
    expect(history.current).toBe('two');
    history = undoCanvasHistory(history);
    expect(history.current).toBe('one');
    history = redoCanvasHistory(history);
    expect(history.current).toBe('two');
    history = commitCanvasHistory(history, 'branch');
    expect(history.future).toEqual([]);
    expect(redoCanvasHistory(history)).toBe(history);
  });
});
