import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDocumentText, applyTextEdits, documentText, writeConflictCopy } from '../docSync';
import { getManagedWriterForPath, getOpenDoc } from '../docs';
import { readNoteVersion, type NoteVersion } from './index';
import { restoreVersion, revertVersion } from './rewrite';

vi.mock('../docSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../docSync')>()),
  applyDocumentText: vi.fn(),
  applyTextEdits: vi.fn(),
  documentText: vi.fn(),
  writeConflictCopy: vi.fn(async () => null),
}));
vi.mock('../docs', () => ({ getOpenDoc: vi.fn(), getManagedWriterForPath: vi.fn() }));
vi.mock('./index', () => ({ readNoteVersion: vi.fn() }));

const version: NoteVersion = {
  id: '1790000000000_aaaaaaaa_agent.md',
  atMs: 1790000000000,
  device: 'aaaaaaaa',
  source: 'agent',
  fromMs: null, name: null, isCurrent: false,
};

describe('rewriting a note from its history', () => {
  const order: string[] = [];
  const doc = {};
  const writer = {
    idle: vi.fn(async () => { order.push('idle'); }),
    write: vi.fn(async (_text: string) => { order.push('write'); return { hash: 'h' }; }),
  };
  let current = '';

  function versions(text: string, previous: string | null) {
    vi.mocked(readNoteVersion).mockImplementation(async () => {
      order.push('read');
      return { text, previous };
    });
  }

  beforeEach(() => {
    order.length = 0;
    current = '';
    vi.mocked(getOpenDoc).mockReturnValue(doc as never);
    vi.mocked(getManagedWriterForPath).mockReturnValue(writer as never);
    vi.mocked(documentText).mockImplementation(() => ({ toString: () => current }) as never);
    vi.mocked(applyDocumentText).mockImplementation(() => {
      order.push('apply');
      return null;
    });
    vi.mocked(applyTextEdits).mockImplementation(() => { order.push('apply'); });
    vi.mocked(writeConflictCopy).mockClear();
    writer.write.mockClear();
  });

  it('restores: saves pending input, writes the version as a restore and only then changes the document', async () => {
    versions('старое', null);
    await expect(restoreVersion('C:/База/Идея.md', version)).resolves.toBe(true);

    expect(order).toEqual(['idle', 'read', 'write', 'apply']);
    expect(writer.write).toHaveBeenCalledWith('старое', { kind: 'restore', fromMs: version.atMs });
    expect(applyDocumentText).toHaveBeenCalledWith(doc, 'старое', 'direct-write');
  });

  it('runs once when asked twice for the same note', async () => {
    versions('старое', null);
    await Promise.all([
      restoreVersion('C:/База/Идея.md', version),
      revertVersion('c:/База/Идея.md', version),
    ]);
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it('leaves the document alone when the version is gone', async () => {
    vi.mocked(readNoteVersion).mockResolvedValueOnce(null);
    await expect(restoreVersion('C:/База/Идея.md', version)).resolves.toBe(false);
    expect(writer.write).not.toHaveBeenCalled();
    expect(order).not.toContain('apply');
  });

  it('reverts only the changes of that version and keeps what was written later', async () => {
    versions('итоги\nмнение агента\nконец', 'итоги\nконец');
    current = 'итоги\nмнение агента\nконец\nмой абзац';

    await expect(revertVersion('C:/База/Идея.md', version)).resolves.toBe(true);

    expect(writer.write).toHaveBeenCalledWith('итоги\nконец\nмой абзац', { kind: 'revert', fromMs: version.atMs });
    expect(order).toEqual(['idle', 'read', 'write', 'apply']);
    expect(writeConflictCopy).not.toHaveBeenCalled();
  });

  it('keeps later edits of the same lines in a conflict copy', async () => {
    versions('итоги\nмнение агента', 'итоги');
    current = 'итоги\nмнение агента, поправленное мной';

    await revertVersion('C:/База/Идея.md', version);

    expect(writer.write).toHaveBeenCalledWith('итоги', { kind: 'revert', fromMs: version.atMs });
    expect(writeConflictCopy).toHaveBeenCalledWith(
      'C:/База/Идея.md',
      'мнение агента, поправленное мной',
      { cause: 'reverted' },
    );
  });

  it('does not revert the first version: there is nothing before it', async () => {
    versions('первая', null);
    await expect(revertVersion('C:/База/Идея.md', version)).resolves.toBe(false);
    expect(writer.write).not.toHaveBeenCalled();
  });
});
