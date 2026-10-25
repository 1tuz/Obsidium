import { revertDocument } from '../documents/documentGateway';
import { comparablePath } from '../paths';
import { PathQueue } from '../pathQueue';
import { readNoteVersion, type NoteVersion } from './index';

export interface ChunkChange {
  /** Диапазон куска в тексте версии, предшествующей этой. */
  previous: { from: number; to: number };
  /** Диапазон куска в тексте самой версии. */
  version: { from: number; to: number };
}

export interface VersionChunk {
  /** Диапазон куска в тексте версии. */
  from: number;
  /** Конец диапазона куска в тексте версии. */
  to: number;
  /** Текст версии целиком — база слияния при записи. */
  versionText: string;
  /** Текст версии, в котором отменён только этот кусок. */
  revertedText: string;
}

const pending = new PathQueue<boolean>();
const reverted = new Set<string>();

function chunkKey(path: string, version: NoteVersion, chunk: VersionChunk): string {
  return `${comparablePath(path)}\u0000${version.id}\u0000${chunk.from}:${chunk.to}`;
}

export function revertChunkText(versionText: string, previousText: string, change: ChunkChange): string {
  let insert = previousText.slice(change.previous.from, Math.max(change.previous.from, change.previous.to - 1));
  if (change.previous.from !== change.previous.to && change.version.to <= versionText.length) insert += '\n';
  return versionText.slice(0, change.version.from)
    + insert
    + versionText.slice(Math.min(versionText.length, change.version.to));
}

export function revertVersionChunk(path: string, version: NoteVersion, chunk: VersionChunk): Promise<boolean> {
  const key = chunkKey(path, version, chunk);
  return pending.run(path, async () => {
    if (reverted.has(key)) return true;
    if (chunk.revertedText === chunk.versionText) return false;
    const texts = await readNoteVersion(path, version.id);
    if (!texts || texts.text !== chunk.versionText) return false;
    await revertDocument(path, texts.text, chunk.revertedText, version.atMs);
    reverted.add(key);
    return true;
  });
}
