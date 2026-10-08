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
  | 'table' | 'rule' | 'indent' | 'outdent';

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

function applyLink(view: EditorView): void {
  const state = view.state;
  const spec = state.changeByRange((range) => {
    const selected = state.doc.sliceString(range.from, range.to);
    const label = selected || 'link';
    const insert = `[${label}](https://)`;
    const start = selected ? range.from + label.length + 3 : range.from + 1;
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
    case 'bullet': case 'ordered': case 'task': case 'quote':
      applyBlock(view, action);
      break;
    case 'codeBlock': applyCodeBlock(view); break;
    case 'link': applyLink(view); break;
    case 'table': insertTable(view); break;
    case 'rule': applyRule(view); break;
    case 'indent': indentMore(view); break;
    case 'outdent': indentLess(view); break;
  }
  view.focus();
  return true;
}
