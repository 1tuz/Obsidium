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
import type { Space } from '../../modules/spaces';
import { t } from '../../i18n';
import { rootActionItems } from './fileActionItems';
import { Menu } from '../Common/Menu';
import { useContextMenu } from '../Common/useContextMenu';

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
}

export const Sidebar = memo(function Sidebar({
  activeFile,
  files,
  directories,
  loadingDirectories,
  workspacePath,
  workspaceName,
  onFileSelect,
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
}: SidebarProps) {
  const [spacesDialogOpen, setSpacesDialogOpen] = useState(false);
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
  const fileOps = useFileTreeActions({
    workspacePath,
    targetsFor,
    creationScope: spaces?.activeSpaceId ?? null,
    clearSelection,
    onPatchFileInTree,
    onDirectoryChanged: async (folder) => {
      setExpandedFolders((current) => (current.has(folder) ? current : new Set(current).add(folder)));
      return onLoadDirectory(folder);
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

  const moveFiles = useStableCallback(async (sourceId: string, targetId: string) => {
    let anyMoved = false;
    for (const fileId of targetsFor(sourceId)) {
      const moved = await moveIntoFolder(fileId, targetId);
      if (!moved) continue;
      anyMoved = true;
      followFolder(fileId, moved);
      updateIconAssignments((current) => rebaseFileIcons(current, fileId, moved));
    }

    if (!anyMoved) return;
    setExpandedFolders((prev) => (
      prev.has(targetId) ? prev : new Set(prev).add(targetId)
    ));
    void onLoadDirectory(targetId);
  });

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
    addToBoard: onAddToBoard,
    removeFromBoard: onRemoveFromBoard,
    openAsText: onOpenAsText,
    toggleFolder,
    prefetchFolder,
  }), [fileOps.rowActions, onAddToBoard, onOpenAsText, onRemoveFromBoard, prefetchFolder, selectionActions, toggleFolder]);

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
        if (panel !== 'files' || !workspacePath) return;
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
          onCreateNote={() => void fileOps.rowActions.createNoteIn?.(workspacePath)}
          onCreateFolder={() => void fileOps.rowActions.createFolderIn?.(workspacePath)}
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
            rows={rows}
            activeFile={activeFile}
            selectedFiles={selectedFiles}
            renamingPath={fileOps.renamingPath}
            actions={treeActions}
            rootPath={workspacePath}
            error={fileOps.createError}
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

      {panel === 'files' && workspacePath && rootMenu.open && (
        <Menu
          open
          position={rootMenu.position}
          items={rootActionItems(fileOps.rowActions, workspacePath)}
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

      <DeleteNotesDialog
        targets={deleteTargets}
        pending={fileOps.isDeleting}
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
