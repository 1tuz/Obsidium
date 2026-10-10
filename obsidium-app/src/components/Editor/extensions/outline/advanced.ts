import { EditorSelection, Prec, type StateCommand } from '@codemirror/state';
import { foldCode, foldService, unfoldCode } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { moveOutlineSubtree, outlineChildRange } from './move';

function move(direction: 'up' | 'down'): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly || !state.selection.main.empty || state.selection.ranges.length !== 1) return false;
    const position = state.selection.main.head;
    const edit = moveOutlineSubtree(state.doc.toString(), position, direction);
    if (!edit) return false;
    dispatch(state.update({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: EditorSelection.cursor(edit.caret),
      scrollIntoView: true,
      userEvent: 'move',
    }));
    return true;
  };
}

/** Keep the normal list editor active when Outliner is off; remove only extra actions. */
export const advancedOutlineExtension = [
  foldService.of((state, from) => outlineChildRange(state.doc.toString(), state.doc.lineAt(from).number)),
  Prec.highest(keymap.of([
    { key: 'Alt-ArrowUp', run: move('up') },
    { key: 'Alt-ArrowDown', run: move('down') },
    { key: 'Mod-Shift-[', run: foldCode },
    { key: 'Mod-Shift-]', run: unfoldCode },
  ])),
];
