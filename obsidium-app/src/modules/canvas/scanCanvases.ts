import { isCanvasPath, type WorkspaceItem } from '../documents/fileGateway';
import { parentDirectory, relativePath } from '../paths';

export interface VaultCanvas {
  path: string;
  name: string;
  folder: string;
}

export async function scanCanvases(
  root: string,
  readDirectory: (path: string) => Promise<WorkspaceItem[]>,
  isCancelled: () => boolean = () => false,
): Promise<VaultCanvas[]> {
  const found: VaultCanvas[] = [];
  const visited = new Set<string>();

  const visit = async (directory: string): Promise<void> => {
    if (visited.has(directory) || isCancelled()) return;
    visited.add(directory);
    for (const item of await readDirectory(directory)) {
      if (isCancelled()) return;
      if (item.type === 'folder') {
        await visit(item.id);
        continue;
      }
      if (!isCanvasPath(item.id)) continue;
      const file = item.id.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? item.id;
      let folder = '';
      try {
        folder = parentDirectory(relativePath(root, item.id));
      } catch {
        folder = '';
      }
      found.push({ path: item.id, name: file.replace(/\.canvas$/i, ''), folder });
    }
  };

  await visit(root);
  return found.sort((left, right) => (
    left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  ));
}
