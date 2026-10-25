import type { CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { appendQueryTerm } from '../../modules/search';

export function appendQueryTermToField(
  field: CodeMirrorFieldRef | null,
  query: string,
  term: string,
): string {
  const next = appendQueryTerm(query, term);
  if (!field) return next;
  field.setValue(next);
  field.focus();
  const view = field.view;
  if (view) view.dispatch({ selection: { anchor: view.state.doc.length } });
  return next;
}
