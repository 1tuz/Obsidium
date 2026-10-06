import { describe, expect, it } from 'vitest';
import { resolveSync, type SyncInputs } from './resolveSync';
import type { SyncRecordLookup } from './syncRecord';

const FILE = 'текст файла';
const DOC = 'текст документа';

interface Overrides extends Partial<Omit<SyncInputs, 'evidence'>> {
  lookup?: SyncRecordLookup;
  docHash?: string;
}

function inputs({ lookup, docHash, ...overrides }: Overrides = {}): SyncInputs {
  return {
    sessionBase: null,
    fileHash: 'file-old',
    fileText: FILE,
    docText: DOC,
    evidence: async () => ({
      lookup: lookup ?? { kind: 'found', record: { fileHash: 'file-old', textHash: 'text-old' } },
      docHash: docHash ?? 'text-old',
    }),
    ...overrides,
  };
}

describe('resolveSync', () => {
  it('does nothing when the file and the document already say the same thing', async () => {
    expect((await resolveSync(inputs({ docText: FILE }))).kind).toBe('in-sync');
  });

  it('merges through the session base while the document is open', async () => {
    expect(await resolveSync(inputs({ sessionBase: 'общая основа' })))
      .toEqual({ kind: 'merge', base: 'общая основа' });
  });

  it('takes the file for a replica that has never been filled', async () => {
    expect((await resolveSync(inputs({ lookup: { kind: 'absent' }, docText: '' }))).kind).toBe('take-file');
  });

  it('does not read the sync record when the cheap checks already decide', async () => {
    let read = false;
    const verdict = await resolveSync({
      ...inputs({ docText: FILE }),
      evidence: async () => {
        read = true;
        return { lookup: { kind: 'absent' }, docHash: '' };
      },
    });
    expect(verdict.kind).toBe('in-sync');
    expect(read).toBe(false);
  });

  it('publishes the document when the file is exactly what we last wrote', async () => {
    expect((await resolveSync(inputs({ docHash: 'text-new' }))).kind).toBe('publish-document');
  });

  it('takes the file when only the file moved on since our last sync', async () => {
    expect(await resolveSync(inputs({ fileHash: 'file-new' })))
      .toEqual({ kind: 'merge', base: DOC });
  });

  it('reports a conflict when both sides moved and no base survived the restart', async () => {
    expect(await resolveSync(inputs({ fileHash: 'file-new', docHash: 'text-new' })))
      .toEqual({ kind: 'conflict', cause: 'diverged' });
  });

  it('takes the file as an external edit when no record was ever written', async () => {
    expect(await resolveSync(inputs({ lookup: { kind: 'absent' } })))
      .toEqual({ kind: 'merge', base: DOC });
  });

  it('never silently picks a side when the record storage itself is broken', async () => {
    const verdict = await resolveSync(inputs({
      lookup: { kind: 'unavailable', reason: 'IndexedDB недоступна' },
    }));
    expect(verdict).toEqual({ kind: 'conflict', cause: 'no-sync-point' });
  });
});
