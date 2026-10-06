import * as Y from 'yjs';
import { clearLocalDoc, disconnectDoc } from '../sync';
import type { DocumentFileWriter } from '../documents/DocumentFileWriter';
import { comparablePath, isInsidePath, samePath } from '../paths';

interface ManagedDoc {
  doc: Y.Doc;
  filePath: string;
  roomPath: string;
  listeners: Set<() => void>;
  references: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  writer: DocumentFileWriter | null;
  synced: boolean;
  reconciled: boolean;
}

const DOC_RETENTION_MS = 5 * 60 * 1000;

const openDocs = new Map<string, ManagedDoc>();
const docsByInstance = new WeakMap<Y.Doc, ManagedDoc>();

export function getOrCreateDoc(filePath: string): Y.Doc {
  const key = comparablePath(filePath);
  const existing = openDocs.get(key);
  if (existing) return existing.doc;

  const doc = new Y.Doc();
  const managed: ManagedDoc = {
    doc,
    filePath,
    roomPath: filePath,
    listeners: new Set(),
    references: 0,
    closeTimer: null,
    writer: null,
    synced: false,
    reconciled: false,
  };

  doc.on('update', () => {
    managed.listeners.forEach((notify) => notify());
  });

  openDocs.set(key, managed);
  docsByInstance.set(doc, managed);
  return doc;
}

export function retainDoc(doc: Y.Doc): void {
  const managed = docsByInstance.get(doc);
  if (!managed) throw new Error('Cannot retain an unmanaged document');
  if (managed.closeTimer !== null) {
    clearTimeout(managed.closeTimer);
    managed.closeTimer = null;
  }
  managed.references += 1;
}

export function releaseDoc(doc: Y.Doc): void {
  const managed = docsByInstance.get(doc);
  if (!managed || managed.references === 0) return;
  managed.references -= 1;
  if (managed.references !== 0 || managed.closeTimer !== null) return;
  managed.closeTimer = setTimeout(() => {
    managed.closeTimer = null;
    if (managed.references === 0) destroyManagedDoc(managed);
  }, DOC_RETENTION_MS);
}

export function isDocSynced(doc: Y.Doc): boolean {
  return docsByInstance.get(doc)?.synced ?? false;
}

export function markDocSynced(doc: Y.Doc): void {
  const managed = docsByInstance.get(doc);
  if (managed) managed.synced = true;
}

export function isDocReconciled(doc: Y.Doc): boolean {
  return docsByInstance.get(doc)?.reconciled ?? false;
}

export function markDocReconciled(doc: Y.Doc): void {
  const managed = docsByInstance.get(doc);
  if (managed) managed.reconciled = true;
}

export function getManagedWriter(doc: Y.Doc): DocumentFileWriter | null {
  return docsByInstance.get(doc)?.writer ?? null;
}

export function getManagedWriterForPath(filePath: string): DocumentFileWriter | null {
  return openDocs.get(comparablePath(filePath))?.writer ?? null;
}

export function setManagedWriter(doc: Y.Doc, writer: DocumentFileWriter): void {
  const managed = docsByInstance.get(doc);
  if (managed) managed.writer = writer;
}

export function getOpenDoc(filePath: string): Y.Doc | null {
  return openDocs.get(comparablePath(filePath))?.doc ?? null;
}

export function closeDoc(filePath: string): void {
  const managed = openDocs.get(comparablePath(filePath));
  if (!managed) return;
  destroyManagedDoc(managed);
}

export function renameDoc(oldPath: string, newPath: string): void {
  const oldKey = comparablePath(oldPath);
  const managed = openDocs.get(oldKey);
  if (!managed) return;

  openDocs.delete(oldKey);
  managed.filePath = newPath;
  openDocs.set(comparablePath(newPath), managed);
}

export function onDocChange(filePath: string, callback: () => void): () => void {
  const managed = openDocs.get(comparablePath(filePath));
  if (!managed) return () => { };

  managed.listeners.add(callback);
  return () => managed.listeners.delete(callback);
}

export function flushOpenDocuments(): Promise<void> {
  return settleWriters(Array.from(openDocs.values()));
}

export function flushDocumentsUnder(folderPath: string): Promise<void> {
  return settleWriters(Array.from(openDocs.values()).filter((managed) => (
    samePath(managed.filePath, folderPath) || isInsidePath(managed.filePath, folderPath)
  )));
}

function settleWriters(managed: ManagedDoc[]): Promise<void> {
  const pending = managed.map((entry) => entry.writer?.idle().catch((error) => {
    console.error('Failed to settle a document write', error);
  }));
  return Promise.all(pending).then(() => undefined);
}

function destroyManagedDoc(managed: ManagedDoc): void {
  if (managed.closeTimer !== null) clearTimeout(managed.closeTimer);
  managed.closeTimer = null;
  void managed.writer?.flush().catch((error) => console.error('Failed to flush document', error));
  managed.listeners.clear();
  const key = comparablePath(managed.filePath);
  if (openDocs.get(key) === managed) {
    openDocs.delete(key);
  }
  docsByInstance.delete(managed.doc);
  disconnectDoc(managed.doc);
  managed.doc.destroy();
  if (comparablePath(managed.roomPath) !== key) {
    void clearLocalDoc(managed.roomPath)
      .catch((error) => console.error('Failed to forget the local copy of a moved note', error));
  }
}
