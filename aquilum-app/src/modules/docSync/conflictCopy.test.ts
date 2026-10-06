import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const { writeConflictCopy } = await import('./conflictCopy');

const MOMENT = new Date(2026, 7, 17, 8, 30);
const DIVERGED = { cause: 'diverged' as const };

function disk(existing: string[] = []) {
  const created: { path: string; content: string }[] = [];
  invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command !== 'create_file') return Promise.resolve(undefined);
    const path = String(args.path);
    if (existing.includes(path)) {
      return Promise.reject({ code: 'already_exists', details: path });
    }
    created.push({ path, content: String(args.content) });
    return Promise.resolve({ hash: 'hash' });
  });
  return created;
}

function body(content: string): string {
  return content.slice(content.indexOf('## Текст, который не попал в заметку\n') + 37);
}

describe('writeConflictCopy', () => {
  beforeEach(() => invoke.mockReset());

  it('puts the copy next to the note with a readable stamp', async () => {
    const created = disk();

    const path = await writeConflictCopy(
      'D:/База/Проекты/Идея.md',
      'мой текст',
      DIVERGED,
      MOMENT,
    );

    expect(path).toBe('D:/База/Проекты/Идея (конфликт 2026-08-17 08-30).md');
    expect(body(created[0].content)).toBe('мой текст\n');
  });

  it('keeps the windows separator of the note it belongs to', async () => {
    disk();
    const path = await writeConflictCopy('D:\\База\\Идея.md', 'текст', DIVERGED, MOMENT);
    expect(path).toBe('D:\\База\\Идея (конфликт 2026-08-17 08-30).md');
  });

  it('does not overwrite an earlier copy from the same minute', async () => {
    disk(['D:/База/Идея (конфликт 2026-08-17 08-30).md']);

    const path = await writeConflictCopy('D:/База/Идея.md', 'текст', DIVERGED, MOMENT);

    expect(path).toBe('D:/База/Идея (конфликт 2026-08-17 08-30) 2.md');
  });

  it('does not create a file for text that carries nothing', async () => {
    const created = disk();

    expect(await writeConflictCopy('D:/База/Идея.md', '   \n\n', DIVERGED, MOMENT)).toBeNull();
    expect(created).toEqual([]);
  });

  it('keeps a trailing newline that the text already had', async () => {
    const created = disk();
    await writeConflictCopy('D:/База/Идея.md', 'строка\n', DIVERGED, MOMENT);
    expect(body(created[0].content)).toBe('строка\n');
  });

  it('names the note, the moment and the reason the copy exists', async () => {
    const created = disk();

    await writeConflictCopy('D:/База/Идея.md', 'текст', {
      cause: 'diverged',
      diskHash: 'hash:диск',
      syncedHash: 'hash:сверка',
    }, MOMENT);

    const content = created[0].content;
    expect(content).toContain('конфликт: 2026-08-17 08:30');
    expect(content).toContain('заметка: "Идея"');
    expect(content).toContain('причина: "файл и документ изменились одновременно"');
    expect(content).toContain('`D:/База/Идея.md`');
    expect(content).toContain('`hash:диск`');
    expect(content).toContain('`hash:сверка`');
  });

  it('explains each cause in its own words', async () => {
    const created = disk();

    await writeConflictCopy('D:/База/А.md', 'текст', { cause: 'no-sync-point' }, MOMENT);
    await writeConflictCopy('D:/База/Б.md', 'текст', { cause: 'displaced' }, MOMENT);

    expect(created[0].content).toContain('точка сверки недоступна');
    expect(created[0].content).toContain('не ответило');
    expect(created[1].content).toContain('строки не поместились при слиянии');
    expect(created[1].content).toContain('вытеснило строки ниже');
  });

  it('leaves out a fingerprint it was not given', async () => {
    const created = disk();

    await writeConflictCopy('D:/База/Идея.md', 'текст', { cause: 'diverged' }, MOMENT);

    expect(created[0].content).not.toContain('Отпечаток');
  });
});

describe('writeConflictCopy for an emptied note', () => {
  beforeEach(() => invoke.mockReset());

  it('says the note was emptied and how to treat the copy', async () => {
    const created = disk();

    await writeConflictCopy(
      'D:/База/Идея.md',
      'потерянный текст',
      { cause: 'truncated', syncedHash: 'hash:до' },
      MOMENT,
    );

    const content = created[0].content;
    expect(content).toContain('причина: "заметка обнулена при сохранении"');
    expect(content).toContain('записало в заметку пустой текст');
    expect(content).toContain('копию можно просто удалить');
    expect(body(content)).toBe('потерянный текст\n');
  });
});
