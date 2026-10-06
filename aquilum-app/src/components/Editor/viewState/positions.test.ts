import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { encodePosition, initialSelection, resolvePosition } from './positions';
import { documentText } from '../../../modules/docSync/applyExternalText';

describe('view state positions', () => {
  it('keeps a cursor attached through an insertion from another participant', () => {
    const ydoc = new Y.Doc();
    const remoteDoc = new Y.Doc();
    const ytext = documentText(ydoc);
    ytext.insert(0, 'abc');
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc));
    const stored = encodePosition(ytext, 2);
    documentText(remoteDoc).insert(0, 'x');
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(ydoc)));
    expect(resolvePosition(stored, 2, ydoc, ytext)).toBe(3);
  });

  it('clamps a fallback after the document is emptied', () => {
    const ydoc = new Y.Doc();
    const ytext = documentText(ydoc);
    ytext.insert(0, 'content');
    const stored = encodePosition(ytext, 4);
    ytext.delete(0, ytext.length);
    expect(resolvePosition(stored, 4, ydoc, ytext)).toBe(0);
  });

  it('builds the initial CodeMirror selection before mounting', () => {
    const ydoc = new Y.Doc();
    documentText(ydoc).insert(0, 'content');
    const initial = {
      documentId: 'doc', paneId: 'main', cursorAnchor: [], cursorHead: [],
      fallbackAnchor: 3, fallbackHead: 5, scrollAnchor: [],
      fallbackScrollAnchor: 0, scrollOffsetPx: 0, focusedSurface: 'body',
    };
    expect(initialSelection(initial, ydoc, 7)).toEqual({ anchor: 3, head: 5 });
    expect(initialSelection(initial, ydoc, 7, 6)).toEqual({ anchor: 6, head: 6 });
  });
});
