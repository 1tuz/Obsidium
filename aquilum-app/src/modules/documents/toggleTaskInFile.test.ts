import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { getManagedWriterForPath, getOpenDoc } from '../docs';
import { documentText } from '../docSync';
import { DocumentFileWriter } from './DocumentFileWriter';
import { readFileSnapshot, writeFileAtomic } from './fileGateway';
import { toggleTaskInFile } from './toggleTaskInFile';

vi.mock('../docs', () => ({
  getOpenDoc: vi.fn(),
  getManagedWriterForPath: vi.fn(),
}));

vi.mock('./fileGateway', () => ({
  EDIT_WRITE: 'user',
  readFileSnapshot: vi.fn(),
  writeFileAtomic: vi.fn(),
}));

describe('toggleTaskInFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates file on disk when document is not open', async () => {
    vi.mocked(getOpenDoc).mockReturnValue(null);
    vi.mocked(readFileSnapshot).mockResolvedValue({
      content: '- [ ] задача\n- обычная строка',
      hash: 'hash-1',
      textHash: 'text-1',
    });
    vi.mocked(writeFileAtomic).mockResolvedValue({
      hash: 'hash-2',
    });

    const result = await toggleTaskInFile('C:/vault', 'tasks.md', 1);
    expect(result).toBe(true);
    expect(writeFileAtomic).toHaveBeenCalledWith(
      'C:/vault/tasks.md',
      '- [x] задача\n- обычная строка',
      'hash-1',
      'user',
    );
  });

  it('updates in-memory Y.Doc and writer when document is open', async () => {
    const ydoc = new Y.Doc();
    documentText(ydoc).insert(0, '- [ ] открытая задача\n');
    const writer = new DocumentFileWriter('C:/vault/open.md', 'hash-0', '- [ ] открытая задача\n');
    vi.mocked(writeFileAtomic).mockResolvedValue({ hash: 'hash-1' });
    vi.mocked(getOpenDoc).mockReturnValue(ydoc);
    vi.mocked(getManagedWriterForPath).mockReturnValue(writer);

    const result = await toggleTaskInFile('C:/vault', 'open.md', 1);

    expect(result).toBe(true);
    expect(documentText(ydoc).toString()).toBe('- [x] открытая задача\n');
    expect(writeFileAtomic).toHaveBeenCalledWith('C:/vault/open.md', '- [x] открытая задача\n', 'hash-0', 'user');
  });

  it('writes what the document holds when the write runs, not when the toggle started', async () => {
    const ydoc = new Y.Doc();
    const text = documentText(ydoc);
    text.insert(0, '- [ ] задача\n');
    const writer = new DocumentFileWriter('C:/vault/typing.md', 'hash-0', '- [ ] задача\n');
    let releaseEarlierWrite!: () => void;
    const disk: string[] = [];
    vi.mocked(writeFileAtomic).mockImplementation(async (_path, content) => {
      if (disk.length === 0) await new Promise<void>((resolve) => { releaseEarlierWrite = resolve; });
      disk.push(content);
      return { hash: `hash-${disk.length}` };
    });
    vi.mocked(getOpenDoc).mockReturnValue(ydoc);
    vi.mocked(getManagedWriterForPath).mockReturnValue(writer);

    const earlierWrite = writer.write('- [ ] задача\n');
    const toggled = toggleTaskInFile('C:/vault', 'typing.md', 1);
    await Promise.resolve();
    text.insert(text.length, 'набрано во время записи');
    releaseEarlierWrite();
    await Promise.all([earlierWrite, toggled]);

    expect(disk[disk.length - 1]).toBe('- [x] задача\nнабрано во время записи');
  });

  it('writes the file itself when the open document has no writer yet', async () => {
    const ydoc = new Y.Doc();
    documentText(ydoc).insert(0, '- [ ] задача\n');
    vi.mocked(getOpenDoc).mockReturnValue(ydoc);
    vi.mocked(getManagedWriterForPath).mockReturnValue(null);
    vi.mocked(readFileSnapshot).mockResolvedValue({ content: '- [ ] задача\n', hash: 'hash-1', textHash: 'text-1' });
    vi.mocked(writeFileAtomic).mockResolvedValue({ hash: 'hash-2' });

    const result = await toggleTaskInFile('C:/vault', 'opening.md', 1);

    expect(result).toBe(true);
    expect(writeFileAtomic).toHaveBeenCalledWith('C:/vault/opening.md', '- [x] задача\n', 'hash-1', 'user');
  });

  it('serializes concurrent calls to the same file path', async () => {
    vi.mocked(getOpenDoc).mockReturnValue(null);
    let diskContent = '- [ ] задача 1\n- [ ] задача 2\n';
    let currentHash = 'hash-init';

    vi.mocked(readFileSnapshot).mockImplementation(async () => ({
      content: diskContent,
      hash: currentHash,
      textHash: currentHash,
    }));

    vi.mocked(writeFileAtomic).mockImplementation(async (_path, content, _hash) => {
      diskContent = content;
      currentHash = `hash-${Math.random()}`;
      return { hash: currentHash };
    });

    const [first, second] = await Promise.all([
      toggleTaskInFile('C:/vault', 'shared.md', 1),
      toggleTaskInFile('C:/vault', 'shared.md', 2),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(diskContent).toBe('- [x] задача 1\n- [x] задача 2\n');
  });
});
