import { describe, expect, it } from 'vitest';
import { boardTree } from './boardTree';
import type { KanbanBoard } from './boards';

describe('boardTree', () => {
  it('keeps board files under their vault folders and views under each file', () => {
    const boards = [
      { path: '/vault/Work/Bugs.base', name: 'Bugs', views: [{ index: 0, name: 'Open', membership: { kind: 'unsupported', reason: 'complex' } }] },
      { path: '/vault/Personal.base', name: 'Personal', views: [{ index: 1, name: 'Plan', membership: { kind: 'unsupported', reason: 'complex' } }] },
    ] as KanbanBoard[];

    expect(boardTree(boards, '/vault')).toMatchObject({
      folders: [{
        name: 'Work',
        boards: [{ name: 'Bugs', views: [{ index: 0, name: 'Open' }] }],
      }],
      boards: [{ name: 'Personal', views: [{ index: 1, name: 'Plan' }] }],
    });
  });
});
