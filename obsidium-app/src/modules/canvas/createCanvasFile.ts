import { childPath } from '../paths';
import { createAtFreeName, createFile } from '../documents/fileGateway';

export function createCanvasFile(workspacePath: string): Promise<string | null> {
  return createAtFreeName(
    (attempt) => childPath(workspacePath, `Canvas${attempt ? ` (${attempt})` : ''}.canvas`),
    (path) => createFile(path, JSON.stringify({ nodes: [], edges: [] }, null, 2)),
  ).catch((error: unknown) => {
    console.error('Failed to create Canvas document', error);
    return null;
  });
}
