import { isRenameConflict, moveWorkspaceEntry } from '../../modules/documents/renameWorkspaceFile';
import {
  childPath,
  claimNumberedPath,
  fileName,
  isInsidePath,
  parentDirectory,
  samePath,
} from '../../modules/paths';

export async function moveIntoFolder(sourceId: string, targetFolderId: string): Promise<string | null> {
  if (!sourceId || !targetFolderId || samePath(sourceId, targetFolderId)
    || samePath(parentDirectory(sourceId), targetFolderId)
    || isInsidePath(targetFolderId, sourceId)) return null;

  return claimNumberedPath(
    childPath(targetFolderId, fileName(sourceId)),
    (candidate) => moveWorkspaceEntry(sourceId, candidate),
    isRenameConflict,
  );
}
