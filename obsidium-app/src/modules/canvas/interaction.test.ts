import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from './model';
import {
  alignCanvasNodes,
  canvasEdgeAnchor,
  canvasEdgeSides,
  canvasNodeAtPoint,
  canvasRectBetweenPoints,
  canvasSelectionBounds,
  canvasSidePoint,
  commitCanvasHistory,
  createCanvasHistory,
  expandCanvasSelection,
  getCanvasGroupMemberIds,
  getCanvasEdgeGeometry,
  getCanvasEdgePath,
  moveCanvasEdgeEndpoint,
  redoCanvasHistory,
  resizeCanvasGroup,
  resizeCanvasNode,
  resizeCanvasNodeFromHandle,
  resizeCanvasSelection,
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

const ellipseEquation = (point: { x: number; y: number }, node: CanvasNode): number => {
  const radiusX = node.width / 2;
  const radiusY = node.height / 2;
  return ((point.x - node.x - radiusX) / radiusX) ** 2 + ((point.y - node.y - radiusY) / radiusY) ** 2;
};

const rhombusEquation = (point: { x: number; y: number }, node: CanvasNode): number =>
  Math.abs(point.x - node.x - node.width / 2) / (node.width / 2)
  + Math.abs(point.y - node.y - node.height / 2) / (node.height / 2);

const crossOfCenters = (
  point: { x: number; y: number },
  from: CanvasNode,
  to: CanvasNode,
): number => {
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;
  return (toX - fromX) * (point.y - fromY) - (toY - fromY) * (point.x - fromX);
};

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

  it('recomputes edge endpoints from current bounds and clips diagonal edges on the outlines', () => {
    const edge = { id: 'e', fromNode: 'a', toNode: 'b' };
    const geometry = getCanvasEdgeGeometry(edge, nodes)!;
    expect(geometry.from.x).toBeCloseTo(100, 6);
    expect(geometry.from.y).toBeCloseTo(38.6957, 4);
    expect(geometry.to.x).toBeCloseTo(240, 6);
    expect(geometry.to.y).toBeCloseTo(63.0435, 4);
    expect(geometry.from).not.toEqual({ x: 100, y: 30 });
    expect(geometry.to).not.toEqual({ x: 240, y: 70 });
    expect(getCanvasEdgeGeometry(edge, new Map(nodes.map((node) => [node.id, node])))).toEqual(geometry);
    expect(getCanvasEdgeGeometry({ ...edge, fromSide: 'bottom', toSide: 'top' }, nodes)).toEqual(geometry);
    const moved = translateCanvasNodes(nodes, new Set(['b']), { x: 100, y: 0 });
    const movedGeometry = getCanvasEdgeGeometry(edge, moved)!;
    expect(movedGeometry.to.x).toBeCloseTo(340, 6);
    expect(movedGeometry.to.y).toBeCloseTo(65.1515, 4);
    expect(getCanvasEdgeGeometry({ ...edge, fromNode: 'missing' }, nodes)).toBeNull();
  });

  it('clips ellipse and diamond endpoints against their own curves', () => {
    const shapes: CanvasNode[] = [
      { id: 'ellipse', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '', obsidium: { shape: 'ellipse' } },
      { id: 'diamond', type: 'text', x: 240, y: 120, width: 100, height: 100, text: '', obsidium: { shape: 'diamond' } },
    ];
    const geometry = getCanvasEdgeGeometry({ id: 'e', fromNode: 'ellipse', toNode: 'diamond' }, shapes)!;
    expect(Math.abs(ellipseEquation(geometry.from, shapes[0]) - 1)).toBeLessThan(0.01);
    expect(Math.abs(rhombusEquation(geometry.to, shapes[1]) - 1)).toBeLessThan(0.01);
    expect(crossOfCenters(geometry.from, shapes[0], shapes[1])).toBeCloseTo(0, 4);
    expect(crossOfCenters(geometry.to, shapes[0], shapes[1])).toBeCloseTo(0, 4);
    expect(geometry.from).not.toEqual({ x: 200, y: 50 });
    expect(geometry.to).not.toEqual({ x: 240, y: 170 });
  });

  it('falls back to side points when both nodes share a center', () => {
    const stacked: CanvasNode[] = [
      { id: 'wide', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'wide' },
      { id: 'narrow', type: 'text', x: 20, y: 10, width: 60, height: 40, text: 'narrow' },
    ];
    const edge = { id: 'e', fromNode: 'wide', toNode: 'narrow' };
    expect(getCanvasEdgeGeometry({ ...edge, fromSide: 'right', toSide: 'left' }, stacked))
      .toEqual({ from: { x: 100, y: 30 }, to: { x: 20, y: 30 } });
    expect(getCanvasEdgeGeometry(edge, stacked))
      .toEqual({ from: { x: 50, y: 60 }, to: { x: 50, y: 10 } });
  });

  it('treats freehand and number shapes as rectangles', () => {
    const shapes: CanvasNode[] = [
      { id: 'stroke', type: 'text', x: 0, y: 0, width: 100, height: 100, text: '', obsidium: { shape: 'freehand', points: [] } },
      { id: 'number', type: 'text', x: 200, y: 200, width: 100, height: 100, text: '1', obsidium: { shape: 'number' } },
    ];
    expect(getCanvasEdgeGeometry({ id: 'e', fromNode: 'stroke', toNode: 'number' }, shapes))
      .toEqual({ from: { x: 100, y: 100 }, to: { x: 200, y: 200 } });
  });

  it('anchors a point on every side of a node', () => {
    expect(canvasSidePoint(nodes[0], 'top')).toEqual({ x: 50, y: 0 });
    expect(canvasSidePoint(nodes[0], 'right')).toEqual({ x: 100, y: 30 });
    expect(canvasSidePoint(nodes[0], 'bottom')).toEqual({ x: 50, y: 60 });
    expect(canvasSidePoint(nodes[0], 'left')).toEqual({ x: 0, y: 30 });
  });

  it('chooses horizontal edge sides for wider offsets and vertical sides otherwise', () => {
    expect(canvasEdgeSides(nodes[0], nodes[1])).toEqual({ fromSide: 'right', toSide: 'left' });
    expect(canvasEdgeSides(nodes[1], nodes[0])).toEqual({ fromSide: 'left', toSide: 'right' });
    expect(canvasEdgeSides(nodes[0], nodes[2])).toEqual({ fromSide: 'bottom', toSide: 'top' });
    expect(canvasEdgeSides(nodes[0], { id: 'below', type: 'text', x: 0, y: 300, width: 100, height: 60, text: 'below' }))
      .toEqual({ fromSide: 'bottom', toSide: 'top' });
  });

  it('picks the last drawn node at a point while skipping groups and exclusions', () => {
    const stacked: CanvasNode[] = [
      { id: 'under', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'under' },
      { id: 'group', type: 'group', x: 0, y: 0, width: 100, height: 60 },
      { id: 'over', type: 'file', x: 20, y: 10, width: 100, height: 60, file: 'over.md' },
    ];
    expect(canvasNodeAtPoint(stacked, { x: 40, y: 20 })?.id).toBe('over');
    expect(canvasNodeAtPoint(stacked, { x: 40, y: 20 }, 'over')?.id).toBe('under');
    expect(canvasNodeAtPoint([stacked[1]], { x: 40, y: 20 })).toBeNull();
    expect(canvasNodeAtPoint(stacked, { x: 120, y: 70 })?.id).toBe('over');
    expect(canvasNodeAtPoint(stacked, { x: 200, y: 200 })).toBeNull();
  });

  it('expands a selection to whole groups from a member, a nested group, or a plain node', () => {
    const grouped: CanvasNode[] = [
      { id: 'outer', type: 'group', x: 0, y: 0, width: 600, height: 400 },
      { id: 'inner', type: 'group', x: 20, y: 20, width: 300, height: 200 },
      { id: 'first', type: 'text', x: 40, y: 40, width: 100, height: 60, text: 'first' },
      { id: 'second', type: 'text', x: 200, y: 100, width: 100, height: 60, text: 'second' },
      { id: 'outside', type: 'text', x: 700, y: 0, width: 100, height: 60, text: 'outside' },
    ];
    expect(expandCanvasSelection(['first'], grouped)).toEqual(['outer', 'inner', 'first', 'second']);
    expect(expandCanvasSelection(['inner'], grouped)).toEqual(['outer', 'inner', 'first', 'second']);
    expect(expandCanvasSelection(['outside'], grouped)).toEqual(['outside']);
    expect(expandCanvasSelection(['first', 'outside'], grouped)).toEqual(['outer', 'inner', 'first', 'second', 'outside']);
  });

  it('scales group members with the resized group and clamps small members', () => {
    const group: CanvasNode = { id: 'group', type: 'group', x: 0, y: 0, width: 200, height: 100 };
    const members: CanvasNode[] = [
      { id: 'member', type: 'text', x: 40, y: 20, width: 60, height: 40, text: 'member' },
      { id: 'small', type: 'text', x: 10, y: 10, width: 20, height: 20, text: 'small' },
      { id: 'outside', type: 'text', x: 400, y: 0, width: 40, height: 40, text: 'outside' },
    ];
    expect(resizeCanvasGroup(group, members, { ...group, width: 400, height: 200 }))
      .toEqual([
        { id: 'member', type: 'text', x: 80, y: 40, width: 120, height: 80, text: 'member' },
        { id: 'small', type: 'text', x: 20, y: 20, width: 40, height: 40, text: 'small' },
        { id: 'outside', type: 'text', x: 400, y: 0, width: 40, height: 40, text: 'outside' },
      ]);
    expect(resizeCanvasGroup(group, members, { ...group, x: 100, y: 50, width: 400, height: 200 })[0])
      .toMatchObject({ x: 180, y: 90, width: 120, height: 80 });
    expect(resizeCanvasGroup(group, members, { ...group, width: 20, height: 10 })[1])
      .toMatchObject({ x: 1, y: 1, width: 24, height: 24 });
    expect(resizeCanvasGroup(group, members, { ...group, width: 20, height: 10 })[2]).toBe(members[2]);
  });

  it('scales a multi-node selection from its bounds and leaves unselected nodes untouched', () => {
    const selection = new Set(['a', 'b']);
    expect(canvasSelectionBounds(nodes, selection)).toEqual({ x: 0, y: 0, width: 320, height: 120 });
    expect(canvasSelectionBounds(nodes, new Set())).toBeNull();
    const scaled = resizeCanvasSelection(nodes, selection, { x: 0, y: 0, width: 640, height: 240 });
    expect(scaled[0]).toMatchObject({ id: 'a', x: 0, y: 0, width: 200, height: 120 });
    expect(scaled[1]).toMatchObject({ id: 'b', x: 480, y: 40, width: 160, height: 200 });
    expect(scaled[2]).toBe(nodes[2]);
    const moved = resizeCanvasSelection(nodes, selection, { x: 100, y: 50, width: 640, height: 240 });
    expect(moved[0]).toMatchObject({ x: 100, y: 50, width: 200, height: 120 });
    expect(moved[1]).toMatchObject({ x: 580, y: 90, width: 160, height: 200 });
    expect(resizeCanvasSelection(nodes, new Set(), { x: 0, y: 0, width: 10, height: 10 })).toEqual(nodes);
  });

  it('scales group members inside a scaled selection and clamps their minimum size', () => {
    const grouped: CanvasNode[] = [
      { id: 'group', type: 'group', x: 0, y: 0, width: 200, height: 100 },
      { id: 'member', type: 'text', x: 40, y: 20, width: 60, height: 40, text: 'member' },
      { id: 'small', type: 'text', x: 10, y: 10, width: 10, height: 10, text: 'small' },
      { id: 'outside', type: 'text', x: 400, y: 0, width: 40, height: 40, text: 'outside' },
    ];
    const scaled = resizeCanvasSelection(grouped, new Set(['group']), { x: 0, y: 0, width: 400, height: 200 });
    expect(scaled[0]).toMatchObject({ id: 'group', width: 400, height: 200 });
    expect(scaled[1]).toMatchObject({ id: 'member', x: 80, y: 40, width: 120, height: 80 });
    expect(scaled[2]).toMatchObject({ id: 'small', x: 20, y: 20, width: 24, height: 24 });
    expect(scaled[3]).toBe(grouped[3]);
    const shrunk = resizeCanvasSelection(grouped, new Set(['group']), { x: 0, y: 0, width: 100, height: 50 });
    expect(shrunk[2]).toMatchObject({ id: 'small', x: 5, y: 5, width: 24, height: 24 });
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

describe('moveCanvasEdgeEndpoint', () => {
  const node = { id: 'n', type: 'text' as const, x: 100, y: 50, width: 200, height: 100 };

  it('stores the pointer as a fraction of the node box', () => {
    const edge: CanvasEdge = { id: 'e', fromNode: 'n', toNode: 'm' };
    expect(moveCanvasEdgeEndpoint(edge, 'from', node, { x: 150, y: 100 }).fromAnchor).toEqual({ x: 0.25, y: 0.5 });
    expect(moveCanvasEdgeEndpoint(edge, 'to', node, { x: 300, y: 150 }).toAnchor).toEqual({ x: 1, y: 1 });
  });

  it('clamps a pointer outside the node to its border', () => {
    const edge: CanvasEdge = { id: 'e', fromNode: 'n', toNode: 'm' };
    expect(moveCanvasEdgeEndpoint(edge, 'to', node, { x: 0, y: 0 }).toAnchor).toEqual({ x: 0, y: 0 });
  });
});

describe('canvasEdgeAnchor', () => {
  const diamond = { id: 'd', type: 'text' as const, x: 100, y: 0, width: 200, height: 200, text: '', obsidium: { shape: 'diamond' } };
  const other = { x: 0, y: 100 };

  it('lands on the outline facing the other end when the pointer is inside the shape', () => {
    const anchor = canvasEdgeAnchor(diamond, { x: 200, y: 100 }, other);
    expect(anchor.x).toBeCloseTo(0, 5);
    expect(anchor.y).toBeCloseTo(0.5, 5);
  });

  it('follows the pointer when it is outside the shape', () => {
    const anchor = canvasEdgeAnchor(diamond, { x: 400, y: 100 }, other);
    expect(anchor.x).toBeCloseTo(1, 5);
    expect(anchor.y).toBeCloseTo(0.5, 5);
  });
});
