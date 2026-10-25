import { EditorView } from '@codemirror/view';
import { BASE_FENCE_CLASSES } from './constants';

export const baseFenceTheme = EditorView.baseTheme({
  [`.${BASE_FENCE_CLASSES.root}`]: {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
  },
  [`.${BASE_FENCE_CLASSES.card}`]: {
    boxSizing: 'border-box',
    minWidth: '0',
    overflowX: 'auto',
    padding: 'var(--q-block-padding)',
    borderRadius: 'var(--q-block-radius)',
    border: 'var(--q-border-1) solid var(--q-block-border)',
    backgroundColor: 'var(--q-block-bg)',
    fontFamily: 'var(--q-editor-font-family)',
    fontSize: 'var(--q-editor-font-size)',
    lineHeight: 'var(--q-editor-line-height)',
  },
  [`.${BASE_FENCE_CLASSES.pending}`]: {
    minHeight: '96px',
  },
  [`.${BASE_FENCE_CLASSES.head}`]: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--q-gap-md)',
    padding: 'var(--q-gap-sm) 0',
    borderBottom: 'var(--q-border-1) solid var(--q-block-divider)',
    color: 'var(--q-text-secondary)',
    fontWeight: 'var(--q-font-weight-bold)',
  },
  [`.${BASE_FENCE_CLASSES.message}`]: {
    marginTop: 'var(--q-gap-sm)',
    color: 'var(--q-text-secondary)',
  },
  [`.${BASE_FENCE_CLASSES.failed} .${BASE_FENCE_CLASSES.message}`]: {
    marginTop: '0',
    color: 'var(--q-text-danger)',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-state`]: {
    padding: 'var(--q-gap-md) 0',
    color: 'var(--q-text-secondary)',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-view__notice`]: {
    margin: 'var(--q-gap-sm) 0 0',
    color: 'var(--q-text-secondary)',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-group + .q-base-group`]: {
    marginTop: 'var(--q-gap-md)',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-group > h2`]: {
    margin: 'var(--q-gap-sm) 0',
    fontSize: '0.95em',
    color: 'var(--q-text-secondary)',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-table`]: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-table th`]: {
    textAlign: 'left',
    padding: 'var(--q-gap-sm) var(--q-gap-md)',
    borderBottom: 'var(--q-border-1) solid var(--q-block-divider)',
    color: 'var(--q-text-secondary)',
    fontWeight: 'var(--q-font-weight-bold)',
    whiteSpace: 'nowrap',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-table td`]: {
    padding: 'var(--q-gap-sm) var(--q-gap-md)',
    borderBottom: 'var(--q-border-1) solid var(--q-block-divider)',
    verticalAlign: 'top',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-table tbody tr:last-child td`]: {
    borderBottom: '0',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-link`]: {
    color: 'var(--q-text-link)',
    cursor: 'pointer',
  },
  [`.${BASE_FENCE_CLASSES.root} .q-base-link:hover`]: {
    textDecoration: 'underline',
  },
});
