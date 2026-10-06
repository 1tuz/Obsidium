import * as Y from 'yjs';
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';

const ROOM_PREFIX = 'aquilum-sync-';
const REPLICA_TIMEOUT_MS = 10_000;

interface LocalConnection {
  persistence: IndexeddbPersistence;
  connected: boolean;
  connectPromise: Promise<void> | null;
  cancelPendingConnect: (() => void) | null;
}

const connections = new WeakMap<Y.Doc, LocalConnection>();

export function clearLocalDoc(filePath: string): Promise<void> {
  return clearDocument(`${ROOM_PREFIX}${filePath}`);
}

export function connectDoc(doc: Y.Doc, roomName: string): Promise<void> {
  const existing = connections.get(doc);
  if (existing?.connected) return Promise.resolve();
  if (existing?.connectPromise) return existing.connectPromise;

  const persistence = new IndexeddbPersistence(`${ROOM_PREFIX}${roomName}`, doc);
  const connection: LocalConnection = {
    persistence,
    connected: false,
    connectPromise: null,
    cancelPendingConnect: null,
  };
  connections.set(doc, connection);

  const promise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      persistence.off('synced', onSynced);
      if (connections.get(doc) === connection) {
        connection.connected = connected;
        connection.connectPromise = null;
        connection.cancelPendingConnect = null;
      }
      resolve();
    };
    const onSynced = () => finish(true);
    const timeout = setTimeout(() => {
      console.warn(`[aquilum:replica] локальная копия ${roomName} не ответила за ${REPLICA_TIMEOUT_MS} мс, документ открыт с диска`);
      disconnectDoc(doc);
      clearLocalDoc(roomName).catch((error) => {
        console.error('Failed to drop the stale local copy', error);
      });
    }, REPLICA_TIMEOUT_MS);
    connection.cancelPendingConnect = () => finish(false);
    persistence.on('synced', onSynced);
  });
  connection.connectPromise = promise;
  return promise;
}

export function disconnectDoc(doc: Y.Doc): void {
  const connection = connections.get(doc);
  if (!connection) return;
  connections.delete(doc);
  connection.cancelPendingConnect?.();
  void connection.persistence.destroy().catch((error) => {
    console.error('Failed to close document persistence', error);
  });
}
