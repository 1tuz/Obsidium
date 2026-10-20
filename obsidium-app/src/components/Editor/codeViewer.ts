import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  LanguageDescription,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

export function languageForPath(path: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, path);
}

export const codeViewerTheme = EditorView.theme({
  '&': {
    color: 'var(--q-text-primary)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--q-editor-code-font)',
    fontSize: 'var(--q-editor-font-size)',
    lineHeight: 'var(--q-editor-line-height)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: 'var(--q-padding-md) 0',
  },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--q-text-tertiary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: 'var(--q-size-48)',
    padding: '0 var(--q-padding-sm) 0 var(--q-padding-md)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 var(--q-padding-xs)',
    color: 'var(--q-text-tertiary)',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: 'var(--q-text-primary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--q-bg-surface-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--q-text-primary)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--q-selection-bg)',
    outline: 'var(--q-border-1) solid var(--q-border-accent)',
  },
  '.cm-nonmatchingBracket': {
    color: 'var(--q-text-danger)',
  },
  '.cm-foldPlaceholder': {
    padding: '0 var(--q-padding-xs)',
    border: 'var(--q-border-1) solid var(--q-border-default)',
    borderRadius: 'var(--q-radius-sm)',
    backgroundColor: 'var(--q-bg-surface-raised)',
    color: 'var(--q-text-secondary)',
  },
});

export const codeViewerSetup: Extension = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
  indentOnInput(),
  indentUnit.of('    '),
  EditorState.tabSize.of(4),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  bracketMatching(),
  foldGutter({ openText: '▾', closedText: '▸' }),
];
