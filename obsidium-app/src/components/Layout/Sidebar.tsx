import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceItem } from '../../modules/documents/fileGateway';
import { DeleteNotesDialog } from '../Common/DeleteNotesDialog';
import { FileTree } from './FileTree';
import { SidebarFooter } from './SidebarFooter';
import { buildVisibleFileRows, unloadedExpandedFolders, type FileTreeActions } from './fileTreeModel';
import type { LinkDisposition } from '../../modules/links';
import { useExpandedFolders } from '../../modules/workspace/uiPersist';
import { useSettingsStore, DEFAULT_BUILTINS } from '../../modules/settings';
import { setFileIcon, rebaseFileIcons, type FileIconAssignment } from './iconize';
import { moveIntoFolder } from './moveIntoFolder';
import { useFileTreeDrag } from './useFileDragAndDrop';
import { useFileSelection } from './useFileSelection';
import { useFileTreeActions } from './useFileTreeActions';
import { useStableCallback } from '../../hooks/useStableCallback';
import './Sidebar.css';
import { BoardsPanel, type BoardActionRequest } from './BoardsPanel';
import { CalendarPanel } from './CalendarPanel';
import { CanvasPanel } from './CanvasPanel';
import { SidebarHeaderActions } from './SidebarHeaderActions';
import { SpaceSwitcher } from './SpaceSwitcher';
import { SpacesDialog } from '../Spaces/SpacesDialog';
import { DEFAULT_SPACE_ID, isWholeVaultSpace, type Space } from '../../modules/spaces';
import { t } from '../../i18n';
import { rootActionItems } from './fileActionItems';
import { Menu } from '../Common/Menu';
import { useContextMenu } from '../Common/useContextMenu';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { TemplateDialog } from '../Templates/TemplateDialog';
import { copyText } from '../../modules/clipboard';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { readTemplate, type NoteTemplate } from '../../modules/templates';
import { absolutePath, comparablePath, relativePath } from '../../modules/paths';

function creationRootForSpace(workspacePath: string | null, spaces?: SpacesControls): string | null {
  if (!workspacePath) return null;
  if (!spaces || spaces.activeSpaceId === DEFAULT_SPACE_ID) return workspacePath;
  const activeSpace = spaces.spaces.find((space) => space.id === spaces.activeSpaceId);
  if (!activeSpace) return null;
  const relativeRoot = activeSpace.root.replace(/\\/g, '/');
  if (!relativeRoot) return workspacePath;
  if (/^(?:[a-z]:|\/)/i.test(relativeRoot)) return null;
  const segments = relativeRoot.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  return absolutePath(workspacePath, segments.join('/'));
}

export interface SpacesControls {
  spaces: Space[];
  activeSpaceId: string;
  onSelect: (id: string) => void;
  onSave: (space: Space) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface SidebarProps {
  activeFile: string | null;
  files: WorkspaceItem[];
  directories: ReadonlyMap<string, WorkspaceItem[]>;
  loadingDirectories: ReadonlySet<string>;
  workspacePath: string | null;
  workspaceName: string;
  onFileSelect: (path: string, options?: { disposition?: LinkDisposition }) => void;
  onOpenFile?: (path: string) => void;
  onOpenInRight?: (path: string) => void;
  onOpenHistory?: (path: string) => void;
  onSearch?: (initialQuery?: string) => void;
  onCreateCanvasIn?: (folder: string) => void | Promise<void>;
  onCreateBaseIn?: (folder: string) => void | Promise<void>;
  onLoadDirectory: (path: string) => Promise<boolean | void>;
  isOpen: boolean;
  onOpenSettings: () => void;
  onOpenWorkspaces: () => void;
  onToggleTheme: (origin: HTMLElement) => void;
  onPatchFileInTree?: (path: string, patch: { id?: string; name?: string }) => void;
  panel?: 'files' | 'boards' | 'calendar' | 'canvas';
  onOpenBaseView: (path: string, viewIndex: number) => void;
  onOpenCanvas: (path: string) => void;
  onCreateCanvas: () => void;
  onOpenAsText?: (path: string) => void;
  onBoardRenamed?: (oldPath: string, newPath: string) => void;
  boardActionRequest?: BoardActionRequest | null;
  onBoardActionRequestComplete: () => void;
  createBoardRequest: number;
  onAddToBoard?: (path: string) => void;
  onRemoveFromBoard?: (path: string) => void;
  spaces?: SpacesControls;
  templateFolder?: string;
}

export const Sidebar = memo(function Sidebar({
  activeFile,
  files,
  directories,
  loadingDirectories,
  workspacePath,
  workspaceName,
  onFileSelect,
  onOpenFile,
  onOpenInRight,
  onOpenHistory,
  onSearch,
  onCreateCanvasIn,
  onCreateBaseIn,
  onLoadDirectory,
  isOpen,
  onOpenSettings,
  onOpenWorkspaces,
  onToggleTheme,
  onPatchFileInTree,
  panel = 'files',
  onOpenBaseView,
  onOpenCanvas,
  onCreateCanvas,
  onOpenAsText,
  onBoardRenamed,
  boardActionRequest,
  onBoardActionRequestComplete,
  createBoardRequest,
  onAddToBoard,
  onRemoveFromBoard,
  spaces,
  templateFolder = '',
}: SidebarProps) {
  const [spacesDialogOpen, setSpacesDialogOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [templateTarget, setTemplateTarget] = useState<string | null>(null);
  const { expandedFolders, setExpandedFolders, followFolder } = useExpandedFolders(workspacePath);
  const { config, updateConfig } = useSettingsStore();
  const configRef = useRef(config);
  configRef.current = config;
  const builtins = config?.builtins ?? DEFAULT_BUILTINS;
  const iconizeEnabled = Boolean(config) && builtins.iconize;
  const iconAssignments = workspacePath
    ? builtins.iconAssignments?.[workspacePath] ?? {}
    : {};
  const updateIconAssignments = useStableCallback((
    update: (current: Record<string, FileIconAssignment>) => Record<string, FileIconAssignment>,
  ) => {
    const current = configRef.current;
    if (!current || !workspacePath) return;
    const settings = current.builtins ?? DEFAULT_BUILTINS;
    const assignments = update(settings.iconAssignments[workspacePath] ?? {});
    const next = {
      ...current,
      builtins: {
        ...settings,
        iconAssignments: { ...settings.iconAssignments, [workspacePath]: assignments },
      },
    };
    configRef.current = next;
    void updateConfig(next).catch((error) => {
      console.error('Failed to save file icon settings', error);
    });
  });
  const updateIcon = useStableCallback((path: string, icon: FileIconAssignment | null) => {
    updateIconAssignments((current) => setFileIcon(current, path, icon));
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const rootMenu = useContextMenu();
  const pendingScrollTopRef = useRef<number | null>(null);
  const treeReady = Boolean(workspacePath && directories.has(workspacePath));
  const baseRows = useMemo(() => {
    if (!treeReady) return [];
    return buildVisibleFileRows(files, directories, expandedFolders, loadingDirectories);
  }, [directories, expandedFolders, files, loadingDirectories, treeReady]);

  const { selectedFiles, rowActions: selectionActions, targetsFor, clearSelection } = useFileSelection(
    activeFile,
    baseRows,
    onFileSelect,
  );
  const activeSpace = spaces?.spaces.find((space) => space.id === spaces.activeSpaceId) ?? null;
  const creationRootPath = creationRootForSpace(workspacePath, spaces);
  const filteredSpace = activeSpace !== null && !isWholeVaultSpace(activeSpace);
  const allowedMoveFolders = useMemo(() => filteredSpace
    ? new Set([...directories.keys()].map(comparablePath))
    : null, [directories, filteredSpace]);
  const fileOps = useFileTreeActions({
    workspacePath,
    targetsFor,
    creationScope: spaces?.activeSpaceId ?? null,
    clearSelection,
    onPatchFileInTree,
    onDirectoryChanged: async (folder) => {
      setExpandedFolders((current) => (current.has(folder) ? current : new Set(current).add(folder)));
      if (!filteredSpace) return onLoadDirectory(folder);
      return undefined;
    },
    onOpenCreated: (path) => onFileSelect(path),
    onPathMoved: (from, to) => {
      followFolder(from, to);
      updateIconAssignments((current) => rebaseFileIcons(current, from, to));
    },
  });

  const rows = useMemo(() => fileOps.createdItem
    ? buildVisibleFileRows(
      files,
      directories,
      expandedFolders,
      loadingDirectories,
      workspacePath,
      fileOps.createdItem,
    )
    : baseRows,
  [baseRows, directories, expandedFolders, fileOps.createdItem, files, loadingDirectories, workspacePath]);
  const visibleFilePaths = useMemo(() => new Set(rows
    .filter((row) => row.item.type === 'file')
    .map((row) => comparablePath(row.item.id))), [rows]);
  const visiblePaths = useMemo(() => new Set(rows.map((row) => comparablePath(row.item.id))), [rows]);

  const movePaths = useStableCallback(async (sourcePaths: readonly string[], targetId: string) => {
    let anyMoved = false;
    let firstError: unknown;
    const failedPaths: string[] = [];
    for (const fileId of sourcePaths) {
      try {
        const moved = await moveIntoFolder(fileId, targetId);
        if (!moved) {
          failedPaths.push(fileId);
          continue;
        }
        anyMoved = true;
        followFolder(fileId, moved);
        updateIconAssignments((current) => rebaseFileIcons(current, fileId, moved));
      } catch (error) {
        console.error(`Move failed for ${fileId}`, error);
        firstError ??= error;
        failedPaths.push(fileId);
      }
    }

    if (anyMoved) {
      setExpandedFolders((prev) => (
        prev.has(targetId) ? prev : new Set(prev).add(targetId)
      ));
      clearSelection();
      if (!filteredSpace) {
        void onLoadDirectory(targetId).catch((error) => {
          console.error(`Failed to refresh moved folder ${targetId}`, error);
          setMoveError(t('fileTree.moveFailed', { reason: String(error) }));
        });
      }
    }
    return { failedPaths, error: firstError };
  });

  const moveFiles = useStableCallback(async (sourceId: string, targetId: string) => {
    setMoveError(null);
    const { failedPaths, error } = await movePaths(targetsFor(sourceId), targetId);
    if (failedPaths.length > 0) {
      setMoveError(t('fileTree.moveFailed', {
        reason: error ? String(error) : failedPaths.join(', '),
      }));
    }
  });

  const requestMoveToFolder = useStableCallback((path: string) => {
    const targets = targetsFor(path);
    if (!creationRootPath || targets.length === 0) return;
    setMoveError(null);
    setMoveTargets(targets);
  });

  const createTemplateIn = useStableCallback((folder: string) => {
    setTemplateTarget(folder);
  });

  const selectTemplate = useStableCallback(async (template: NoteTemplate) => {
    if (!templateTarget) return;
    const folder = templateTarget;
    const content = await readTemplate(template);
    await fileOps.rowActions.createNoteIn?.(folder, content);
    setTemplateTarget(null);
  });

  useEffect(() => {
    clearSelection();
    setMoveTargets([]);
    setMoveError(null);
    setTemplateTarget(null);
    rootMenu.close();
  }, [clearSelection, creationRootPath, rootMenu.close, spaces?.activeSpaceId, workspacePath]);

  const toggleFolder = useStableCallback((id: string) => {
    pendingScrollTopRef.current = contentRef.current?.scrollTop ?? null;
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (!current.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  });

  const loadRevealedFolders = useStableCallback(() => {
    for (const id of unloadedExpandedFolders(rows, directories)) void onLoadDirectory(id);
  });

  useEffect(loadRevealedFolders, [directories, expandedFolders, loadRevealedFolders]);

  const prefetchFolder = useStableCallback((id: string) => {
    if (!directories.has(id)) void onLoadDirectory(id);
  });

  useFileTreeDrag(contentRef, targetsFor, moveFiles);

  const treeActions = useMemo<FileTreeActions>(() => ({
    ...selectionActions,
    ...fileOps.rowActions,
    targetsFor,
    openFile: onOpenFile ?? onFileSelect,
    openInRight: onOpenInRight,
    openHistory: onOpenHistory,
    canDuplicateSelection: (path) => targetsFor(path).every((target) => visibleFilePaths.has(comparablePath(target))),
    canMoveSelection: (path) => targetsFor(path).every((target) => visiblePaths.has(comparablePath(target))),
    copyPath: (path) => {
      if (!workspacePath) return;
      try {
        void copyText(relativePath(workspacePath, path));
      } catch (error) {
        console.error('Failed to copy file path', error);
      }
    },
    copyPaths: (path) => {
      if (!workspacePath) return;
      try {
        const paths = targetsFor(path).map((target) => relativePath(workspacePath, target));
        void copyText(paths.join('\n'));
      } catch (error) {
        console.error('Failed to copy selected file paths', error);
      }
    },
    copyInternalLink: (path) => {
      if (!workspacePath) return;
      const target = relativePath(workspacePath, path).replace(/\.md$/i, '');
      void copyText(`[[${target}]]`);
    },
    reveal: (path) => {
      void revealItemInDir(path).catch((error) => console.error('Failed to reveal file', error));
    },
    revealWorkspace: () => {
      if (workspacePath) {
        void revealItemInDir(workspacePath).catch((error) => console.error('Failed to reveal workspace', error));
      }
    },
    collapseFolders: () => setExpandedFolders(new Set()),
    searchVault: () => onSearch?.(),
    searchInFolder: (path) => {
      if (workspacePath) onSearch?.(`folder:"${relativePath(workspacePath, path)}"`);
    },
    moveToFolder: requestMoveToFolder,
    createCanvasIn: onCreateCanvasIn,
    createBaseIn: onCreateBaseIn,
    createTemplateIn,
    addToBoard: onAddToBoard,
    removeFromBoard: onRemoveFromBoard,
    openAsText: onOpenAsText,
    toggleFolder,
    prefetchFolder,
  }), [
    createTemplateIn,
    onCreateBaseIn,
    onCreateCanvasIn,
    fileOps.rowActions,
    onAddToBoard,
    onFileSelect,
    onOpenFile,
    onOpenHistory,
    onOpenInRight,
    onOpenAsText,
    onSearch,
    onRemoveFromBoard,
    prefetchFolder,
    requestMoveToFolder,
    selectionActions,
    setExpandedFolders,
    targetsFor,
    toggleFolder,
    visibleFilePaths,
    visiblePaths,
    workspacePath,
  ]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const item = content?.querySelector<HTMLElement>('[data-file-active="true"]');
    if (!item || !content) return;

    const contentRect = content.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < contentRect.top) {
      content.scrollTop -= contentRect.top - itemRect.top;
    } else if (itemRect.bottom > contentRect.bottom) {
      content.scrollTop += itemRect.bottom - contentRect.bottom;
    }
  }, [activeFile]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const scrollTop = pendingScrollTopRef.current;
    if (!content || scrollTop === null) return;
    content.scrollTop = scrollTop;
    pendingScrollTopRef.current = null;
  }, [expandedFolders]);

  const { deleteTargets } = fileOps;

  return (
    <aside
      className={`q-collapsible-panel q-sidebar ${isOpen ? '' : 'is-collapsed'}`}
      aria-hidden={!isOpen}
      onContextMenu={(event) => {
        if (panel !== 'files' || !creationRootPath) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(
          '[data-file-id], .q-file-tree, button, input, textarea, select, [role="button"], [data-space-switcher]',
        )) return;
        rootMenu.onContextMenu(event);
      }}
    >
      <div className="q-panel-header" data-tauri-drag-region aria-hidden="true">
      </div>
      {panel === 'files' && workspacePath ? (
        <SidebarHeaderActions
          disabled={!creationRootPath}
          onCreateNote={() => creationRootPath && void fileOps.rowActions.createNoteIn?.(creationRootPath)}
          onCreateFolder={() => creationRootPath && void fileOps.rowActions.createFolderIn?.(creationRootPath)}
        />
      ) : null}
      {spaces && panel === 'files' ? (
        <SpaceSwitcher
          spaces={spaces.spaces}
          activeSpaceId={spaces.activeSpaceId}
          onSelect={spaces.onSelect}
          onManage={() => setSpacesDialogOpen(true)}
        />
      ) : null}
      <div
        ref={contentRef}
        className="q-sidebar-content"
      >
        <div hidden={panel !== 'files'}>
        {!treeReady ? null : (
          <FileTree
            key={`${workspacePath}:${spaces?.activeSpaceId ?? DEFAULT_SPACE_ID}`}
            rows={rows}
            activeFile={activeFile}
            selectedFiles={selectedFiles}
            renamingPath={fileOps.renamingPath}
            actions={treeActions}
            rootPath={creationRootPath}
            error={fileOps.createError ?? moveError}
            icons={iconizeEnabled ? iconAssignments : undefined}
            onIconChange={iconizeEnabled ? updateIcon : undefined}
          />
        )}
        </div>
        <div hidden={panel !== 'boards'} className="q-sidebar-boards">
          <BoardsPanel
            active={isOpen && panel === 'boards'}
            workspacePath={workspacePath}
            onOpenView={onOpenBaseView}
            onBoardRenamed={onBoardRenamed}
            actionRequest={boardActionRequest ?? null}
            onActionRequestComplete={onBoardActionRequestComplete}
            createRequest={createBoardRequest}
          />
        </div>
        <div hidden={panel !== 'calendar'} className="q-sidebar-calendar">
          <CalendarPanel
            active={isOpen && panel === 'calendar'}
            workspacePath={workspacePath}
            onOpenView={onOpenBaseView}
          />
        </div>
        <div hidden={panel !== 'canvas'} className="q-sidebar-canvas">
          <CanvasPanel
            active={isOpen && panel === 'canvas'}
            workspacePath={workspacePath}
            onOpenCanvas={onOpenCanvas}
            onCreateCanvas={onCreateCanvas}
          />
        </div>
      </div>

      {panel === 'files' && creationRootPath && rootMenu.open && (
        <Menu
          open
          position={rootMenu.position}
          items={rootActionItems(treeActions, creationRootPath)}
          onClose={rootMenu.close}
          ariaLabel={t('fileTree.rootActions')}
        />
      )}

      {spaces ? (
        <SpacesDialog
          open={spacesDialogOpen}
          workspacePath={workspacePath}
          spaces={spaces.spaces}
          onClose={() => setSpacesDialogOpen(false)}
          onSave={spaces.onSave}
          onDelete={spaces.onDelete}
        />
      ) : null}

      <MoveToFolderDialog
        open={moveTargets.length > 0}
        workspacePath={workspacePath}
        rootFolder={creationRootPath}
        targets={moveTargets}
        allowedFolders={allowedMoveFolders}
        onClose={() => setMoveTargets([])}
        onMove={async (folder) => {
          setMoveError(null);
          const { failedPaths, error } = await movePaths(moveTargets, folder);
          if (failedPaths.length > 0) {
            setMoveTargets(failedPaths);
            throw error ?? new Error(failedPaths.join(', '));
          }
          setMoveTargets([]);
        }}
      />

      <TemplateDialog
        open={templateTarget !== null}
        workspacePath={workspacePath}
        folder={templateFolder}
        onClose={() => setTemplateTarget(null)}
        onSelect={selectTemplate}
      />

      <DeleteNotesDialog
        targets={deleteTargets}
        pending={fileOps.isDeleting}
        error={fileOps.deleteError}
        onCancel={fileOps.dismissDelete}
        onConfirm={fileOps.confirmDelete}
      />

      <SidebarFooter
        workspaceName={workspaceName}
        workspacePath={workspacePath}
        onOpenSettings={onOpenSettings}
        onOpenWorkspaces={onOpenWorkspaces}
        onToggleTheme={onToggleTheme}
      />
    </aside>
  );
});
