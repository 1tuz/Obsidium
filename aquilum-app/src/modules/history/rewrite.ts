import type * as Y from 'yjs';
import {
  applyDocumentText,
  applyEditsToText,
  applyTextEdits,
  DIRECT_WRITE_ORIGIN,
  documentText,
  mergeExternalChange,
  writeConflictCopy,
} from '../docSync';
import { getManagedWriterForPath, getOpenDoc } from '../docs';
import type { WriteSource } from '../documents/fileGateway';
import { PathQueue } from '../pathQueue';
import { readNoteVersion, type NoteVersion, type VersionTexts } from './index';
import { closeVersion } from './openedVersions';

interface Change {
  text: string;
  apply: (doc: Y.Doc) => void;
  displaced: string[];
}

type Plan = (texts: VersionTexts, current: string) => Change | null;

export type Rewrite = (path: string, version: NoteVersion) => Promise<boolean>;

const running = new PathQueue<boolean>();

async function rewrite(path: string, version: NoteVersion, source: WriteSource, plan: Plan): Promise<boolean> {
  const doc = getOpenDoc(path);
  const writer = getManagedWriterForPath(path);
  if (!doc || !writer) return false;
  await writer.idle();
  const texts = await readNoteVersion(path, version.id);
  const change = texts && plan(texts, documentText(doc).toString());
  if (!change) return false;
  await writer.write(change.text, source);
  change.apply(doc);
  if (change.displaced.length > 0) {
    await writeConflictCopy(path, change.displaced.join('\n'), { cause: 'reverted' }).catch((error) => {
      console.error('Failed to keep the lines a revert displaced', error);
    });
  }
  return true;
}

function once(path: string, task: () => Promise<boolean>): Promise<boolean> {
  return running.current(path) ?? running.run(path, task);
}

export async function applyFromHistory(
  rewrite: Rewrite,
  path: string,
  version: NoteVersion,
  tabId: string | null,
): Promise<boolean> {
  const done = await rewrite(path, version);
  if (done && tabId) closeVersion(tabId, version);
  return done;
}

export function restoreVersion(path: string, version: NoteVersion): Promise<boolean> {
  return once(path, () => rewrite(path, version, { kind: 'restore', fromMs: version.atMs }, (texts) => ({
    text: texts.text,
    apply: (doc) => {
      applyDocumentText(doc, texts.text, DIRECT_WRITE_ORIGIN);
    },
    displaced: [],
  })));
}

export function revertVersion(path: string, version: NoteVersion): Promise<boolean> {
  return once(path, () => rewrite(path, version, { kind: 'revert', fromMs: version.atMs }, (texts, current) => {
    if (texts.previous === null) return null;
    const merged = mergeExternalChange(texts.text, texts.previous, current);
    return {
      text: applyEditsToText(current, merged.edits),
      apply: (doc) => applyTextEdits(doc, merged.edits, DIRECT_WRITE_ORIGIN),
      displaced: merged.displaced,
    };
  }));
}
