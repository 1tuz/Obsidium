export type CanvasNodeBox = { x: number; y: number; width: number; height: number };

export function canvasNodeStyle(node: CanvasNodeBox, zIndex: number): Record<string, string | number> {
  return {
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
    zIndex,
  };
}

export function canvasPixels(value: number): string {
  return `${value}px`;
}
