import type * as Y from 'yjs';
import { diffText, type TextEdit } from './textDiff';

const DOC_TEXT_NAME = 'codemirror';
export const EXTERNAL_ORIGIN = 'external-file';
export const DIRECT_WRITE_ORIGIN = 'direct-write';

export function documentText(ydoc: Y.Doc): Y.Text {
  return ydoc.getText(DOC_TEXT_NAME);
}

export function applyTextEdits(
  ydoc: Y.Doc,
  edits: readonly TextEdit[],
  origin: string = EXTERNAL_ORIGIN,
): void {
  if (edits.length === 0) return;
  const ytext = documentText(ydoc);
  const ordered = [...edits].sort((left, right) => right.from - left.from);
  ydoc.transact(() => {
    for (const edit of ordered) {
      if (edit.to > edit.from) ytext.delete(edit.from, edit.to - edit.from);
      if (edit.insert) ytext.insert(edit.from, edit.insert);
    }
  }, origin);
}

export function applyDocumentText(
  ydoc: Y.Doc,
  next: string,
  origin: string = EXTERNAL_ORIGIN,
): TextEdit | null {
  const edit = diffText(documentText(ydoc).toString(), next);
  if (edit) applyTextEdits(ydoc, [edit], origin);
  return edit;
}
