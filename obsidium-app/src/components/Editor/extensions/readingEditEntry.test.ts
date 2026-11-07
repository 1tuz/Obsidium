// @vitest-environment happy-dom
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readingEditEntryExtension } from './readingEditEntry';

let view: EditorView | null = null;
let mode: Compartment | null = null;

function mount(): void {
  const parent = document.createElement('div');
  document.body.append(parent);
  mode = new Compartment();
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'alpha\n\nbeta\n',
      extensions: [
        mode.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
        readingEditEntryExtension({ onEnterEdit }),
      ],
    }),
  });
  view.focus();
}

const onEnterEdit = vi.fn(() => {
  view?.dispatch({
    effects: mode!.reconfigure([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
  });
});

afterEach(() => {
  view?.destroy();
  view = null;
  onEnterEdit.mockClear();
});

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('reading edit entry', () => {
  it('switches to editing and applies the typed character at the clicked position', () => {
    mount();
    vi.spyOn(view!, 'posAtCoords').mockReturnValue(3);
    view!.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    press('x');
    expect(onEnterEdit).toHaveBeenCalledTimes(1);
    expect(view!.state.readOnly).toBe(false);
    expect(view!.state.doc.toString()).toBe('alpxha\n\nbeta\n');
    expect(view!.state.selection.main.anchor).toBe(4);
  });

  it('replays Enter as a newline at the clicked position', () => {
    mount();
    vi.spyOn(view!, 'posAtCoords').mockReturnValue(5);
    view!.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    press('Enter');
    expect(view!.state.doc.toString()).toBe('alpha\n\n\nbeta\n');
  });

  it('ignores typing keys that follow no click while the editor is unfocused', () => {
    mount();
    view!.contentDOM.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    press('x');
    expect(onEnterEdit).not.toHaveBeenCalled();
    expect(view!.state.doc.toString()).toBe('alpha\n\nbeta\n');
  });

  it('ignores shortcut keys with modifiers', () => {
    mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onEnterEdit).not.toHaveBeenCalled();
    expect(view!.state.doc.toString()).toBe('alpha\n\nbeta\n');
  });
});
