export type CanvasCamera = { x: number; y: number; zoom: number };
export type CanvasViewport = { width: number; height: number };
export type CanvasBounds = { x: number; y: number; width: number; height: number };

export const MIN_CANVAS_ZOOM = 0.2;
export const MAX_CANVAS_ZOOM = 2.5;

export function clampCanvasZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function zoomCanvasAt(
  camera: CanvasCamera,
  point: { x: number; y: number },
  factor: number,
): CanvasCamera {
  if (!(factor > 0) || !(camera.zoom > 0)) return camera;
  const zoom = clampCanvasZoom(camera.zoom * factor);
  const ratio = zoom / camera.zoom;
  return {
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
    zoom,
  };
}

export function zoomCanvasAtCenter(
  camera: CanvasCamera,
  viewport: CanvasViewport,
  factor: number,
): CanvasCamera {
  return zoomCanvasAt(camera, { x: viewport.width / 2, y: viewport.height / 2 }, factor);
}

export function panCanvas(
  camera: CanvasCamera,
  delta: { x: number; y: number },
): CanvasCamera {
  return { x: camera.x + delta.x, y: camera.y + delta.y, zoom: camera.zoom };
}

export function canvasContentBounds(
  nodes: readonly { x: number; y: number; width: number; height: number }[],
): CanvasBounds | null {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function fitCanvasCamera(
  bounds: CanvasBounds | null,
  viewport: CanvasViewport,
  padding = 48,
): CanvasCamera {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0)) {
    return { x: 0, y: 0, zoom: 1 };
  }
  if (!(bounds.width > 0) || !(bounds.height > 0)) return { x: 0, y: 0, zoom: 1 };
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const zoom = clampCanvasZoom(Math.min(
    availableWidth / bounds.width,
    availableHeight / bounds.height,
    1,
  ));
  return {
    x: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

export function screenToCanvas(
  camera: CanvasCamera,
  point: { x: number; y: number },
): { x: number; y: number } {
  if (camera.zoom === 0) return { x: point.x, y: point.y };
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}
