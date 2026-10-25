export function appendQueryTerm(query: string, term: string): string {
  const addition = term.trim();
  if (!addition) return query;
  const trimmed = query.trim();
  return trimmed ? `${trimmed} ${addition}` : addition;
}
