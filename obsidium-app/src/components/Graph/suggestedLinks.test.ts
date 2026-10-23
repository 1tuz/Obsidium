import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { GraphSnapshot } from '../../modules/graph';
import { suggestionNodeIndices, writeSuggestedLink } from './suggestedLinks';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function snapshot(paths: string[]): GraphSnapshot {
  const nodeIds = new Uint32Array(paths.length * 2);
  paths.forEach((path, index) => {
    const id = stableId(path);
    nodeIds[index * 2] = Number(id & 0xffff_ffffn);
    nodeIds[index * 2 + 1] = Number(id >> 32n);
  });
  return {
    nodeCount: paths.length,
    edgeCount: 0,
    epoch: { low: 1, high: 0 },
    positions: new Float32Array(paths.length * 2),
    createdDays: new Float32Array(paths.length),
    modifiedDays: new Float32Array(paths.length),
    degrees: new Uint32Array(paths.length),
    nodeIds,
    clusterIds: new Uint32Array(paths.length),
    edges: new Uint32Array(),
    edgeDirections: new Uint32Array(),
    edgeTypes: new Uint32Array(),
  };
}

function stableId(path: string): bigint {
  return [...new TextEncoder().encode(path)].reduce(
    (hash, byte) => BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n),
    0xcbf29ce484222325n,
  );
}

describe('suggested graph links', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('maps candidates by stable path identity and verifies the indexed path', async () => {
    const graph = snapshot(['notes/a.md', 'notes/b.md', 'notes/c.md']);
    const fetchPaths = vi.fn(async (_epoch, indices: number[]) =>
      indices.map((index) => ['notes/a.md', 'notes/b.md', 'notes/c.md'][index]),
    );

    await expect(suggestionNodeIndices(graph, ['notes/c.md', 'missing.md'], fetchPaths))
      .resolves.toEqual([{ path: 'notes/c.md', node: 2 }]);
    expect(fetchPaths).toHaveBeenCalledWith(graph.epoch, [2]);
  });

  it('applies the wiki link through the IPC boundary with absolute paths', async () => {
    invokeMock.mockResolvedValue({ changed: true, path: 'notes/source.md' });

    await expect(
      writeSuggestedLink('/vault', '/vault/notes/source.md', '/vault/folder/note.md'),
    ).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('apply_suggested_link', {
      workspace: '/vault',
      source: '/vault/notes/source.md',
      target: '/vault/folder/note.md',
    });
  });

  it('reports an already present link as unchanged', async () => {
    invokeMock.mockResolvedValue({ changed: false, path: 'notes/source.md' });

    await expect(
      writeSuggestedLink('/vault', '/vault/notes/source.md', '/vault/folder/note.md'),
    ).resolves.toBe(false);
  });

  it('propagates IPC errors', async () => {
    invokeMock.mockRejectedValue(new Error('Изменение заметок запрещено в настройках Obsidium'));

    await expect(
      writeSuggestedLink('/vault', '/vault/notes/source.md', '/vault/folder/note.md'),
    ).rejects.toThrow('Изменение заметок запрещено в настройках Obsidium');
  });
});
