import { comparablePath } from '../paths';

interface SyncRecord {
  fileHash: string;
  textHash: string;
}

export type SyncRecordLookup =
  | { kind: 'found'; record: SyncRecord }
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: string };

const DATABASE = 'aquilum-file-sync';
const STORE = 'records';

let connection: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function database(): Promise<IDBDatabase | null> {
  if (!connection) connection = openDatabase();
  return connection;
}

async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await database();
  if (!db) throw new Error('IndexedDB недоступна');
  return new Promise((resolve, reject) => {
    let request: IDBRequest<T>;
    try {
      request = operation(db.transaction(STORE, mode).objectStore(STORE));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка IndexedDB'));
  });
}

export async function readSyncRecord(filePath: string): Promise<SyncRecordLookup> {
  try {
    const record = await run<SyncRecord>('readonly', (store) => store.get(comparablePath(filePath)));
    return record ? { kind: 'found', record } : { kind: 'absent' };
  } catch (error) {
    return { kind: 'unavailable', reason: String(error) };
  }
}

export function writeSyncRecord(filePath: string, record: SyncRecord): Promise<unknown> {
  return run('readwrite', (store) => store.put(record, comparablePath(filePath)));
}

export function forgetSyncRecord(filePath: string): Promise<unknown> {
  return run('readwrite', (store) => store.delete(comparablePath(filePath)));
}

export async function moveSyncRecord(fromPath: string, toPath: string): Promise<void> {
  const [lookup, existing] = await Promise.all([readSyncRecord(fromPath), readSyncRecord(toPath)]);
  await forgetSyncRecord(fromPath);
  if (lookup.kind === 'found' && existing.kind === 'absent') await writeSyncRecord(toPath, lookup.record);
}
