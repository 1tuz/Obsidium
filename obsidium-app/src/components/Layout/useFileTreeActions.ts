import { useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { copyFile, isFileCommandError, isMarkdownPath, trashFile } from '../../modules/documents/fileGateway';
import type { WorkspaceItem } from '../../modules/documents/fileGateway';
import { renameFolder } from '../../modules/documents/workspaceFolder';
import {
  isRenameConflict,
  renameWorkspaceFile,
} from '../../modules/documents/renameWorkspaceFile';
import { claimNumberedPath, fileName, fileStem } from '../../modules/paths';
import { useStableCallback } from '../../hooks/useStableCallback';
import { t } from '../../i18n';
import { createUniqueFile, sanitizeFileName } from '../../modules/documents/documentFactory';
import { createUniqueFolder } from '../../modules/documents/folderFactory';

interface FileTreeActionsInput {
  workspacePath: string | null;
  targetsFor: (path: string) => string[];
  clearSelection?: () => void;
  onPatchFileInTree?: (path: string, patch: { id?: string; name?: string }) => void;
  onPathMoved?: (from: string, to: string) => void;
  onDirectoryChanged?: (path: string) => void | boolean | Promise<void | boolean>;
  onOpenCreated?: (path: string) => void;
  creationScope?: string | null;
}

export function useFileTreeActions({
  workspacePath,
  targetsFor,
  clearSelection,
  onPatchFileInTree,
  onPathMoved,
  onDirectoryChanged,
  onOpenCreated,
  creationScope = null,
}: FileTreeActionsInput) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [createdItem, setCreatedItem] = useState<WorkspaceItem | null>(null);
  const [createdItemRefreshed, setCreatedItemRefreshed] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const actionPendingRef = useRef(false);
  const creationGenerationRef = useRef(0);

  useInsertionEffect(() => {
    creationGenerationRef.current += 1;
  }, [creationScope, workspacePath]);

  useEffect(() => {
    setRenamingPath(null);
    setCreatedItem(null);
    setCreatedItemRefreshed(false);
    setCreateError(null);
    setDeleteTargets([]);
    setDeleteError(null);
  }, [creationScope, workspacePath]);

  const startRename = useStableCallback((path: string) => {
    setRenamingPath(path);
  });

  const cancelRename = useStableCallback(() => {
    setRenamingPath(null);
    if (createdItemRefreshed) setCreatedItem(null);
  });

  const commitRename = useStableCallback(async (path: string, nextName: string, isFolder = false) => {
    const isFile = !isFolder;
    const pathName = fileName(path);
    const extension = isFile ? pathName.match(/\.[^.]+$/)?.[0] ?? '' : '';
    const current = isFile && extension ? pathName.slice(0, -extension.length) : pathName;
    const originalName = isMarkdownPath(path) ? current : pathName;
    const trimmed = nextName.trim();
    const name = sanitizeFileName(trimmed);
    setRenamingPath(null);
    setCreateError(null);
    if (!name || name === current) {
      if (createdItem?.id === path && createdItemRefreshed) setCreatedItem(null);
      return;
    }

    const treeName = isMarkdownPath(path) ? name : `${name}${extension}`;
    onPatchFileInTree?.(path, { name: treeName });
    try {
      const newPath = isFile
        ? await renameWorkspaceFile(path, name)
        : await renameFolder(path, name);
      if (newPath) {
        onPathMoved?.(path, newPath);
        setCreatedItem((current) => {
          if (current?.id !== path) return current;
          if (createdItemRefreshed) return null;
          return {
            ...current,
            id: newPath,
            name: isMarkdownPath(newPath) ? fileStem(newPath) : fileName(newPath),
          };
        });
      } else {
        onPatchFileInTree?.(path, { name: originalName });
      }
    } catch (error) {
      onPatchFileInTree?.(path, { name: originalName });
      if (isRenameConflict(error)) {
        setCreateError(t('fileTree.renameConflict', { name }));
      } else {
        console.error('Rename failed', error);
        setCreateError(t('fileTree.renameFailed', { name }));
      }
      setRenamingPath(path);
    }
  });

  const requestDelete = useStableCallback((path: string) => {
    setDeleteTargets(targetsFor(path));
  });

  const dismissDelete = useStableCallback(() => {
    setDeleteTargets([]);
    setDeleteError(null);
  });

  const confirmDelete = useStableCallback(async () => {
    if (actionPendingRef.current || deleteTargets.length === 0) return;
    actionPendingRef.current = true;
    setIsDeleting(true);
    const generation = creationGenerationRef.current;
    const currentWorkspace = workspacePath;
    let completed = 0;
    try {
      setDeleteError(null);
      if (currentWorkspace) {
        for (const path of deleteTargets) {
          if (generation !== creationGenerationRef.current) return;
          try {
            await trashFile(currentWorkspace, path);
            completed += 1;
          } catch (error) {
            console.error(`Delete failed for ${path}`, error);
            if (generation === creationGenerationRef.current) {
              setDeleteTargets(deleteTargets.slice(completed));
              setDeleteError(t('fileTree.deleteFailed', { reason: path }));
              if (completed > 0) clearSelection?.();
            }
            return;
          }
        }
      }
      if (generation !== creationGenerationRef.current) return;
      clearSelection?.();
      setDeleteTargets([]);
      setDeleteError(null);
    } finally {
      actionPendingRef.current = false;
      setIsDeleting(false);
    }
  });

  const duplicateFile = useStableCallback(async (path: string) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    try {
      for (const source of targetsFor(path)) {
        try {
          await claimNumberedPath(
            source,
            (candidate) => copyFile(source, candidate),
            (error) => isFileCommandError(error, 'already_exists'),
            1,
          );
        } catch (error) {
          console.error(`Duplicate failed for ${source}`, error);
        }
      }
    } finally {
      actionPendingRef.current = false;
    }
  });

  const createNoteIn = useStableCallback(async (folder: string, content: string = '') => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    const generation = creationGenerationRef.current;
    setCreateError(null);
    try {
      const created = await createUniqueFile(folder, undefined, content);
      if (generation !== creationGenerationRef.current) return;
      if (!created) {
        setCreateError(t('fileTree.createFailed', { reason: folder }));
        return;
      }
      setCreatedItem({ id: created, name: fileStem(created), type: 'file' });
      setCreatedItemRefreshed(false);
      setRenamingPath(created);
      onOpenCreated?.(created);
      try {
        const refreshed = await onDirectoryChanged?.(folder);
        if (generation !== creationGenerationRef.current) return;
        if (refreshed === false) {
          setCreateError(t('fileTree.createdButRefreshFailed'));
          return;
        }
        setCreatedItemRefreshed(refreshed === true);
      } catch (error) {
        if (generation !== creationGenerationRef.current) return;
        console.error('Failed to refresh created note', error);
        setCreateError(t('fileTree.createdButRefreshFailed'));
        return;
      }
    } catch (error) {
      if (generation !== creationGenerationRef.current) return;
      console.error('Failed to show created note', error);
      setCreateError(t('fileTree.createFailed', { reason: folder }));
    } finally {
      actionPendingRef.current = false;
    }
  });

  const createFolderIn = useStableCallback(async (folder: string) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    const generation = creationGenerationRef.current;
    setCreateError(null);
    try {
      const created = await createUniqueFolder(folder);
      if (generation !== creationGenerationRef.current) return;
      if (!created) {
        setCreateError(t('fileTree.createFailed', { reason: folder }));
        return;
      }
      setCreatedItem({ id: created, name: fileName(created), type: 'folder' });
      setCreatedItemRefreshed(false);
      setRenamingPath(created);
      try {
        const refreshed = await onDirectoryChanged?.(folder);
        if (generation !== creationGenerationRef.current) return;
        if (refreshed === false) {
          setCreateError(t('fileTree.createdButRefreshFailed'));
          return;
        }
        setCreatedItemRefreshed(refreshed === true);
      } catch (error) {
        if (generation !== creationGenerationRef.current) return;
        console.error('Failed to refresh created folder', error);
        setCreateError(t('fileTree.createdButRefreshFailed'));
        return;
      }
    } catch (error) {
      if (generation !== creationGenerationRef.current) return;
      console.error('Failed to show created folder', error);
      setCreateError(t('fileTree.createFailed', { reason: folder }));
    } finally {
      actionPendingRef.current = false;
    }
  });

  const rowActions = useMemo(() => ({
    startRename,
    commitRename,
    cancelRename,
    requestDelete,
    duplicateFile,
    createNoteIn,
    createFolderIn,
  }), [cancelRename, commitRename, createFolderIn, createNoteIn, duplicateFile, requestDelete, startRename]);

  return {
    renamingPath,
    createdItem,
    deleteTargets,
    deleteError,
    isDeleting,
    rowActions,
    confirmDelete,
    dismissDelete,
    createError,
  };
}
