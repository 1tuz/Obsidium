import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const REPLICA = 'aquilum-sync-';
const RECORDS = 'aquilum-file-sync';

interface StoreData {
  all?: unknown[];
  get?: unknown;
  fail?: boolean;
}

class FakeRequest<T> {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  error: unknown = null;

  constructor(
    readonly result: T,
    failure: boolean,
    settle: (run: () => void) => void,
  ) {
    settle(() => (failure ? this.onerror?.() : this.onsuccess?.()));
  }
}

function request<T>(result: T, failure: boolean, settle: (run: () => void) => void): FakeRequest<T> {
  return new FakeRequest(result, failure, settle);
}

class FakeDatabase {
  constructor(
    private readonly data: Map<string, StoreData>,
    private readonly settle: (run: () => void) => void,
  ) {}

  readonly objectStoreNames = {
    contains: (name: string) => this.data.has(name),
  };

  close(): void {}

  transaction(name: string) {
    const store = this.data.get(name) ?? {};
    return {
      objectStore: () => ({
        getAll: () => request(store.all ?? [], store.fail === true, this.settle),
        get: () => request(store.get, store.fail === true, this.settle),
      }),
    };
  }
}

interface Harness {
  deleted: string[];
  failRead: Set<string>;
  database(name: string): { stores: Map<string, StoreData> };
}

let harness: Harness;
let databases: Map<string, Map<string, StoreData>>;

function installIndexedDb(): Harness {
  const deleted: string[] = [];
  const failRead = new Set<string>();
  databases = new Map();
  const settle = (run: () => void) => void queueMicrotask(run);

  const indexed = {
    databases: async () => [...databases.keys()].map((name) => ({ name })),
    open: (name: string) => {
      const stores = databases.get(name) ?? new Map<string, StoreData>();
      for (const store of failRead) {
        const entry = stores.get(store);
        if (entry) entry.fail = true;
      }
      const database = new FakeDatabase(stores, settle);
      return request(database, !databases.has(name), settle);
    },
    deleteDatabase: (name: string) => {
      deleted.push(name);
      databases.delete(name);
      return request(undefined, false, settle);
    },
  };
  vi.stubGlobal('indexedDB', indexed);

  return {
    deleted,
    failRead,
    database: (name: string) => {
      const stores = new Map<string, StoreData>();
      databases.set(name, stores);
      return { stores };
    },
  };
}

function addReplica(name: string, updates: number[][], point: unknown = { fileHash: 'f', textHash: 't' }) {
  const stores = harness.database(`${REPLICA}${name}`).stores;
  stores.set('updates', { all: updates.map((update) => Uint8Array.from(update as number[])) });
  harness.database(RECORDS).stores.set('records', { get: point });
}

async function importOnce(): Promise<void> {
  vi.resetModules();
  const { legacyReplicasImported } = await import('./legacyReplicas');
  await legacyReplicasImported();
}

beforeEach(() => {
  harness = installIndexedDb();
  invokeMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legacy replica migration', () => {
  it('deletes only the databases whose import the backend confirmed', async () => {
    addReplica('kept.md', [[1, 2]]);
    addReplica('moved.md', [[3]]);
    invokeMock.mockResolvedValue([1]);

    await importOnce();

    expect(invokeMock).toHaveBeenCalledWith('document_import_legacy', {
      replicas: [
        { path: 'kept.md', updates: [[1, 2]], point: { fileHash: 'f', textHash: 't' } },
        { path: 'moved.md', updates: [[3]], point: { fileHash: 'f', textHash: 't' } },
      ],
    });
    expect(harness.deleted).toEqual([`${REPLICA}moved.md`]);
  });

  it('keeps every database when the backend imported nothing', async () => {
    addReplica('kept.md', [[1]]);
    invokeMock.mockResolvedValue([]);

    await importOnce();

    expect(harness.deleted).toEqual([]);
  });

  it('keeps the sync database and the unread replica when a read fails', async () => {
    addReplica('moved.md', [[1]]);
    harness.failRead.add('updates');

    await importOnce();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(harness.deleted).toEqual([]);
  });

  it('deletes everything once every replica is in and nothing is pending', async () => {
    addReplica('one.md', [[1]]);
    addReplica('two.md', [[2]]);
    invokeMock.mockResolvedValue([0, 1]);

    await importOnce();

    expect(harness.deleted.sort()).toEqual([`${REPLICA}one.md`, `${REPLICA}two.md`, RECORDS].sort());
  });

  it('drops an empty replica without waiting for an import', async () => {
    addReplica('empty.md', []);
    invokeMock.mockResolvedValue([]);

    await importOnce();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(harness.deleted.sort()).toEqual([`${REPLICA}empty.md`, RECORDS].sort());
  });
});
