import { EditorView } from '@codemirror/view';

export const codeHighlightTheme = EditorView.theme({
  '.cm-content .q-code-keyword': { color: 'var(--q-editor-code-keyword)' },
  '.cm-content .q-code-string': { color: 'var(--q-editor-code-string)' },
  '.cm-content .q-code-number': { color: 'var(--q-editor-code-number)' },
  '.cm-content .q-code-comment': { color: 'var(--q-editor-code-comment)', fontStyle: 'italic' },
  '.cm-content .q-code-function': { color: 'var(--q-editor-code-function)' },
  '.cm-content .q-code-type': { color: 'var(--q-editor-code-type)' },
  '.cm-content .q-code-property': { color: 'var(--q-editor-code-property)' },
  '.cm-content .q-code-variable': { color: 'var(--q-editor-code-variable)' },
  '.cm-content .q-code-operator': { color: 'var(--q-editor-code-operator)' },
  '.cm-content .q-code-punctuation': { color: 'var(--q-editor-code-punctuation)' },
});

export const codeBlockTheme = EditorView.theme({
  '.q-md-code-controls': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--q-gap-sm)',
    padding: 'var(--q-space-6) var(--q-space-8)',
    backgroundColor: 'var(--q-block-bg)',
    borderInline: 'var(--q-border-1) solid var(--q-block-border)',
    borderTop: 'var(--q-border-1) solid var(--q-block-border)',
    borderBottom: 'var(--q-border-1) solid var(--q-block-border)',
    borderTopLeftRadius: 'var(--q-block-radius)',
    borderTopRightRadius: 'var(--q-block-radius)',
  },
  '.q-md-code-controls__language, .q-md-code-controls__copy': {
    minHeight: 'var(--q-size-24)',
    border: 'none',
    borderRadius: 'var(--q-radius-md)',
    backgroundColor: 'var(--q-bg-surface-overlay)',
    color: 'var(--q-text-primary)',
    fontFamily: 'var(--q-font-family-ui)',
    fontSize: 'var(--q-font-size-ui-sm)',
  },
  '.q-md-code-controls__language': {
    maxWidth: '11em',
    padding: '0 var(--q-padding-xs)',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
  },
  '.q-md-code-controls__copy': {
    padding: '0 var(--q-padding-xs)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  '.q-md-code-controls__copy:hover': {
    backgroundColor: 'var(--q-icon-button-bg-hover)',
  },
  '.q-md-code-controls__copy--copied': { color: 'var(--q-text-success)' },
  '.q-md-code-controls__copy--failed': { color: 'var(--q-text-danger)' },
  '.q-md-code-controls__language:focus-visible, .q-md-code-controls__copy:focus-visible': {
    outline: 'var(--q-border-2) solid var(--q-border-focus)',
    outlineOffset: 'var(--q-border-2)',
  },
  '.cm-line.q-md-code-line': {
    position: 'relative',
    boxSizing: 'border-box',
    fontFamily: 'var(--q-editor-code-font)',
    paddingLeft: 'var(--q-block-padding)',
    paddingRight: 'var(--q-block-padding)',
  },
  '.cm-line.q-md-code-line::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    zIndex: '-2',
    borderInline: 'var(--q-border-1) solid var(--q-block-border)',
    backgroundColor: 'var(--q-block-bg)',
    pointerEvents: 'none',
  },
  '.cm-line.q-md-code-line--first': {
    paddingTop: 'var(--q-space-8)',
  },
  '.cm-line.q-md-code-line--first::before': {
    borderTop: 'var(--q-border-1) solid var(--q-block-border)',
    borderTopLeftRadius: 'var(--q-block-radius)',
    borderTopRightRadius: 'var(--q-block-radius)',
  },
  '.cm-line.q-md-code-line--last': {
    paddingBottom: 'var(--q-space-8)',
  },
  '.cm-line.q-md-code-line--last::before': {
    borderBottom: 'var(--q-border-1) solid var(--q-block-border)',
    borderBottomLeftRadius: 'var(--q-block-radius)',
    borderBottomRightRadius: 'var(--q-block-radius)',
  },
  '.cm-line.q-md-code-line .q-md-code': {
    padding: '0',
    borderRadius: '0',
    backgroundColor: 'transparent',
  },
});
