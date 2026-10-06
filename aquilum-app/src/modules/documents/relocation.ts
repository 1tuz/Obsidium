import { closeDoc, getManagedWriterForPath, getOpenDoc, renameDoc } from '../docs';
import { forgetSyncRecord, moveSyncRecord } from '../docSync';
import { clearLocalDoc } from '../sync';

export const NOTES_RELOCATED_EVENT = 'notes-relocated';

export interface NotesRelocated {
  moves: { from: string; to: string }[];
  removed: string[];
}

export interface RelocationTargets {
  renamed: (from: string, to: string) => void;
  deleted: (path: string) => void;
}

export async function applyRelocation(
  event: NotesRelocated,
  targets: RelocationTargets,
): Promise<void> {
  for (const { from, to } of event.moves) {
    adoptMovedDoc(from, to);
    targets.renamed(from, to);
    await moveSyncRecord(from, to);
    if (!getOpenDoc(to)) await clearLocalDoc(from);
  }
  for (const path of event.removed) {
    closeDoc(path);
    targets.deleted(path);
    await Promise.all([clearLocalDoc(path), forgetSyncRecord(path)]);
  }
}

function adoptMovedDoc(from: string, to: string): void {
  if (!getOpenDoc(from)) return;
  const writer = getManagedWriterForPath(from);
  renameDoc(from, to);
  writer?.adoptPath(to);
}
