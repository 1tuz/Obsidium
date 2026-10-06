import { flushDocumentsUnder, getManagedWriterForPath, getOpenDoc } from '../docs';
import {
  applyTextEdits,
  documentText,
  forgetSyncRecord,
  mergeExternalChange,
  writeSyncRecord,
} from '../docSync';
import { clearLocalDoc } from '../sync';
import type * as Y from 'yjs';
import {
  isFileCommandError,
  readFileSnapshot,
  renameFile,
  type FileRenameResult,
} from './fileGateway';
import { fileStem, samePath, siblingPath } from '../paths';
import { sanitizeFileName } from './documentFactory';

function adoptFileText(doc: Y.Doc, next: string): void {
  const current = documentText(doc).toString();
  applyTextEdits(doc, mergeExternalChange(current, next, current).edits);
}

export async function renameWorkspaceFile(
  oldPath: string,
  newStem: string,
): Promise<string | null> {
  const current = fileStem(oldPath);
  const stem = sanitizeFileName(newStem);
  if (!stem || stem === current) return null;

  const newPath = siblingPath(oldPath, `${stem}.md`);
  const writer = getManagedWriterForPath(oldPath);
  const result: FileRenameResult = writer
    ? await writer.rename(newPath)
    : await renameFile(oldPath, newPath);

  await Promise.all(result.updatedPaths
    .filter((path) => !samePath(path, newPath))
    .map(async (path) => {
      const openDoc = getOpenDoc(path);
      if (!openDoc) {
        await Promise.all([clearLocalDoc(path), forgetSyncRecord(path)]);
        return;
      }
      const snapshot = await readFileSnapshot(path);
      adoptFileText(openDoc, snapshot.content);
      getManagedWriterForPath(path)?.adopt(snapshot);
      await writeSyncRecord(path, { fileHash: snapshot.hash, textHash: snapshot.textHash });
    }))
    .catch((error) => console.error('Failed to refresh rewritten documents', error));

  const doc = getOpenDoc(oldPath) ?? getOpenDoc(newPath);
  if (doc) {
    adoptFileText(doc, result.content);
    await writeSyncRecord(newPath, { fileHash: result.hash, textHash: result.textHash })
      .catch((error) => console.error('Failed to move the file sync point', error));
  }

  return newPath;
}

export async function moveWorkspaceEntry(from: string, to: string): Promise<void> {
  const writer = getManagedWriterForPath(from);
  if (writer) {
    await writer.rename(to);
    return;
  }
  await flushDocumentsUnder(from);
  await renameFile(from, to);
}

export function isRenameConflict(error: unknown): boolean {
  return isFileCommandError(error, 'already_exists');
}
