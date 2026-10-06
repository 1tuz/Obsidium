import type * as Y from 'yjs';
import { applyDocumentText } from '../docSync';

export function applyYdocText(ydoc: Y.Doc, next: string): void {
  applyDocumentText(ydoc, next, 'frontmatter');
}
