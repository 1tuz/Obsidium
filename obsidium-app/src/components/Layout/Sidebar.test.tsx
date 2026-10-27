// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import type { WorkspaceItem } from '../../modules/documents/fileGateway';

vi.mock('../Common/DeleteNotesDialog', () => ({ DeleteNotesDialog: () => null }));
vi.mock('./SidebarFooter', () => ({ SidebarFooter: () => null }));
vi.mock('./FileTree', () => ({ FileTree: () => <div className="q-file-tree" /> }));
vi.mock('./BoardsPanel', () => ({ BoardsPanel: () => null }));
vi.mock('./CalendarPanel', () => ({ CalendarPanel: () => null }));
vi.mock('./CanvasPanel', () => ({ CanvasPanel: () => null }));
vi.mock('./SpaceSwitcher', () => ({ SpaceSwitcher: () => null }));
vi.mock('../Spaces/SpacesDialog', () => ({ SpacesDialog: () => null }));
vi.mock('../../modules/workspace/uiPersist', () => ({
  useExpandedFolders: () => ({
    expandedFolders: new Set<string>(),
    setExpandedFolders: vi.fn(),
    followFolder: vi.fn(),
  }),
}));
vi.mock('../../modules/settings', () => ({
  DEFAULT_BUILTINS: { iconize: false, iconAssignments: {} },
  useSettingsStore: () => ({ config: null, updateConfig: vi.fn() }),
}));
vi.mock('./useFileSelection', () => ({
  useFileSelection: () => ({
    selectedFiles: new Set<string>(),
    rowActions: {
      selectFile: vi.fn(),
      openInNewTab: vi.fn(),
      focusRow: vi.fn(),
    },
    targetsFor: (path: string) => [path],
    clearSelection: vi.fn(),
  }),
}));
vi.mock('./useFileDragAndDrop', () => ({ useFileTreeDrag: vi.fn() }));
vi.mock('../../modules/documents/documentFactory', () => ({
  createUniqueFile: vi.fn(),
  sanitizeFileName: (value: string) => value,
}));
vi.mock('../../modules/documents/folderFactory', () => ({ createUniqueFolder: vi.fn() }));

const { createUniqueFile } = await import('../../modules/documents/documentFactory');
const { Sidebar } = await import('./Sidebar');

const props = {
  activeFile: null,
  files: [],
  directories: new Map<string, WorkspaceItem[]>([['/vault', []]]),
  loadingDirectories: new Set<string>(),
  workspacePath: '/vault',
  workspaceName: 'Vault',
  onFileSelect: vi.fn(),
  onLoadDirectory: vi.fn(async () => true),
  isOpen: true,
  onOpenSettings: vi.fn(),
  onOpenWorkspaces: vi.fn(),
  onToggleTheme: vi.fn(),
  onOpenBaseView: vi.fn(),
  onOpenCanvas: vi.fn(),
  onCreateCanvas: vi.fn(),
  onBoardActionRequestComplete: vi.fn(),
  createBoardRequest: 0,
};

describe('Sidebar file creation', () => {
  let mounted: MountedDom | null = null;

  afterEach(() => {
    if (mounted) act(() => mounted?.unmount());
    mounted = null;
    vi.clearAllMocks();
  });

  it('opens root creation actions from blank content outside the file tree', () => {
    act(() => { mounted = mountDom(<Sidebar {...props} />); });

    act(() => {
      mounted!.container.querySelector('.q-sidebar-content')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }));
    });

    expect(Array.from(document.querySelectorAll('.q-menu__item-label'), (node) => node.textContent))
      .toEqual([t('fileTree.createNote'), t('fileTree.createFolder')]);
  });

  it('opens root creation actions from blank space elsewhere in the Files panel', () => {
    act(() => { mounted = mountDom(<Sidebar {...props} />); });

    act(() => {
      mounted!.container.querySelector('.q-panel-header')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }));
    });

    expect(Array.from(document.querySelectorAll('.q-menu__item-label'), (node) => node.textContent))
      .toEqual([t('fileTree.createNote'), t('fileTree.createFolder')]);
  });

  it('does not open root actions when right-clicking a panel control', () => {
    act(() => { mounted = mountDom(<Sidebar {...props} />); });

    act(() => {
      mounted!.container.querySelector('.q-sidebar-header-actions button')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }));
    });

    expect(document.querySelector('.q-menu')).toBeNull();
  });

  it('routes the header note button through creation in the current root', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    act(() => { mounted = mountDom(<Sidebar {...props} />); });

    await actAndSettle(() => {
      mounted!.container.querySelector<HTMLButtonElement>('.q-sidebar-header-actions button')!.click();
    });

    expect(createUniqueFile).toHaveBeenCalledWith('/vault');
    expect(props.onLoadDirectory).toHaveBeenCalledWith('/vault');
    expect(props.onFileSelect).toHaveBeenCalledWith('/vault/Без названия.md');
  });
});
