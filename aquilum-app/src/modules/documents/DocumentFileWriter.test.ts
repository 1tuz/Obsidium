import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renameFile, writeFileAtomic } from './fileGateway';
import { DocumentFileWriter } from './DocumentFileWriter';

vi.mock('./fileGateway', () => ({
  EDIT_WRITE: { kind: 'edit' },
  renameFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}));

const renameFileMock = vi.mocked(renameFile);
const writeFileAtomicMock = vi.mocked(writeFileAtomic);

describe('DocumentFileWriter', () => {
  beforeEach(() => {
    renameFileMock.mockReset();
    writeFileAtomicMock.mockReset();
  });

  it('serializes writes and advances the expected hash', async () => {
    let finishFirstWrite: ((value: { hash: string }) => void) | undefined;
    writeFileAtomicMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirstWrite = resolve;
      }))
      .mockResolvedValueOnce({ hash: 'hash-2' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');

    const first = writer.write('first');
    const second = writer.write('second');

    await vi.waitFor(() => expect(writeFileAtomicMock).toHaveBeenCalledTimes(1));
    finishFirstWrite?.({ hash: 'hash-1' });
    await Promise.all([first, second]);

    expect(writeFileAtomicMock).toHaveBeenNthCalledWith(
      1,
      'note.md',
      'first',
      'hash-0',
      { kind: 'edit' },
    );
    expect(writeFileAtomicMock).toHaveBeenNthCalledWith(
      2,
      'note.md',
      'second',
      'hash-1',
      { kind: 'edit' },
    );
  });

  it('orders rename between writes', async () => {
    let finishWrite: ((value: { hash: string }) => void) | undefined;
    writeFileAtomicMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishWrite = resolve;
      }))
      .mockResolvedValueOnce({ hash: 'hash-2' });
    renameFileMock.mockResolvedValue({
      content: 'before rename',
      hash: 'hash-1',
      textHash: 'hash-1',
      updatedPaths: [],
    });
    const writer = new DocumentFileWriter('old.md', 'hash-0', '');

    const write = writer.write('before rename');
    const rename = writer.rename('new.md');
    const nextWrite = writer.write('after rename');

    await vi.waitFor(() => expect(writeFileAtomicMock).toHaveBeenCalledTimes(1));
    expect(renameFileMock).not.toHaveBeenCalled();
    finishWrite?.({ hash: 'hash-1' });
    await Promise.all([write, rename, nextWrite]);

    expect(renameFileMock).toHaveBeenCalledWith('old.md', 'new.md');
    expect(writeFileAtomicMock).toHaveBeenLastCalledWith(
      'new.md',
      'after rename',
      'hash-1',
      { kind: 'edit' },
    );
  });

  it('continues processing after a failed operation', async () => {
    writeFileAtomicMock
      .mockRejectedValueOnce({ code: 'conflict' })
      .mockResolvedValueOnce({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');

    await expect(writer.write('conflict')).rejects.toEqual({ code: 'conflict' });
    await expect(writer.write('retry')).resolves.toEqual({ hash: 'hash-1' });

    expect(writeFileAtomicMock).toHaveBeenLastCalledWith(
      'note.md',
      'retry',
      'hash-0',
      { kind: 'edit' },
    );
    await expect(writer.idle()).resolves.toBeUndefined();
  });
});

describe('DocumentFileWriter scheduling', () => {
  beforeEach(() => {
    writeFileAtomicMock.mockReset();
    renameFileMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes once per window and serializes the document only at write time', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');
    const content = vi.fn(() => 'последнее состояние');
    const onError = vi.fn();
    const onSaved = vi.fn();

    writer.schedule({ content, delayMs: 1000, onSaved, onError });
    writer.schedule({ content, delayMs: 1000, onSaved, onError });
    writer.schedule({ content, delayMs: 1000, onSaved, onError });

    expect(writeFileAtomicMock).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(content).toHaveBeenCalledTimes(1);
    expect(writeFileAtomicMock).toHaveBeenCalledTimes(1);
    expect(writeFileAtomicMock).toHaveBeenCalledWith('note.md', 'последнее состояние', 'hash-0', { kind: 'edit' });
    expect(onError).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('flushes pending input on idle without waiting for the timer', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');
    writer.schedule({ content: () => 'не потерять', delayMs: 5000, onSaved: vi.fn(), onError: vi.fn() });

    await writer.idle();

    expect(writeFileAtomicMock).toHaveBeenCalledWith('note.md', 'не потерять', 'hash-0', { kind: 'edit' });
  });

  it('reports a write failure to the owner of the scheduled write', async () => {
    writeFileAtomicMock.mockRejectedValueOnce({ code: 'conflict' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');
    const onError = vi.fn();
    const onSaved = vi.fn();

    writer.schedule({ content: () => 'текст', delayMs: 100, onSaved, onError });
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledWith({ code: 'conflict' });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps writing to the new path after an external rename', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('old.md', 'hash-0', '');
    writer.adoptPath('new.md');

    writer.schedule({ content: () => 'текст', delayMs: 100, onSaved: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(100);

    expect(writeFileAtomicMock).toHaveBeenCalledWith('new.md', 'текст', 'hash-0', { kind: 'edit' });
  });
});

describe('DocumentFileWriter debounce integrity', () => {
  beforeEach(() => {
    writeFileAtomicMock.mockReset();
    renameFileMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a reading progress write so the history can skip it', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('book.md', 'hash-0', 'книга');

    await writer.write('книга позиция', { kind: 'readingProgress' });

    expect(writeFileAtomicMock).toHaveBeenCalledWith('book.md', 'книга позиция', 'hash-0', { kind: 'readingProgress' });
  });

  it('does not let disk synchronisation flush pending input', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', '');
    writer.schedule({ content: () => 'ввод', delayMs: 1000, onSaved: vi.fn(), onError: vi.fn() });

    await writer.settled();
    expect(writeFileAtomicMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(writeFileAtomicMock).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentFileWriter guarding an emptied note', () => {
  beforeEach(() => {
    renameFileMock.mockReset();
    writeFileAtomicMock.mockReset();
  });

  it('hands over the text a write is about to erase', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const kept: { path: string; previous: string }[] = [];
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'важный текст\n');
    writer.onTruncate = (path, previous) => { kept.push({ path, previous }); };

    await writer.write('');

    expect(kept).toEqual([{ path: 'note.md', previous: 'важный текст\n' }]);
  });

  it('keeps the copy before the file is emptied, not after', async () => {
    const order: string[] = [];
    writeFileAtomicMock.mockImplementation(() => {
      order.push('write');
      return Promise.resolve({ hash: 'hash-1' });
    });
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'текст');
    writer.onTruncate = async () => { order.push('copy'); };

    await writer.write('');

    expect(order).toEqual(['copy', 'write']);
  });

  it('treats a note left with only blank space as emptied', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const kept: string[] = [];
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'текст');
    writer.onTruncate = (_path, previous) => { kept.push(previous); };

    await writer.write('\n\n  \n');

    expect(kept).toEqual(['текст']);
  });

  it('stays quiet for an ordinary write that carries text', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const truncated = vi.fn();
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'текст');
    writer.onTruncate = truncated;

    await writer.write('другой текст');

    expect(truncated).not.toHaveBeenCalled();
  });

  it('stays quiet when the note had nothing to lose', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const truncated = vi.fn();
    const writer = new DocumentFileWriter('note.md', 'hash-0', '\n\n');
    writer.onTruncate = truncated;

    await writer.write('');

    expect(truncated).not.toHaveBeenCalled();
  });

  it('empties the file anyway when keeping the copy fails', async () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'текст');
    writer.onTruncate = () => Promise.reject(new Error('диск занят'));

    await expect(writer.write('')).resolves.toEqual({ hash: 'hash-1' });

    expect(writeFileAtomicMock).toHaveBeenCalledWith('note.md', '', 'hash-0', { kind: 'edit' });
    failure.mockRestore();
  });

  it('does not ask twice when the note is emptied and saved again', async () => {
    writeFileAtomicMock.mockResolvedValue({ hash: 'hash-1' });
    const truncated = vi.fn();
    const writer = new DocumentFileWriter('note.md', 'hash-0', 'текст');
    writer.onTruncate = truncated;

    await writer.write('');
    await writer.write('');

    expect(truncated).toHaveBeenCalledTimes(1);
  });
});
