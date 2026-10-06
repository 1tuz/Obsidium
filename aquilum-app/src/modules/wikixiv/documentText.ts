import { getOpenDoc } from '../docs';
import { documentText } from '../docSync';
import { readFileSnapshot } from '../documents/fileGateway';
import { isEmptyTabPath } from '../ui-state';

function isRealDocument(documentPath: string | null): documentPath is string {
  return Boolean(documentPath) && !isEmptyTabPath(documentPath);
}

function readLiveText(documentPath: string | null): string | null {
  if (!isRealDocument(documentPath)) return null;
  const doc = getOpenDoc(documentPath);
  if (!doc) return null;
  return documentText(doc).toString();
}

export async function resolveDocumentText(documentPath: string | null): Promise<string> {
  const live = readLiveText(documentPath);
  if (live !== null) return live;
  if (!isRealDocument(documentPath)) return '';
  try {
    const snapshot = await readFileSnapshot(documentPath);
    return snapshot.content;
  } catch {
    return '';
  }
}
