import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revertDocument } from '../documents/documentGateway';
import { readNoteVersion, type NoteVersion } from './index';
import { revertChunkText, revertVersionChunk, type ChunkChange, type VersionChunk } from './chunk';

vi.mock('../documents/documentGateway', () => ({
  revertDocument: vi.fn(async () => true),
}));
vi.mock('./index', () => ({ readNoteVersion: vi.fn() }));

const previous = 'один\nдва\nтри\nчетыре\nпять\n';
const version = 'один\nдва правка\nтри\nчетыре\nпять правка\n';
const withoutFirst = 'один\nдва\nтри\nчетыре\nпять правка\n';
const withoutSecond = 'один\nдва правка\nтри\nчетыре\nпять\n';

const note: NoteVersion = {
  id: '1790000000000_aaaaaaaa_agent.md',
  atMs: 1790000000000,
  device: 'aaaaaaaa',
  source: 'agent',
  fromMs: null,
  name: null,
  isCurrent: false,
};

const chunks = Chunk.build(Text.of(previous.split('\n')), Text.of(version.split('\n')));
const changes: ChunkChange[] = chunks.map((chunk) => ({
  previous: { from: chunk.fromA, to: chunk.toA },
  version: { from: chunk.fromB, to: chunk.toB },
}));

function versionChunk(index: number, revertedText: string): VersionChunk {
  const change = changes[index];
  return {
    from: change.version.from,
    to: Math.min(version.length, change.version.to),
    versionText: version,
    revertedText,
  };
}

describe('reverting one chunk of a version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readNoteVersion).mockResolvedValue({ text: version, previous });
  });

  it('sees two separate chunks in the version', () => {
    expect(chunks).toHaveLength(2);
    expect(revertChunkText(version, previous, changes[0])).toBe(withoutFirst);
    expect(revertChunkText(version, previous, changes[1])).toBe(withoutSecond);
  });

  it('writes the version without the chunk through the revert gateway', async () => {
    const chunk = versionChunk(0, withoutFirst);

    expect(await revertVersionChunk('C:/База/Первая.md', note, chunk)).toBe(true);

    expect(revertDocument).toHaveBeenCalledWith('C:/База/Первая.md', version, withoutFirst, note.atMs);
  });

  it('keeps the other chunk when one is reverted', async () => {
    const chunk = versionChunk(1, withoutSecond);

    expect(await revertVersionChunk('C:/База/Вторая.md', note, chunk)).toBe(true);

    const [, base, reverted] = vi.mocked(revertDocument).mock.calls[0];
    expect(base).toBe(version);
    expect(reverted).toBe(withoutSecond);
    expect(reverted).toContain('два правка');
  });

  it('does not write the same chunk twice', async () => {
    const chunk = versionChunk(0, withoutFirst);

    expect(await revertVersionChunk('C:/База/Третья.md', note, chunk)).toBe(true);
    expect(await revertVersionChunk('C:/База/Третья.md', note, chunk)).toBe(true);

    expect(revertDocument).toHaveBeenCalledTimes(1);
  });

  it('leaves the note alone when the version is gone', async () => {
    vi.mocked(readNoteVersion).mockResolvedValueOnce(null);

    expect(await revertVersionChunk('C:/База/Четвёртая.md', note, versionChunk(0, withoutFirst))).toBe(false);
    expect(revertDocument).not.toHaveBeenCalled();
  });

  it('leaves the note alone when the version text changed under it', async () => {
    vi.mocked(readNoteVersion).mockResolvedValueOnce({ text: 'другой текст\n', previous });

    expect(await revertVersionChunk('C:/База/Пятая.md', note, versionChunk(0, withoutFirst))).toBe(false);
    expect(revertDocument).not.toHaveBeenCalled();
  });
});
