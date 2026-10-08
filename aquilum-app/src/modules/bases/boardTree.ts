import { childPath, relativePath } from '../paths';
import type { KanbanBoard } from './boards';

export interface BoardFolder {
  name: string;
  path: string;
  folders: BoardFolder[];
  boards: KanbanBoard[];
}

export function boardTree(boards: KanbanBoard[], workspacePath: string): BoardFolder {
  const root: BoardFolder = { name: '', path: workspacePath, folders: [], boards: [] };
  for (const board of boards) {
    const parts = relativePath(workspacePath, board.path).replace(/\\/g, '/').split('/');
    const file = parts.pop();
    if (!file) continue;
    let current = root;
    for (const name of parts) {
      let folder = current.folders.find((candidate) => candidate.name === name);
      if (!folder) {
        folder = { name, path: childPath(current.path, name), folders: [], boards: [] };
        current.folders.push(folder);
      }
      current = folder;
    }
    current.boards.push({ ...board, name: file.replace(/\.base$/i, '') });
  }
  return root;
}
