import { deleteCharBackward, deleteCharForward, insertNewlineAndIndent } from '@codemirror/commands';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

export interface ReadingEditEntryOptions {
  onEnterEdit: () => void;
}

const pendingClicks = new WeakMap<EditorView, number | null>();

function isTypingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete';
}

export function readingEditEntryExtension(options: ReadingEditEntryOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('keydown', this.onKeyDown, true);
      }

      destroy(): void {
        this.view.dom.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('keydown', this.onKeyDown, true);
      }

      private readonly onMouseDown = (event: MouseEvent): void => {
        if (!this.view.state.readOnly || event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, select, textarea, .q-block-handle, .q-block-slash')) return;
        pendingClicks.set(this.view, this.view.posAtCoords({ x: event.clientX, y: event.clientY }));
      };

      private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (!this.view.state.readOnly || !isTypingKey(event)) return;
        const clicked = pendingClicks.get(this.view) ?? null;
        if (clicked === null && !this.view.hasFocus && !this.view.dom.contains(document.activeElement)) return;
        event.preventDefault();
        pendingClicks.set(this.view, null);
        options.onEnterEdit();
        if (clicked !== null) this.view.dispatch({ selection: { anchor: clicked } });
        this.applyKey(event);
        this.view.focus();
      };

      private applyKey(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
          insertNewlineAndIndent(this.view);
          return;
        }
        if (event.key === 'Backspace') {
          deleteCharBackward(this.view);
          return;
        }
        if (event.key === 'Delete') {
          deleteCharForward(this.view);
          return;
        }
        const selection = this.view.state.selection.main;
        this.view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: event.key },
          selection: { anchor: selection.from + event.key.length },
        });
      }
    },
  );
}
