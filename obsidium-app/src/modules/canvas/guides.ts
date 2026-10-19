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
