// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { runEditingAction } from './editingToolbarActions';

describe('editing toolbar insertion actions', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('inserts an image with the selected text as alt text and selects its URL', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({ doc: 'cover', selection: { anchor: 0, head: 5 } }),
      parent,
    });
    runEditingAction(view, 'image');
    expect(view.state.doc.toString()).toBe('![cover](https://)');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to))
      .toBe('https://');
    parent.remove();
  });
});
