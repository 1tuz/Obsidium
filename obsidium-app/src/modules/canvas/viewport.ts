export type CanvasCamera = { x: number; y: number; zoom: number };
export type CanvasViewport = { width: number; height: number };
export type CanvasBounds = { x: number; y: number; width: number; height: number };

export const MIN_CANVAS_ZOOM = 0.25;
export const MAX_CANVAS_ZOOM = 2;
export const CANVAS_ZOOM_LEVELS: readonly number[] = [0.25, 0.5, 1, 1.5, 2];
export const CANVAS_VIEW_MARGIN_PX = 200;
export const CANVAS_PAN_PADDING_PX = 100;

export type CanvasZoomDirection = 1 | -1;

const ZOOM_EPSILON = 1e-6;

export function clampCanvasZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function nextCanvasZoom(zoom: number, direction: CanvasZoomDirection): number {
  if (!Number.isFinite(zoom)) return 1;
  if (direction > 0) {
    for (const level of CANVAS_ZOOM_LEVELS) {
      if (level > zoom + ZOOM_EPSILON) return level;
    }
    return MAX_CANVAS_ZOOM;
  }
  for (let index = CANVAS_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const level = CANVAS_ZOOM_LEVELS[index];
    if (level < zoom - ZOOM_EPSILON) return level;
  }
  return MIN_CANVAS_ZOOM;
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

export function canvasVisibleBounds(
  camera: CanvasCamera,
  viewport: CanvasViewport,
  margin = 0,
): CanvasBounds | null {
  if (!(viewport.width > 0) || !(viewport.height > 0) || !(camera.zoom > 0)) return null;
  const left = -camera.x / camera.zoom;
  const top = -camera.y / camera.zoom;
  const right = (viewport.width - camera.x) / camera.zoom;
  const bottom = (viewport.height - camera.y) / camera.zoom;
  return {
    x: left - margin,
    y: top - margin,
    width: right - left + 2 * margin,
    height: bottom - top + 2 * margin,
  };
}

export function canvasNodeVisible(
  node: { x: number; y: number; width: number; height: number },
  bounds: CanvasBounds,
): boolean {
  return (
    node.x + node.width >= bounds.x
    && node.x <= bounds.x + bounds.width
    && node.y + node.height >= bounds.y
    && node.y <= bounds.y + bounds.height
  );
}

export function clampCanvasCamera(
  camera: CanvasCamera,
  bounds: CanvasBounds | null,
  viewport: CanvasViewport,
  padding = CANVAS_PAN_PADDING_PX,
): CanvasCamera {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0) || !(camera.zoom > 0)) {
    return camera;
  }
  const zoom = camera.zoom;
  const viewWidth = viewport.width / zoom;
  const viewHeight = viewport.height / zoom;
  const left = clampCanvasViewOrigin(
    -camera.x / zoom,
    bounds.x - padding,
    bounds.x + bounds.width + padding,
    viewWidth,
  );
  const top = clampCanvasViewOrigin(
    -camera.y / zoom,
    bounds.y - padding,
    bounds.y + bounds.height + padding,
    viewHeight,
  );
  const x = -left * zoom;
  const y = -top * zoom;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return camera;
  return { x, y, zoom };
}

function clampCanvasViewOrigin(
  current: number,
  min: number,
  max: number,
  viewSize: number,
): number {
  const origin = Number.isFinite(current) ? current : min;
  if (!(viewSize > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return origin;
  if (max - min >= viewSize) return Math.min(Math.max(origin, min), max - viewSize);
  return (min + max) / 2 - viewSize / 2;
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
