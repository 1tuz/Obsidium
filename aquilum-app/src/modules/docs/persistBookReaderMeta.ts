import {
  isFileCommandError,
  readFileSnapshot,
  writeFileAtomic,
  type WriteSource,
} from '../documents/fileGateway';
import { applyDocumentText, DIRECT_WRITE_ORIGIN, documentText } from '../docSync';
import { PathQueue } from '../pathQueue';
import { comparablePath } from '../paths';
import {
  FM_READ_PERCENT,
  FM_READER_POSITION,
  formatReadPercent,
  setFrontmatterField,
} from './frontmatter';
import { parsePages } from './bookProgress';
import { publishBookPageProgress } from './bookPageRuntime';
import { getManagedWriterForPath, getOpenDoc } from './index';

type BookReaderMeta = {
  pages?: string;
  readerPosition?: string;
  readPercent?: number;
};

const READING_WRITE: WriteSource = { kind: 'readingProgress' };
const writes = new PathQueue<void>();
const pendingMeta = new Map<string, BookReaderMeta>();

function metaFields(meta: BookReaderMeta): [string, string][] {
  const fields: [string, string][] = [];
  if (meta.pages !== undefined) fields.push(['pages', meta.pages]);
  if (meta.readerPosition !== undefined) fields.push([FM_READER_POSITION, meta.readerPosition]);
  if (meta.readPercent !== undefined) {
    fields.push([FM_READ_PERCENT, formatReadPercent(meta.readPercent / 100)]);
  }
  return fields;
}

function applyMetaFields(doc: string, meta: BookReaderMeta): string | null {
  let next: string | null = doc;
  for (const [key, value] of metaFields(meta)) {
    next = setFrontmatterField(next, key, value);
    if (next === null) return null;
  }
  return next;
}

async function writeMeta(pagePath: string, meta: BookReaderMeta): Promise<void> {
  if (meta.pages !== undefined) {
    publishBookPageProgress(pagePath, parsePages(meta.pages));
  }

  const openDoc = getOpenDoc(pagePath);
  const writer = getManagedWriterForPath(pagePath);
  if (openDoc && writer) {
    const text = documentText(openDoc);
    const current = text.toString();
    const next = applyMetaFields(current, meta);
    if (next === null || next === current) return;
    applyDocumentText(openDoc, next, DIRECT_WRITE_ORIGIN);
    await tolerateConflict(writer.writeCurrent(() => text.toString(), READING_WRITE));
    return;
  }

  const snapshot = await readFileSnapshot(pagePath);
  const next = applyMetaFields(snapshot.content, meta);
  if (!next || next === snapshot.content) return;
  await tolerateConflict(writeFileAtomic(pagePath, next, snapshot.hash, READING_WRITE));
}

async function tolerateConflict(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (error) {
    if (!isFileCommandError(error, 'conflict')) throw error;
    console.warn('Reader position skipped: the note changed on disk while it was being saved');
  }
}

async function writePendingMeta(pagePath: string): Promise<void> {
  const key = comparablePath(pagePath);
  const meta = pendingMeta.get(key);
  if (!meta) return;
  pendingMeta.delete(key);
  await writeMeta(pagePath, meta);
}

export function persistBookReaderMeta(pagePath: string, meta: BookReaderMeta): Promise<void> {
  const key = comparablePath(pagePath);
  pendingMeta.set(key, { ...pendingMeta.get(key), ...meta });
  return writes.run(pagePath, () => writePendingMeta(pagePath));
}

export async function flushBookReaderMeta(pagePath: string): Promise<void> {
  await writes.current(pagePath);
}
