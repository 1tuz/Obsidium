import type { CanvasNode } from './model';
import type { CanvasRect } from './interaction';

export type CanvasGuide = { axis: 'x' | 'y'; at: number };

const axisLines = (start: number, size: number): number[] => [start, start + size / 2, start + size];

const nearestSnap = (
  moving: readonly number[],
  lines: readonly number[],
  threshold: number,
): { diff: number; at: number } | null => {
  let best: { diff: number; at: number } | null = null;
  for (const value of moving) {
    for (const line of lines) {
      const diff = value - line;
      if (Math.abs(diff) > threshold) continue;
      if (best === null || Math.abs(diff) < Math.abs(best.diff)) best = { diff, at: line };
    }
  }
  return best;
};

export function snapToGuides(
  rect: CanvasRect,
  others: readonly CanvasNode[],
  threshold = 6,
): { offset: { x: number; y: number }; guides: CanvasGuide[] } {
  if (others.length === 0 || !(threshold > 0)) return { offset: { x: 0, y: 0 }, guides: [] };
  const x = nearestSnap(
    axisLines(rect.x, rect.width),
    others.flatMap(node => axisLines(node.x, node.width)),
    threshold,
  );
  const y = nearestSnap(
    axisLines(rect.y, rect.height),
    others.flatMap(node => axisLines(node.y, node.height)),
    threshold,
  );
  const guides: CanvasGuide[] = [];
  if (x) guides.push({ axis: 'x', at: x.at });
  if (y) guides.push({ axis: 'y', at: y.at });
  return { offset: { x: x ? 0 - x.diff : 0, y: y ? 0 - y.diff : 0 }, guides };
}

export type CanvasSnapPoint = { x: number; y: number; kind: 'corner' | 'side' | 'center' };

export const canvasNodeSnapPoints = (node: CanvasNode): CanvasSnapPoint[] => {
  const left = node.x;
  const right = node.x + node.width;
  const top = node.y;
  const bottom = node.y + node.height;
  const middleX = node.x + node.width / 2;
  const middleY = node.y + node.height / 2;
  return [
    { x: left, y: top, kind: 'corner' },
    { x: right, y: top, kind: 'corner' },
    { x: right, y: bottom, kind: 'corner' },
    { x: left, y: bottom, kind: 'corner' },
    { x: middleX, y: top, kind: 'side' },
    { x: right, y: middleY, kind: 'side' },
    { x: middleX, y: bottom, kind: 'side' },
    { x: left, y: middleY, kind: 'side' },
    { x: middleX, y: middleY, kind: 'center' },
  ];
};

export const snapPointToNodes = (
  point: { x: number; y: number },
  nodes: readonly CanvasNode[],
  threshold = 10,
  excludeIds?: ReadonlySet<string>,
): { point: { x: number; y: number }; snapped: CanvasSnapPoint | null } => {
  if (!(threshold > 0)) return { point, snapped: null };
  let best: { point: { x: number; y: number }; snapped: CanvasSnapPoint; distance: number } | null = null;
  for (const node of nodes) {
    if (excludeIds?.has(node.id)) continue;
    for (const candidate of canvasNodeSnapPoints(node)) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance > threshold) continue;
      if (best === null || distance < best.distance) {
        best = { point: { x: candidate.x, y: candidate.y }, snapped: candidate, distance };
      }
    }
  }
  return best ? { point: best.point, snapped: best.snapped } : { point, snapped: null };
};

export type CanvasResizeHandleAxis = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';

export const snapResizeRect = (
  rect: CanvasRect,
  others: readonly CanvasNode[],
  handle: CanvasResizeHandleAxis,
  threshold = 6,
): { rect: CanvasRect; guides: CanvasGuide[] } => {
  if (others.length === 0 || !(threshold > 0)) return { rect, guides: [] };
  const linesX = others.flatMap((node) => axisLines(node.x, node.width));
  const linesY = others.flatMap((node) => axisLines(node.y, node.height));
  const movingLeft = handle === 'top-left' || handle === 'left' || handle === 'bottom-left';
  const movingRight = handle === 'top-right' || handle === 'right' || handle === 'bottom-right';
  const movingTop = handle === 'top-left' || handle === 'top' || handle === 'top-right';
  const movingBottom = handle === 'bottom-left' || handle === 'bottom' || handle === 'bottom-right';
  const guides: CanvasGuide[] = [];
  let { x, y, width, height } = rect;
  if (movingLeft) {
    const snap = nearestSnap([x], linesX, threshold);
    if (snap) { x += snap.diff * -1; width += snap.diff; guides.push({ axis: 'x', at: snap.at }); }
  } else if (movingRight) {
    const snap = nearestSnap([x + width], linesX, threshold);
    if (snap) { width += snap.diff; guides.push({ axis: 'x', at: snap.at }); }
  }
  if (movingTop) {
    const snap = nearestSnap([y], linesY, threshold);
    if (snap) { y += snap.diff * -1; height += snap.diff; guides.push({ axis: 'y', at: snap.at }); }
  } else if (movingBottom) {
    const snap = nearestSnap([y + height], linesY, threshold);
    if (snap) { height += snap.diff; guides.push({ axis: 'y', at: snap.at }); }
  }
  return { rect: { x, y, width, height }, guides };
};
