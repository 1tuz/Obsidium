import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertTable } from './extensions/tables';
import {
  toggleBoldCommand,
  toggleItalicCommand,
  toggleStrikeCommand,
} from './extensions/formatting';
import { blockMarkdownEdits, inlineMarkdownEdit, type BlockFormat } from './toolbarMarkdown';

export type EditingAction =
  | BlockFormat
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike'
  | 'highlight' | 'inlineCode' | 'codeBlock' | 'link'
  | 'image' | 'table' | 'rule' | 'indent' | 'outdent'
  | 'callout' | 'clearFormat' | 'moveUp' | 'moveDown';

function applyWrap(view: EditorView, marker: string): void {
  const state = view.state;
  const source = state.doc.toString();
  const spec = state.changeByRange((range) => {
    const edit = inlineMarkdownEdit(source, range.from, range.to, marker);
    return {
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      range: EditorSelection.range(edit.anchor, edit.head),
    };
  });
  view.dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
}

function applyShortcut(view: EditorView, run: typeof toggleBoldCommand, marker: string): void {
  const before = view.state;
  run({ state: before, dispatch: view.dispatch.bind(view) });
  if (view.state === before) applyWrap(view, marker);
}

function applyBlock(view: EditorView, action: BlockFormat): void {
  const state = view.state;
  const { from, to } = state.selection.main;
  const changes = blockMarkdownEdits(state.doc.toString(), from, to, action);
  if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
}

function applyCodeBlock(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to);
  const text = state.doc.sliceString(first.from, last.to);
  const wrapped = text.startsWith('```\n') && text.endsWith('\n```');
  const insert = wrapped ? text.slice(4, -4) : `\`\`\`\n${text}\n\`\`\``;
  view.dispatch({
    changes: { from: first.from, to: last.to, insert },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function applyLink(view: EditorView, image = false): void {
  const state = view.state;
  const spec = state.changeByRange((range) => {
    const selected = state.doc.sliceString(range.from, range.to);
    const label = selected || (image ? 'alt' : 'link');
    const prefix = image ? '![' : '[';
    const insert = `${prefix}${label}](https://)`;
    const start = selected ? range.from + prefix.length + label.length + 2 : range.from + prefix.length;
    const end = selected ? start + 8 : start + label.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(start, end),
    };
  });
  view.dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
}

function applyRule(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const before = state.doc.sliceString(0, range.from);
  const after = state.doc.sliceString(range.to);
  const prefix = before.length === 0 || before.endsWith('\n\n')
    ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = after.startsWith('\n\n')
    ? '' : after.startsWith('\n') || after.length === 0 ? '\n' : '\n\n';
  const insert = `${prefix}---${suffix}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    userEvent: 'input',
    scrollIntoView: true,
  });
}

function applyCallout(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  let first = state.doc.lineAt(range.from).number;
  let last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
  while (first > 1 && /^>/.test(state.doc.line(first - 1).text)) first -= 1;
  while (last < state.doc.lines && /^>/.test(state.doc.line(last + 1).text)) last += 1;
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  const lines = state.doc.sliceString(from, to).split('\n');
  const isCallout = lines.some((line) => /^> ?\[!\w+\]/.test(line));
  const insert = isCallout
    ? lines
      .filter((line) => !/^> ?\[!\w+\]/.test(line))
      .map((line) => line.replace(/^> ?/, ''))
      .join('\n')
    : ['> [!note]', ...lines.map((line) => `> ${line}`)].join('\n');
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(from, from + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function applyClearFormat(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  if (range.empty) return;
  const text = state.doc.sliceString(range.from, range.to);
  const cleared = text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/==(.+?)==/gs, '$1')
    .replace(/(?<!`)\*(?!\*)(.+?)(?<!`)\*(?!\*)/gs, '$1')
    .replace(/(?<!`)_(?!_)(.+?)(?<!`)_(?!_)/gs, '$1')
    .replace(/`([^`]+)`/g, '$1');
  if (cleared === text) return;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: cleared },
    selection: EditorSelection.range(range.from, range.from + cleared.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function moveLines(view: EditorView, direction: -1 | 1): void {
  const state = view.state;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to);
  if (direction < 0 && first.number === 1) return;
  if (direction > 0 && last.number === state.doc.lines) return;
  const block = state.doc.sliceString(first.from, last.to);
  if (direction < 0) {
    const above = state.doc.line(first.number - 1);
    view.dispatch({
      changes: [
        { from: above.from, to: above.to, insert: block },
        { from: first.from, to: last.to, insert: above.text },
      ],
      selection: EditorSelection.range(
        above.from,
        above.from + block.length,
      ),
      scrollIntoView: true,
      userEvent: 'move',
    });
    return;
  }
  const below = state.doc.line(last.number + 1);
  view.dispatch({
    changes: [
      { from: first.from, to: last.to, insert: below.text },
      { from: below.from, to: below.to, insert: block },
    ],
    selection: EditorSelection.range(
      below.from - block.length + below.text.length,
      below.from - block.length + below.text.length + block.length,
    ),
    scrollIntoView: true,
    userEvent: 'move',
  });
}

export function runEditingAction(view: EditorView, action: EditingAction): boolean {
  if (view.state.readOnly) return false;
  switch (action) {
    case 'undo': undo(view); break;
    case 'redo': redo(view); break;
    case 'bold': applyShortcut(view, toggleBoldCommand, '**'); break;
    case 'italic': applyShortcut(view, toggleItalicCommand, '*'); break;
    case 'strike': applyShortcut(view, toggleStrikeCommand, '~~'); break;
    case 'highlight': applyWrap(view, '=='); break;
    case 'inlineCode': applyWrap(view, '`'); break;
    case 'h1': case 'h2': case 'h3':
    case 'h4': case 'h5': case 'h6':
    case 'bullet': case 'ordered': case 'task': case 'quote':
      applyBlock(view, action);
      break;
    case 'codeBlock': applyCodeBlock(view); break;
    case 'link': applyLink(view); break;
    case 'image': applyLink(view, true); break;
    case 'table': insertTable(view); break;
    case 'rule': applyRule(view); break;
    case 'indent': indentMore(view); break;
    case 'outdent': indentLess(view); break;
    case 'callout': applyCallout(view); break;
    case 'clearFormat': applyClearFormat(view); break;
    case 'moveUp': moveLines(view, -1); break;
    case 'moveDown': moveLines(view, 1); break;
  }
  view.focus();
  return true;
}
