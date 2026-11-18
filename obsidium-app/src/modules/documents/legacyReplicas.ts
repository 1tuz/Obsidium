import { invoke } from '@tauri-apps/api/core';
import { comparablePath } from '../paths';

const REPLICA_PREFIX = 'aquilum-sync-';
const UPDATES_STORE = 'updates';
const RECORDS_DATABASE = 'aquilum-file-sync';
const RECORDS_STORE = 'records';

interface LegacyPoint {
  fileHash: string;
  textHash: string;
}

interface LegacyReplica {
  path: string;
  updates: number[][];
  point: LegacyPoint | null;
}

interface ReadOutcome<T> {
  confirmed: boolean;
  value: T | null;
}

type RecordsSource =
  | { kind: 'absent' }
  | { kind: 'unavailable' }
  | { kind: 'present'; database: IDBDatabase };

interface ReplicaSource {
  name: string;
  replica: LegacyReplica | null;
  confirmed: boolean;
}

let importing: Promise<void> | null = null;

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readConfirmed<T>(database: IDBDatabase, store: string, read: (store: IDBObjectStore) => IDBRequest<T>): Promise<ReadOutcome<T>> {
  if (!database.objectStoreNames.contains(store)) return Promise.resolve({ confirmed: true, value: null });
  return new Promise((resolve) => {
    const request = read(database.transaction(store, 'readonly').objectStore(store));
    request.onsuccess = () => resolve({ confirmed: true, value: request.result });
    request.onerror = () => resolve({ confirmed: false, value: null });
  });
}

async function readReplica(name: string, records: RecordsSource): Promise<ReplicaSource> {
  const database = await openExisting(name);
  if (!database) return { name, replica: null, confirmed: false };
  try {
    const updates = await readConfirmed<Uint8Array[]>(database, UPDATES_STORE, (store) => store.getAll());
    if (!updates.confirmed) return { name, replica: null, confirmed: false };
    if (!updates.value || updates.value.length === 0) return { name, replica: null, confirmed: true };
    const path = name.slice(REPLICA_PREFIX.length);
    if (records.kind === 'unavailable') return { name, replica: null, confirmed: false };
    const point = records.kind === 'absent'
      ? { confirmed: true, value: null }
      : await readConfirmed<LegacyPoint | undefined>(records.database, RECORDS_STORE, (store) => store.get(comparablePath(path)));
    if (!point.confirmed || (records.kind === 'present' && point.value == null)) {
      return { name, replica: null, confirmed: false };
    }
    return {
      name,
      confirmed: true,
      replica: { path, updates: updates.value.map((update) => Array.from(update)), point: point.value ?? null },
    };
  } finally {
    database.close();
  }
}

function deleteDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => {
      console.error(`Failed to delete the old local copy ${name}`, request.error);
      resolve(false);
    };
    request.onblocked = () => resolve(false);
  });
}

async function importNow(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) return;
  const names = (await indexedDB.databases()).map((info) => info.name ?? '');
  const replicaNames = names.filter((name) => name.startsWith(REPLICA_PREFIX));
  const hasRecords = names.includes(RECORDS_DATABASE);
  if (replicaNames.length === 0 && !hasRecords) return;
  const opened = hasRecords ? await openExisting(RECORDS_DATABASE) : null;
  const records: RecordsSource = !hasRecords
    ? { kind: 'absent' }
    : opened
      ? { kind: 'present', database: opened }
      : { kind: 'unavailable' };
  let confirmed: string[] = [];
  try {
    const sources = await Promise.all(replicaNames.map((name) => readReplica(name, records)));
    const pending = sources.filter((source): source is ReplicaSource & { replica: LegacyReplica } => (
      source.confirmed && source.replica !== null
    ));
    const imported = pending.length === 0
      ? []
      : await invoke<number[]>('document_import_legacy', { replicas: pending.map((source) => source.replica) });
    const confirmedImports = new Set(imported.map((index) => pending[index]?.name));
    confirmed = sources
      .filter((source) => source.confirmed && (source.replica === null || confirmedImports.has(source.name)))
      .map((source) => source.name);
  } finally {
    if (records.kind === 'present') records.database.close();
  }
  const recordsConfirmed = hasRecords && records.kind !== 'unavailable' && confirmed.length === replicaNames.length;
  const removed = await Promise.all(confirmed.map(deleteDatabase));
  if (recordsConfirmed && removed.every(Boolean)) await deleteDatabase(RECORDS_DATABASE);
}

export function legacyReplicasImported(): Promise<void> {
  if (!importing) {
    importing = importNow().catch((error: unknown) => {
      console.error('Failed to move local copies from the previous version', error);
    });
  }
  return importing;
}
