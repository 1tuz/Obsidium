export type CanvasFreehandPoint = { x: number; y: number };

export function canvasFreehandPath(points: readonly CanvasFreehandPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  if (points.length === 2) return `M ${first.x} ${first.y} L ${last.x} ${last.y}`;
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    commands.push(`Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`);
  }
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(' ');
}
