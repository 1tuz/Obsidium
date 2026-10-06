import type * as Y from 'yjs';
import type { DocumentFileWriter } from '../documents/DocumentFileWriter';
import {
  existingFiles,
  hashText,
  isFileCommandError,
  readFileHash,
  readFileSnapshot,
  type FileSnapshot,
} from '../documents/fileGateway';
import { applyTextEdits, documentText } from './applyExternalText';
import { writeConflictCopy, type ConflictReport } from './conflictCopy';
import { mergeExternalChange } from './mergeText';
import { resolveSync, type SyncVerdict } from './resolveSync';
import { readSyncRecord, writeSyncRecord } from './syncRecord';
import { caretAtSameLine, type TextEdit } from './textDiff';

interface DiskSyncOptions {
  ydoc: Y.Doc;
  path: () => string;
  writer: () => DocumentFileWriter | null;
  reconciled?: boolean;
  onMissingChange?: (missing: boolean) => void;
  onExternalEdit?: (edit: TextEdit) => void;
  onConflictCopy?: (path: string) => void;
  onReconciled?: () => void;
}

export interface DiskSync {
  pull: (known?: FileSnapshot) => Promise<void>;
  readonly applying: boolean;
  dispose: () => void;
}

async function isMissing(path: string): Promise<boolean> {
  try {
    return (await existingFiles([path])).length === 0;
  } catch (error) {
    console.error('Failed to check whether the file exists', error);
    return false;
  }
}

interface CaretPort {
  read: () => number | null;
  restore: (position: number) => void;
}

export function createDiskSync(options: DiskSyncOptions & { caret?: CaretPort }): DiskSync {
  let running: Promise<void> | null = null;
  let repeat = false;
  let applying = false;
  let disposed = false;
  let reconciled = options.reconciled ?? false;

  const text = () => documentText(options.ydoc).toString();

  const remember = (fileHash: string, textHash: string): void => {
    reconciled = true;
    options.onReconciled?.();
    void writeSyncRecord(options.path(), { fileHash, textHash })
      .catch((error) => console.error('Failed to remember the file sync point', error));
  };

  const applyToDocument = (edits: readonly TextEdit[], announce: boolean): void => {
    if (edits.length === 0) return;
    const caret = options.caret?.read() ?? null;
    const before = caret === null ? '' : text();

    applying = true;
    try {
      applyTextEdits(options.ydoc, edits);
    } finally {
      applying = false;
    }

    const underCaret = caret !== null && edits.some((edit) => edit.to > edit.from
      && caret > edit.from && caret <= edit.to);
    if (underCaret) {
      options.caret?.restore(caretAtSameLine(before, text(), caret));
    }
    if (announce) edits.forEach((edit) => options.onExternalEdit?.(edit));
  };

  const publish = async (writer: DocumentFileWriter, content: string): Promise<void> => {
    try {
      const result = await writer.write(content);
      remember(result.hash, result.hash);
    } catch (error) {
      if (isFileCommandError(error, 'conflict')) repeat = true;
      else console.error('Failed to publish the document to disk', error);
    }
  };

  const preserve = async (body: string, detail: ConflictReport): Promise<void> => {
    try {
      const copy = await writeConflictCopy(options.path(), body, detail);
      if (copy) options.onConflictCopy?.(copy);
    } catch (error) {
      console.error('Failed to keep a conflict copy', error);
    }
  };

  const readDisk = async (
    writer: DocumentFileWriter,
    known?: FileSnapshot,
  ): Promise<FileSnapshot | null> => {
    try {
      if (known) {
        options.onMissingChange?.(false);
        return known;
      }
      const hash = await readFileHash(options.path());
      if (disposed) return null;
      options.onMissingChange?.(false);
      if (reconciled && hash === writer.syncedHash) return null;
      return await readFileSnapshot(options.path());
    } catch (error) {
      if (disposed) return null;
      if (await isMissing(options.path())) options.onMissingChange?.(true);
      else console.error('Failed to read the file from disk', error);
      return null;
    }
  };

  const decide = (
    snapshot: FileSnapshot,
    sessionBase: string | null,
    docText: string,
  ): Promise<SyncVerdict> => resolveSync({
    sessionBase,
    fileHash: snapshot.hash,
    fileText: snapshot.content,
    docText,
    evidence: async () => {
      const [lookup, docHash] = await Promise.all([readSyncRecord(options.path()), hashText(docText)]);
      if (lookup.kind === 'unavailable') console.error('Sync record storage is unavailable', lookup.reason);
      return { lookup, docHash };
    },
  });

  const takeFile = (snapshot: FileSnapshot, docText: string): void => {
    applyToDocument(mergeExternalChange(docText, snapshot.content, docText).edits, false);
  };

  const merge = async (
    writer: DocumentFileWriter,
    snapshot: FileSnapshot,
    base: string,
    docText: string,
    announce: boolean,
  ): Promise<void> => {
    const merged = mergeExternalChange(base, snapshot.content, docText);
    if (merged.coarse) {
      console.warn('Merged coarsely: the file diverged by more than the line-diff threshold');
    }
    applyToDocument(merged.edits, announce);
    if (merged.displaced.length > 0) {
      await preserve(merged.displaced.join('\n'), {
        cause: 'displaced',
        diskHash: snapshot.hash,
        syncedHash: writer.syncedHash,
      });
    }
    writer.adopt(snapshot);

    const result = text();
    if (result === snapshot.content) remember(snapshot.hash, snapshot.textHash);
    else await publish(writer, result);
  };

  const sync = async (known?: FileSnapshot): Promise<void> => {
    const writer = options.writer();
    if (!writer) return;

    await writer.settled();
    if (disposed) return;

    const snapshot = await readDisk(writer, known);
    if (!snapshot || disposed) return;

    const docText = text();
    const sessionBase = reconciled ? writer.syncedContent : null;
    const verdict = await decide(snapshot, sessionBase, docText);
    if (disposed) return;

    switch (verdict.kind) {
      case 'in-sync':
        writer.adopt(snapshot);
        remember(snapshot.hash, snapshot.textHash);
        return;
      case 'publish-document':
        writer.adopt(snapshot);
        await publish(writer, docText);
        return;
      case 'conflict':
        await preserve(docText, {
          cause: verdict.cause,
          diskHash: snapshot.hash,
          syncedHash: writer.syncedHash,
        });
        takeFile(snapshot, docText);
        writer.adopt(snapshot);
        remember(snapshot.hash, snapshot.textHash);
        return;
      case 'take-file':
        takeFile(snapshot, docText);
        writer.adopt(snapshot);
        remember(snapshot.hash, snapshot.textHash);
        return;
      case 'merge':
        await merge(writer, snapshot, verdict.base, docText, sessionBase !== null);
    }
  };

  const start = (known?: FileSnapshot): Promise<void> => {
    running = sync(known)
      .catch((error) => console.error('Failed to sync document with disk', error))
      .finally(() => {
        running = null;
        if (disposed || !repeat) return;
        repeat = false;
        void start();
      });
    return running;
  };

  return {
    pull: (known?: FileSnapshot) => {
      if (!running) return start(known);
      repeat = true;
      return running;
    },
    get applying() {
      return applying;
    },
    dispose() {
      disposed = true;
    },
  };
}
