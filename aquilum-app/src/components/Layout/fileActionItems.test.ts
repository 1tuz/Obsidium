import { describe, expect, it, vi } from 'vitest';
import { fileActionItems } from './fileActionItems';

describe('fileActionItems', () => {
  it('offers board membership actions for Markdown notes only', () => {
    const addToBoard = vi.fn();
    const removeFromBoard = vi.fn();
    const actions = {
      startRename: vi.fn(),
      duplicateFile: vi.fn(),
      requestDelete: vi.fn(),
      addToBoard,
      removeFromBoard,
    };
    const noteActions = fileActionItems(actions, '/vault/note.md');

    noteActions.find((item) => item.id === 'add-to-board')?.onSelect();
    noteActions.find((item) => item.id === 'remove-from-board')?.onSelect();

    expect(addToBoard).toHaveBeenCalledWith('/vault/note.md');
    expect(removeFromBoard).toHaveBeenCalledWith('/vault/note.md');
    expect(fileActionItems(actions, '/vault/board.base').map((item) => item.id))
      .not.toContain('add-to-board');
  });
});
