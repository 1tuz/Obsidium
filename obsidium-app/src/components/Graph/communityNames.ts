const COMMUNITY_NAME_LENGTH = 60;

export function renameCommunity(
  names: Record<string, string>,
  stableId: string,
  name: string,
): Record<string, string> {
  const next = { ...names };
  const value = name.slice(0, COMMUNITY_NAME_LENGTH);
  if (value.length === 0) delete next[stableId];
  else next[stableId] = value;
  return next;
}

export function setCommunityCollapsed(
  collapsed: Record<string, boolean>,
  stableId: string,
  value: boolean,
): Record<string, boolean> {
  const next = { ...collapsed };
  if (value) next[stableId] = true;
  else delete next[stableId];
  return next;
}
