// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { runEditingAction } from './editingToolbarActions';

function viewFor(text: string, from = 0, to = from): EditorView {
  const state = EditorState.create({ doc: text, selection: { anchor: from, head: to } });
  const parent = document.createElement('div');
  document.body.append(parent);
  return new EditorView({ state, parent });
}

function runOn(text: string, action: Parameters<typeof runEditingAction>[1], from = 0, to = from): string {
  const view = viewFor(text, from, to);
  runEditingAction(view, action);
  const result = view.state.doc.toString();
  view.destroy();
  return result;
}

describe('extra editing toolbar actions', () => {
  it('wraps the selected lines into a callout', () => {
    expect(runOn('plain text', 'callout', 0, 10)).toBe('> [!note]\n> plain text');
  });

  it('unwraps an existing callout back to plain lines', () => {
    expect(runOn('> [!note]\n> plain text', 'callout')).toBe('plain text');
  });

  it('strips inline markers from the selection', () => {
    const source = '**bold** and _italic_ and `code`';
    expect(runOn(source, 'clearFormat', 0, source.length)).toBe('bold and italic and code');
  });

  it('moves the current line down and up', () => {
    expect(runOn('one\ntwo\nthree', 'moveDown', 5)).toBe('one\nthree\ntwo');
    expect(runOn('one\ntwo\nthree', 'moveUp', 5)).toBe('two\none\nthree');
  });

  it('refuses to move the first line up or the last line down', () => {
    expect(runOn('one\ntwo', 'moveUp', 0)).toBe('one\ntwo');
    expect(runOn('one\ntwo', 'moveDown', 5)).toBe('one\ntwo');
  });
});
