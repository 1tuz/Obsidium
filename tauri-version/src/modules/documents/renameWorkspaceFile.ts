import { isFileCommandError, renameFile, writeFileAtomic } from './fileGateway';
import { fileName, siblingPath } from '../paths';
import { sanitizeFileName } from './documentFactory';

export async function renameWorkspaceFile(
  oldPath: string,
  newStem: string,
  transformContent?: (content: string, stem: string) => string,
): Promise<string | null> {
  const stem = sanitizeFileName(newStem);
  const currentStem = fileName(oldPath).replace(/\.(?:md|base)$/i, '');
  if (!stem || stem === currentStem) return null;
  const extension = oldPath.toLowerCase().endsWith('.base') ? '.base' : '.md';
  const newPath = siblingPath(oldPath, `${stem}${extension}`);
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
