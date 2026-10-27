// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { mountDom, actAndSettle, type MountedDom } from '../../testing/mountDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';

vi.mock('../../modules/documents/documentFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/documents/documentFactory')>();
  return { ...actual, createUniqueFile: vi.fn() };
});
vi.mock('../../modules/documents/folderFactory', () => ({
  createUniqueFolder: vi.fn(),
}));
vi.mock('../../modules/documents/workspaceFolder', () => ({ renameFolder: vi.fn() }));
vi.mock('../../modules/documents/fileGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/documents/fileGateway')>();
  return { ...actual, copyFile: vi.fn(), renameFile: vi.fn(), trashFile: vi.fn() };
});

const { createUniqueFile } = await import('../../modules/documents/documentFactory');
const { createUniqueFolder } = await import('../../modules/documents/folderFactory');
const { renameFile } = await import('../../modules/documents/fileGateway');
const { renameFolder } = await import('../../modules/documents/workspaceFolder');
const { useFileTreeActions } = await import('./useFileTreeActions');

let latest!: ReturnType<typeof useFileTreeActions>;
let creationScope = 'all';
const onDirectoryChanged = vi.fn(async (_folder: string): Promise<boolean | void> => true);
const onOpenCreated = vi.fn();
const renderHook = () => <Harness />;

function Harness() {
  latest = useFileTreeActions({
    workspacePath: '/vault',
    creationScope,
    targetsFor: (path) => [path],
    onDirectoryChanged,
    onOpenCreated,
  });
  return <div data-renaming={latest.renamingPath ?? ''} data-created={latest.createdItem?.id ?? ''} role="alert">{latest.createError}</div>;
}

describe('useFileTreeActions creation', () => {
  let mounted: MountedDom;

  afterEach(() => {
    mounted?.unmount();
    creationScope = 'all';
    vi.clearAllMocks();
  });

  it('loads the parent, opens and starts renaming the new note without its extension', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));

    expect(onDirectoryChanged).toHaveBeenCalledWith('/vault');
    expect(onOpenCreated).toHaveBeenCalledWith('/vault/Без названия.md');
    expect(latest.createdItem).toEqual({ id: '/vault/Без названия.md', name: 'Без названия', type: 'file' });
    expect(mounted.container.firstElementChild?.getAttribute('data-renaming'))
      .toBe('/vault/Без названия.md');
  });

  it('expands and loads the target parent before renaming a new folder', async () => {
    vi.mocked(createUniqueFolder).mockResolvedValue('/vault/Projects/New folder');
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createFolderIn?.('/vault/Projects'));

    expect(onDirectoryChanged).toHaveBeenCalledWith('/vault/Projects');
    expect(onOpenCreated).not.toHaveBeenCalled();
    expect(latest.createdItem).toEqual({ id: '/vault/Projects/New folder', name: 'New folder', type: 'folder' });
    expect(mounted.container.firstElementChild?.getAttribute('data-renaming'))
      .toBe('/vault/Projects/New folder');
  });

  it('drops the temporary row after cancelling a rename once refresh succeeded', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));
    expect(latest.createdItem?.id).toBe('/vault/Без названия.md');

    await actAndSettle(() => latest.rowActions.cancelRename?.());

    expect(latest.renamingPath).toBeNull();
    expect(latest.createdItem).toBeNull();
  });

  it('keeps an item visible through a filtered space refresh and rename', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    vi.mocked(renameFile).mockResolvedValue({
      updatedPaths: [], content: '', hash: 'hash', textHash: 'text-hash',
    });
    onDirectoryChanged.mockResolvedValueOnce(undefined);
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));
    await actAndSettle(() => latest.rowActions.commitRename('/vault/Без названия.md', 'Проект'));

    expect(latest.createdItem).toEqual({ id: '/vault/Проект.md', name: 'Проект', type: 'file' });
    expect(latest.renamingPath).toBeNull();
  });

  it('clears transient creation state when the active space changes', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));
    creationScope = 'projects';
    act(() => { mounted?.update(renderHook()); });

    expect(latest.renamingPath).toBeNull();
    expect(latest.createdItem).toBeNull();
  });

  it('does not attach a pending creation to a newly selected space', async () => {
    let finishCreate!: (path: string | null) => void;
    vi.mocked(createUniqueFile).mockReturnValue(new Promise((resolve) => {
      finishCreate = resolve;
    }));
    act(() => { mounted = mountDom(renderHook()); });

    let pending!: Promise<void>;
    act(() => { pending = latest.rowActions.createNoteIn?.('/vault') ?? Promise.resolve(); });
    creationScope = 'projects';
    act(() => { mounted?.update(renderHook()); });
    await actAndSettle(() => {
      finishCreate('/vault/Без названия.md');
      return pending;
    });

    expect(latest.renamingPath).toBeNull();
    expect(latest.createdItem).toBeNull();
    expect(onOpenCreated).not.toHaveBeenCalled();
  });

  it('keeps the existing item and reopens rename mode on a name conflict', async () => {
    vi.mocked(renameFile).mockRejectedValue({ code: 'already_exists' });
    const patchFileInTree = vi.fn();
    act(() => {
      mounted = mountDom(<HarnessWithPatch patchFileInTree={patchFileInTree} />);
    });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/Existing.md', 'Taken'));

    expect(patchFileInTree).toHaveBeenLastCalledWith('/vault/Existing.md', { name: 'Existing' });
    expect(latest.renamingPath).toBe('/vault/Existing.md');
    expect(latest.createError).toBe(t('fileTree.renameConflict', { name: 'Taken' }));
  });

  it('shows a rename error and reopens the field when a non-conflict error occurs', async () => {
    vi.mocked(renameFile).mockRejectedValue(new Error('disk unavailable'));
    act(() => { mounted = mountDom(<HarnessWithPatch patchFileInTree={vi.fn()} />); });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/Existing.md', 'New name'));

    expect(latest.renamingPath).toBe('/vault/Existing.md');
    expect(latest.createError).toBe(t('fileTree.renameFailed', { name: 'New name' }));
  });

  it('preserves the .base extension and strips it from the rename field value', async () => {
    vi.mocked(renameFile).mockResolvedValue({
      updatedPaths: [], content: '', hash: 'hash', textHash: 'text-hash',
    });
    act(() => { mounted = mountDom(<HarnessWithPatch patchFileInTree={vi.fn()} />); });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/Old.base', 'Roadmap'));

    expect(renameFile).toHaveBeenCalledWith('/vault/Old.base', '/vault/Roadmap.base');
  });

  it('restores the full .base tree label after a name conflict', async () => {
    vi.mocked(renameFile).mockRejectedValue({ code: 'already_exists' });
    const patchFileInTree = vi.fn();
    act(() => { mounted = mountDom(<HarnessWithPatch patchFileInTree={patchFileInTree} />); });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/Old.base', 'Roadmap'));

    expect(patchFileInTree).toHaveBeenLastCalledWith('/vault/Old.base', { name: 'Old.base' });
    expect(latest.renamingPath).toBe('/vault/Old.base');
  });

  it('renames other files while preserving their extension and tree label', async () => {
    vi.mocked(renameFile).mockResolvedValue({
      updatedPaths: [], content: '', hash: 'hash', textHash: 'text-hash',
    });
    const patchFileInTree = vi.fn();
    act(() => { mounted = mountDom(<HarnessWithPatch patchFileInTree={patchFileInTree} />); });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/diagram.png', 'diagram-final'));

    expect(renameFile).toHaveBeenCalledWith('/vault/diagram.png', '/vault/diagram-final.png');
    expect(patchFileInTree).toHaveBeenCalledWith('/vault/diagram.png', { name: 'diagram-final.png' });
  });

  it('sanitizes folder names before passing them to the folder rename command', async () => {
    vi.mocked(renameFolder).mockResolvedValue('/vault/Draft Notes');
    act(() => { mounted = mountDom(<HarnessWithPatch patchFileInTree={vi.fn()} />); });

    await actAndSettle(() => latest.rowActions.commitRename('/vault/Projects', 'Draft/Notes', true));

    expect(renameFolder).toHaveBeenCalledWith('/vault/Projects', 'Draft Notes');
  });

  it('shows a creation error when the factory cannot create the item', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue(null);
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));

    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('fileTree.createFailed', { reason: '/vault' }));
    expect(onOpenCreated).not.toHaveBeenCalled();
  });

  it('keeps a created note visible and renameable when parent refresh fails', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    onDirectoryChanged.mockResolvedValueOnce(false);
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));

    expect(onOpenCreated).toHaveBeenCalledWith('/vault/Без названия.md');
    expect(latest.renamingPath).toBe('/vault/Без названия.md');
    expect(mounted.container.firstElementChild?.getAttribute('data-created'))
      .toBe('/vault/Без названия.md');
    expect(latest.createError).toBe(t('fileTree.createdButRefreshFailed'));
  });

  it('reports a parent reload error after the note was created', async () => {
    vi.mocked(createUniqueFile).mockResolvedValue('/vault/Без названия.md');
    onDirectoryChanged.mockRejectedValueOnce(new Error('read failed'));
    act(() => { mounted = mountDom(renderHook()); });

    await actAndSettle(() => latest.rowActions.createNoteIn?.('/vault'));

    expect(onOpenCreated).toHaveBeenCalledWith('/vault/Без названия.md');
    expect(latest.renamingPath).toBe('/vault/Без названия.md');
    expect(latest.createdItem?.id).toBe('/vault/Без названия.md');
    expect(latest.createError).toBe(t('fileTree.createdButRefreshFailed'));
  });
});

function HarnessWithPatch({ patchFileInTree }: { patchFileInTree: (path: string, patch: { id?: string; name?: string }) => void }) {
  latest = useFileTreeActions({
    workspacePath: '/vault',
    targetsFor: (path) => [path],
    onPatchFileInTree: patchFileInTree,
  });
  return <div />;
}
