import { describe, expect, it, vi } from 'vitest';
import type { GraphSnapshot } from '../../modules/graph';
import { readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { appendWikiLink, suggestionNodeIndices, writeSuggestedLink } from './suggestedLinks';

vi.mock('../../modules/documents/fileGateway', () => ({
  readFileSnapshot: vi.fn(),
  writeFileAtomic: vi.fn(),
}));

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
  it('maps candidates by stable path identity and verifies the indexed path', async () => {
    const graph = snapshot(['notes/a.md', 'notes/b.md', 'notes/c.md']);
    const fetchPaths = vi.fn(async (_epoch, indices: number[]) =>
      indices.map((index) => ['notes/a.md', 'notes/b.md', 'notes/c.md'][index]),
    );

    await expect(suggestionNodeIndices(graph, ['notes/c.md', 'missing.md'], fetchPaths))
      .resolves.toEqual([{ path: 'notes/c.md', node: 2 }]);
    expect(fetchPaths).toHaveBeenCalledWith(graph.epoch, [2]);
  });

  it('appends a wiki link with the existing line ending and skips duplicates', () => {
    expect(appendWikiLink('## Related\r\n', 'folder/note.md')).toBe(
      '## Related\r\n[[folder/note]]\r\n',
    );
    expect(appendWikiLink('[[folder/note]]\n', 'folder/note.md')).toBeNull();
    expect(appendWikiLink('[[folder/note|alias]]\n', 'folder/note.md')).toBeNull();
  });

  it('uses an atomic hash-checked write and skips links already present', async () => {
    vi.mocked(readFileSnapshot).mockResolvedValue({
      content: '## Related\r\n',
      hash: 'source-hash',
      textHash: 'text-hash',
    });
    vi.mocked(writeFileAtomic).mockResolvedValue({ hash: 'next-hash' });

    await expect(writeSuggestedLink('/vault', '/vault/source.md', '/vault/folder/note.md'))
      .resolves.toBe(true);
    expect(writeFileAtomic).toHaveBeenCalledWith(
      '/vault/source.md',
      '## Related\r\n[[folder/note]]\r\n',
      'source-hash',
    );

    vi.mocked(readFileSnapshot).mockResolvedValue({
      content: '[[folder/note]]\n',
      hash: 'source-hash',
      textHash: 'text-hash',
    });
    vi.mocked(writeFileAtomic).mockClear();
    await expect(writeSuggestedLink('/vault', '/vault/source.md', '/vault/folder/note.md'))
      .resolves.toBe(false);
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });
});
