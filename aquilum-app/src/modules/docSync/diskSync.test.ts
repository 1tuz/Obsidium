import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const invoke = vi.hoisted(() => vi.fn());
const records = vi.hoisted(() => new Map<string, { fileHash: string; textHash: string }>());
const copies = vi.hoisted(() => new Map<string, string>());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./syncRecord', () => ({
  readSyncRecord: (path: string) => {
    const record = records.get(path);
    return Promise.resolve(record ? { kind: 'found', record } : { kind: 'absent' });
  },
  writeSyncRecord: (path: string, record: { fileHash: string; textHash: string }) => {
    records.set(path, record);
    return Promise.resolve();
  },
}));

const { createDiskSync } = await import('./diskSync');
const { documentText } = await import('./applyExternalText');
const { DocumentFileWriter } = await import('../documents/DocumentFileWriter');

const PATH = 'note.md';

interface Disk {
  content: string;
  hash: string;
}

function gateway(disk: Disk, created: string[] = []) {
  invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command === 'read_file_hash') return Promise.resolve(disk.hash);
    if (command === 'read_file_snapshot') {
      return Promise.resolve({ ...disk, textHash: disk.hash });
    }
    if (command === 'existing_files') return Promise.resolve([PATH]);
    if (command === 'hash_text') return Promise.resolve(`hash:${args.text as string}`);
    if (command === 'create_file') {
      created.push(String(args.path));
      copies.set(String(args.path), String(args.content));
      return Promise.resolve({ hash: 'copy' });
    }
    if (command === 'write_file_atomic') {
      disk.content = args.content as string;
      disk.hash = `hash:${disk.content}`;
      return Promise.resolve({ hash: disk.hash });
    }
    return Promise.resolve(undefined);
  });
}

function editor(
  text: string,
  writer: InstanceType<typeof DocumentFileWriter>,
  options: { reconciled?: boolean } = {},
) {
  const ydoc = new Y.Doc();
  if (text) documentText(ydoc).insert(0, text);
  const sync = createDiskSync({
    ydoc,
    path: () => PATH,
    writer: () => writer,
    reconciled: options.reconciled,
  });
  return { ydoc, sync, read: () => documentText(ydoc).toString() };
}

function commands(): string[] {
  return invoke.mock.calls.map((call) => String(call[0]));
}

describe('diskSync', () => {
  beforeEach(() => {
    invoke.mockReset();
    records.clear();
  });

  it('fills an empty replica from the file', async () => {
    const disk = { content: 'текст с диска\n', hash: 'hash:текст с диска\n' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, read } = editor('', writer);

    await sync.pull();

    expect(read()).toBe('текст с диска\n');
  });

  it('takes the file when the replica is exactly what it last synced', async () => {
    records.set(PATH, { fileHash: 'hash:старое\n', textHash: 'hash:старое\n' });
    const disk = { content: 'новое с диска\n', hash: 'hash:новое с диска\n' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, read } = editor('старое\n', writer);

    await sync.pull();

    expect(read()).toBe('новое с диска\n');
  });

  it('publishes input that never reached disk before the app died', async () => {
    records.set(PATH, { fileHash: 'hash:начало\n', textHash: 'hash:начало\n' });
    const disk = { content: 'начало\n', hash: 'hash:начало\n' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync } = editor('начало\nне доехало до файла\n', writer);

    await sync.pull();

    expect(disk.content).toBe('начало\nне доехало до файла\n');
  });

  it('keeps a conflict copy when both sides moved while the app was closed', async () => {
    const created: string[] = [];
    records.set(PATH, { fileHash: 'hash:основа\n', textHash: 'hash:основа\n' });
    const disk = { content: 'правка с диска\n', hash: 'hash:правка с диска\n' };
    gateway(disk, created);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, read } = editor('локальная правка\n', writer);

    await sync.pull();

    expect(read()).toBe('правка с диска\n');
    expect(created.length).toBe(1);
    expect(created[0]).toContain('конфликт');

    const copy = copies.get(created[0]) ?? '';
    expect(copy).toContain('причина: "файл и документ изменились одновременно"');
    expect(copy).toContain('локальная правка');
    expect(copy).toContain('> **Заметка.** `note.md`');
    expect(copy).toMatch(/\*\*Отпечаток файла на диске\.\*\* `hash:правка с диска`/);
  });

  it('merges an external change into live local input without losing either', async () => {
    const disk = { content: 'один\nдва\n', hash: 'hash:один\nдва\n' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, ydoc, read } = editor('один\nдва\n', writer);

    await sync.pull();

    documentText(ydoc).insert(0, 'ноль\n');
    disk.content = 'один\nдва\nтри от агента\n';
    disk.hash = 'hash:один\nдва\nтри от агента\n';

    await sync.pull();

    expect(read()).toBe('ноль\nодин\nдва\nтри от агента\n');
  });

  it('does not read the file again when the hash is the one we wrote ourselves', async () => {
    const disk = { content: 'наш текст\n', hash: 'hash:наш текст\n' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync } = editor('наш текст\n', writer);

    await sync.pull();
    invoke.mockClear();
    await sync.pull();

    const commands = invoke.mock.calls.map(([command]) => command);
    expect(commands).toContain('read_file_hash');
    expect(commands).not.toContain('read_file_snapshot');
  });

  it('reports a document that disappeared from disk', async () => {
    const missing = vi.fn();
    invoke.mockImplementation((command: string) => {
      if (command === 'existing_files') return Promise.resolve([]);
      return Promise.reject(new Error('нет файла'));
    });
    const writer = new DocumentFileWriter(PATH, 'hash', 'текст');
    const ydoc = new Y.Doc();
    const sync = createDiskSync({
      ydoc,
      path: () => PATH,
      writer: () => writer,
      onMissingChange: missing,
    });

    await sync.pull();

    expect(missing).toHaveBeenCalledWith(true);
  });
});

describe('diskSync cost per open', () => {
  beforeEach(() => {
    invoke.mockReset();
    records.clear();
  });

  it('asks a settled document only for the hash', async () => {
    const disk = { content: 'текст', hash: 'hash:текст' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, read } = editor('текст', writer, { reconciled: true });

    await sync.pull();

    expect(commands()).toEqual(['read_file_hash']);
    expect(read()).toBe('текст');
  });

  it('still reads the file when a settled document finds a different hash', async () => {
    const disk = { content: 'снаружи', hash: 'hash:снаружи' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, 'hash:было', 'было');
    const { sync, read } = editor('было', writer, { reconciled: true });

    await sync.pull();

    expect(commands()).toContain('read_file_snapshot');
    expect(read()).toBe('снаружи');
  });

  it('reads nothing when the opening snapshot is handed over', async () => {
    const disk = { content: 'текст', hash: 'hash:текст' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync, read } = editor('', writer);

    await sync.pull({ content: disk.content, hash: disk.hash, textHash: disk.hash });

    expect(commands()).not.toContain('read_file_snapshot');
    expect(commands()).not.toContain('read_file_hash');
    expect(read()).toBe('текст');
  });

  it('keeps reading from disk for a document opened cold', async () => {
    const disk = { content: 'текст', hash: 'hash:текст' };
    gateway(disk);
    const writer = new DocumentFileWriter(PATH, disk.hash, disk.content);
    const { sync } = editor('текст', writer);

    await sync.pull();

    expect(commands()).toContain('read_file_hash');
    expect(commands()).toContain('read_file_snapshot');
  });
});
