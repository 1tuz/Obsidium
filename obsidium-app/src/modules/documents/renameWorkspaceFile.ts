import { isFileCommandError, renameFile, writeFileAtomic } from './fileGateway';
import { fileStem, siblingPath } from '../paths';
import { sanitizeFileName } from './documentFactory';

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return dot > separator ? path.slice(dot) : '';
}

export async function renameWorkspaceFile(
  oldPath: string,
  newStem: string,
  transformContent?: (content: string, stem: string) => string,
): Promise<string | null> {
  const stem = sanitizeFileName(newStem);
  if (!stem || stem === fileStem(oldPath)) return null;
  const newPath = siblingPath(oldPath, `${stem}${extensionOf(oldPath)}`);
  const renamed = await renameFile(oldPath, newPath);
  if (transformContent) {
    const content = transformContent(renamed.content, stem);
    if (content !== renamed.content) await writeFileAtomic(newPath, content, renamed.hash);
  }
  return newPath;
}

export async function moveWorkspaceEntry(from: string, to: string): Promise<void> {
  await renameFile(from, to);
}

export function isRenameConflict(error: unknown): boolean {
  return isFileCommandError(error, 'already_exists');
}
