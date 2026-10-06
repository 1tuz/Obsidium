import type * as Y from 'yjs';
import { documentText } from '../../modules/docSync/applyExternalText';

export function applyTemplateToDoc(ydoc: Y.Doc, template: string): void {
  const ytext = documentText(ydoc);
  ydoc.transact(() => {
    const current = ytext.toString();
    if (current.trim() === '') {
      ytext.delete(0, ytext.length);
      ytext.insert(0, template);
      return;
    }
    const gap = current.endsWith('\n') ? '\n' : '\n\n';
    ytext.insert(ytext.length, gap + template);
  }, 'template');
}

export function appendQuoteToDoc(ydoc: Y.Doc, quoteMd: string): void {
  const ytext = documentText(ydoc);
  ydoc.transact(() => {
    const needsGap = ytext.length > 0 && !ytext.toString().endsWith('\n');
    ytext.insert(ytext.length, `${needsGap ? '\n\n' : '\n'}${quoteMd}`);
  }, 'book-quote');
}
