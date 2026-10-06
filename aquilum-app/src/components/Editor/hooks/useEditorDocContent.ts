import { useLayoutEffect, useMemo, useState } from 'react';
import type { Text } from '@codemirror/state';
import type * as Y from 'yjs';
import { documentText } from '../../../modules/docSync/applyExternalText';

export const DOCUMENT_HEAD_LIMIT = 16_384;

export function documentHead(doc: Text): string {
  return doc.sliceString(0, Math.min(doc.length, DOCUMENT_HEAD_LIMIT));
}

export function useEditorDocContent(ydoc: Y.Doc, isReady: boolean) {
  const initialBody = useMemo(
    () => (isReady ? documentText(ydoc).toString() : ''),
    [isReady, ydoc],
  );
  const [docContent, setDocContent] = useState(initialBody);

  useLayoutEffect(() => {
    setDocContent(initialBody);
  }, [initialBody]);
  return {
    initialBody,
    docContent,
    setDocContent,
  };
}
