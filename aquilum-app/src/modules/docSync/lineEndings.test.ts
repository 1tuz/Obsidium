import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import * as Y from 'yjs';
import { documentText } from './applyExternalText';

const CRLF = 'первая\r\nвторая\r\nтретья';

describe('line endings', () => {
  it('would desynchronise CodeMirror and Y.Doc without normalisation', () => {
    const ydoc = new Y.Doc();
    documentText(ydoc).insert(0, CRLF);
    const state = EditorState.create({ doc: documentText(ydoc).toString() });

    expect(documentText(ydoc).length).toBe(CRLF.length);
    expect(state.doc.length).toBe(CRLF.length - 2);
  });
});
