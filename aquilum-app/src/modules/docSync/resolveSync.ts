import type { ConflictCause } from './conflictCopy';
import type { SyncRecordLookup } from './syncRecord';

interface SyncEvidence {
  lookup: SyncRecordLookup;
  docHash: string;
}

export interface SyncInputs {
  sessionBase: string | null;
  fileHash: string;
  fileText: string;
  docText: string;
  evidence: () => Promise<SyncEvidence>;
}

export type SyncVerdict =
  | { kind: 'in-sync' }
  | { kind: 'take-file' }
  | { kind: 'publish-document' }
  | { kind: 'merge'; base: string }
  | { kind: 'conflict'; cause: ConflictCause };

export async function resolveSync(inputs: SyncInputs): Promise<SyncVerdict> {
  const { sessionBase, fileHash, fileText, docText } = inputs;

  if (fileText === docText) return { kind: 'in-sync' };
  if (sessionBase !== null) return { kind: 'merge', base: sessionBase };
  if (docText.length === 0) return { kind: 'take-file' };

  const { lookup, docHash } = await inputs.evidence();
  if (lookup.kind === 'absent') return { kind: 'merge', base: docText };
  if (lookup.kind !== 'found') return { kind: 'conflict', cause: 'no-sync-point' };

  const fileUntouched = fileHash === lookup.record.fileHash;
  const documentUntouched = docHash === lookup.record.textHash;

  if (fileUntouched && !documentUntouched) return { kind: 'publish-document' };
  if (documentUntouched && !fileUntouched) return { kind: 'merge', base: docText };
  return { kind: 'conflict', cause: 'diverged' };
}
