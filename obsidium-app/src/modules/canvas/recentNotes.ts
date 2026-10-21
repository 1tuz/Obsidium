import { getBaseRows } from '../bases/gateway';
import { existingFiles, isMarkdownPath } from '../documents/fileGateway';
import { comparablePath, fileName, fileStem, parentDirectory, relativePath } from '../paths';
import { loadNavigationHistory } from '../workspace/uiPersist';

export interface CanvasRecentNote {
  path: string;
  title: string;
  folder: string;
}

export const CANVAS_RECENT_NOTES_LIMIT = 20;

export async function loadRecentCanvasNotes(
  workspacePath: string,
  limit = CANVAS_RECENT_NOTES_LIMIT,
): Promise<CanvasRecentNote[]> {
  if (limit <= 0) return [];
  const history = loadNavigationHistory(workspacePath);
  const seen = new Set<string>();
  const visited: string[] = [];
  for (let index = history.index; index >= 0 && visited.length < limit; index -= 1) {
    const path = history.entries[index];
    if (!path || !isMarkdownPath(path)) continue;
    const key = comparablePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    visited.push(path);
  }

  let paths: string[];
  try {
    paths = await existingFiles(visited);
  } catch {
    paths = visited;
  }

  if (paths.length < limit) {
    try {
      for (const row of await getBaseRows(workspacePath)) {
        if (paths.length >= limit) break;
        if (!isMarkdownPath(row.path)) continue;
        const key = comparablePath(row.path);
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push(row.path);
      }
    } catch {
      return paths.map((path) => describeNote(workspacePath, path));
    }
  }

  return paths.map((path) => describeNote(workspacePath, path));
}

function describeNote(workspacePath: string, path: string): CanvasRecentNote {
  let relative = '';
  try {
    relative = relativePath(workspacePath, path);
  } catch {
    relative = '';
  }
  return {
    path,
    title: fileStem(path) || fileName(path),
    folder: parentDirectory(relative),
  };
}
