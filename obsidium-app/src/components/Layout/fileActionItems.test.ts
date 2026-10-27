import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem } from '../Common/Menu';
import { fileActionItems, rootActionItems, selectionActionItems } from './fileActionItems';

function ids(entries: MenuEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

function item(entries: MenuEntry[], id: string): MenuItem {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || entry.type === 'separator') throw new Error(`Missing menu item ${id}`);
  return entry;
}

describe('fileActionItems', () => {
  const commonActions = () => ({
    openFile: vi.fn(),
    openInNewTab: vi.fn(),
    openInRight: vi.fn(),
    copyPath: vi.fn(),
    copyInternalLink: vi.fn(),
    reveal: vi.fn(),
    openHistory: vi.fn(),
    duplicateFile: vi.fn(),
    moveToFolder: vi.fn(),
    startRename: vi.fn(),
    requestDelete: vi.fn(),
  });

  it('builds a grouped Markdown menu with path-safe link and history actions', () => {
    const actions = {
      ...commonActions(),
      addToBoard: vi.fn(),
      removeFromBoard: vi.fn(),
    };
    const menu = fileActionItems(actions, '/vault/Projects/Roadmap.md');

    expect(ids(menu)).toEqual([
      'open', 'open-new-tab', 'open-right', 'separator-1',
      'copy-internal-link', 'copy-path', 'reveal', 'history', 'separator-2',
      'duplicate', 'move', 'add-to-board', 'remove-from-board', 'separator-3',
      'rename', 'delete',
    ]);
    expect(item(menu, 'delete').danger).toBe(true);

    item(menu, 'copy-internal-link').onSelect();
    item(menu, 'open-new-tab').onSelect();
    expect(actions.copyInternalLink).toHaveBeenCalledWith('/vault/Projects/Roadmap.md');
    expect(actions.openInNewTab).toHaveBeenCalledWith('/vault/Projects/Roadmap.md');
  });

  it('shows only applicable actions for text files, Bases, Canvas and attachments', () => {
    const actions = {
      ...commonActions(),
      openAsText: vi.fn(),
      addToBoard: vi.fn(),
      openHistory: vi.fn(),
    };

    expect(ids(fileActionItems(actions, '/vault/settings.json'))).toEqual([
      'open', 'separator-1', 'copy-path', 'reveal', 'separator-2',
      'duplicate', 'move', 'separator-3', 'rename', 'delete',
    ]);
    expect(ids(fileActionItems(actions, '/vault/Board.base'))).toContain('open-as-text');
    expect(ids(fileActionItems(actions, '/vault/Board.base'))).not.toContain('history');
    expect(ids(fileActionItems(actions, '/vault/Board.canvas'))).not.toContain('open-as-text');
    expect(ids(fileActionItems(actions, '/vault/diagram.png'))).not.toContain('add-to-board');
    expect(ids(fileActionItems(actions, '/vault/diagram.png'))).not.toContain('history');
  });

  it('creates inside a folder and does not offer unsafe folder moves', () => {
    const createNoteIn = vi.fn();
    const createFolderIn = vi.fn();
    const menu = fileActionItems({
      ...commonActions(),
      createNoteIn,
      createFolderIn,
      searchInFolder: vi.fn(),
    }, '/vault/Projects', 'folder');

    expect(ids(menu)).toEqual([
      'new-note-here', 'new-folder-here', 'separator-1', 'search-folder',
      'copy-path', 'reveal', 'move', 'separator-2', 'rename', 'delete',
    ]);
    item(menu, 'new-note-here').onSelect();
    item(menu, 'new-folder-here').onSelect();
    item(menu, 'move').onSelect();
    expect(createNoteIn).toHaveBeenCalledWith('/vault/Projects');
    expect(createFolderIn).toHaveBeenCalledWith('/vault/Projects');
  });

  it('supports grouped actions for multiple selected files and hides unsupported operations', () => {
    const actions = {
      copyPaths: vi.fn(),
      duplicateFile: vi.fn(),
      moveToFolder: vi.fn(),
      requestDelete: vi.fn(),
      canDuplicateSelection: () => false,
      canMoveSelection: () => false,
    };
    const menu = selectionActionItems(actions, '/vault/note.md');

    expect(ids(menu)).toEqual(['copy-paths', 'separator-1', 'delete']);
    item(menu, 'copy-paths').onSelect();
    item(menu, 'delete').onSelect();
    expect(actions.copyPaths).toHaveBeenCalledWith('/vault/note.md');
    expect(actions.requestDelete).toHaveBeenCalledWith('/vault/note.md');
  });

  it('groups root creation, search and maintenance actions', () => {
    const actions = {
      createNoteIn: vi.fn(),
      createFolderIn: vi.fn(),
      createCanvasIn: vi.fn(),
      createTemplateIn: vi.fn(),
      createBaseIn: vi.fn(),
      searchVault: vi.fn(),
      collapseFolders: vi.fn(),
      revealWorkspace: vi.fn(),
    };
    const menu = rootActionItems(actions, '/vault');

    expect(ids(menu)).toEqual([
      'new-note', 'new-folder', 'separator-1', 'new-canvas', 'new-from-template',
      'new-base', 'separator-2', 'search-vault', 'separator-3', 'collapse-folders',
      'reveal-workspace',
    ]);
    item(menu, 'new-base').onSelect();
    item(menu, 'search-vault').onSelect();
    expect(actions.createBaseIn).toHaveBeenCalledWith('/vault');
    expect(actions.searchVault).toHaveBeenCalledOnce();
  });
});
