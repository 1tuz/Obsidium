import type { CanvasCamera } from './viewport';

type CanvasFlush = () => Promise<boolean>;

const flushers = new Set<CanvasFlush>();
const cameraMemory = new Map<string, CanvasCamera>();

export function registerCanvasFlush(flush: CanvasFlush): () => void {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}

export async function flushCanvasDocuments(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((flush) => flush()));
  return results.every(Boolean);
}

export function rememberCanvasCamera(path: string, camera: CanvasCamera): void {
  cameraMemory.set(path, { x: camera.x, y: camera.y, zoom: camera.zoom });
}

export function recalledCanvasCamera(path: string): CanvasCamera | null {
  const camera = cameraMemory.get(path);
  return camera ? { x: camera.x, y: camera.y, zoom: camera.zoom } : null;
}

export function forgetCanvasCamera(path: string): void {
  cameraMemory.delete(path);
}
