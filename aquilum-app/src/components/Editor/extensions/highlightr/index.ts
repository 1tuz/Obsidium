import { EditorSelection, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { clearColorMarkEdit, colorMarkEdit, coloredMarks, type ColorMarkEdit } from './markup';

function inCode(view: EditorView, position: number): boolean {
  let node = syntaxTree(view.state).resolveInner(position, 1);
  while (node) {
    if (/^(FencedCode|CodeBlock|CodeText|InlineCode)$/.test(node.name)) return true;
    node = node.parent!;
  }
  return false;
}

function decorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  if (!view.visibleRanges.length) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const caret = view.state.selection.main.head;
  // Scan only the viewport (plus context for opening/closing tags).
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    const from = Math.max(0, visible.from - 2048);
    const to = Math.min(doc.length, visible.to + 2048);
    for (const mark of coloredMarks(doc.sliceString(from, to))) {
      const open = from + mark.from;
      const openTo = from + mark.openTo;
      const textTo = from + mark.textTo;
      const end = from + mark.to;
      if (seen.has(open) || end <= visible.from || open >= visible.to || inCode(view, open)) continue;
      seen.add(open);
      if (textTo > openTo) {
        ranges.push(Decoration.mark({ class: 'q-md-colored-highlight',
          attributes: { style: `background-color: ${mark.color}` } }).range(openTo, textTo));
      }
      if (caret < open || caret > end) {
        ranges.push(Decoration.replace({}).range(open, openTo));
        ranges.push(Decoration.replace({}).range(textTo, end));
      }
    }
  }
  return Decoration.set(ranges, true);
}

const coloredMarksView = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = decorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });

const coloredMarksTheme = EditorView.theme({
  '.q-md-colored-highlight': {
    borderRadius: 'var(--q-rounded-sm)',
    paddingInline: '1px',
    boxDecorationBreak: 'clone',
    color: 'var(--q-text-primary)',
  },
});

export const coloredHighlightExtension = [coloredMarksView, coloredMarksTheme];

function dispatchEdit(view: EditorView, edit: ColorMarkEdit): void {
  view.dispatch(view.state.update({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.anchor, edit.head),
    scrollIntoView: true,
    userEvent: 'input',
  }));
  view.focus();
}

export function applyColoredHighlight(view: EditorView, color: string): void {
  if (view.state.readOnly) return;
  const { from, to } = view.state.selection.main;
  dispatchEdit(view, colorMarkEdit(view.state.doc.toString(), from, to, color));
}

export function removeColoredHighlight(view: EditorView): void {
  if (view.state.readOnly) return;
  const { from, to } = view.state.selection.main;
  const edit = clearColorMarkEdit(view.state.doc.toString(), from, to);
  if (edit) dispatchEdit(view, edit);
}
