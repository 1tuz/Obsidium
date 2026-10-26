import { describe, expect, it } from 'vitest';
import { fileActionItems } from './fileActionItems';

const ids = (menu: Array<{ id: string }>) => menu.map((item) => item.id);

describe('fileActionItems', () => {
  const baseActions = () => ({
    startRename: () => undefined,
    duplicateFile: () => undefined,
    requestDelete: () => undefined,
  });

  it('offers board membership actions for Markdown notes only', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const actions = {
      ...baseActions(),
      addToBoard: (path: string) => added.push(path),
      removeFromBoard: (path: string) => removed.push(path),
    };
    const noteActions = fileActionItems(actions, '/vault/note.md');

    noteActions.find((item) => item.id === 'add-to-board')?.onSelect();
    noteActions.find((item) => item.id === 'remove-from-board')?.onSelect();

    expect(added).toEqual(['/vault/note.md']);
    expect(removed).toEqual(['/vault/note.md']);
    expect(ids(fileActionItems(actions, '/vault/board.base'))).not.toContain('add-to-board');
  });

  it('offers both creation actions and no duplication for a folder', () => {
    const created: string[] = [];
    const createdFolders: string[] = [];
    const actions = {
      ...baseActions(),
      createNoteIn: (path: string) => created.push(path),
      createFolderIn: (path: string) => createdFolders.push(path),
    };
    const folderMenu = fileActionItems(actions, '/vault/projects', 'folder');

    expect(ids(folderMenu)).toEqual([
      'new-note-here',
      'new-folder-here',
      'rename',
      'delete',
    ]);

    folderMenu.find((item) => item.id === 'new-note-here')?.onSelect();
    folderMenu.find((item) => item.id === 'new-folder-here')?.onSelect();

    expect(created).toEqual(['/vault/projects']);
    expect(createdFolders).toEqual(['/vault/projects']);
  });

  it('keeps the file action set unchanged', () => {
    const actions = {
      ...baseActions(),
      addToBoard: () => undefined,
      removeFromBoard: () => undefined,
      openAsText: () => undefined,
      createNoteIn: () => undefined,
      createFolderIn: () => undefined,
    };

    expect(ids(fileActionItems(actions, '/vault/note.md'))).toEqual([
      'rename',
      'duplicate',
      'add-to-board',
      'remove-from-board',
      'delete',
    ]);
    expect(ids(fileActionItems(actions, '/vault/board.base'))).toEqual([
      'rename',
      'duplicate',
      'open-as-text',
      'delete',
    ]);
  });

  it('hides creation actions when the caller provides no way to create them', () => {
    expect(ids(fileActionItems(baseActions(), '/vault/projects', 'folder')))
      .toEqual(['rename', 'delete']);
  });
});
