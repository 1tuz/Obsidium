export function nextLiveTabs(
  previous: readonly string[],
  activeTabId: string | null,
  keepable: (tabId: string) => boolean,
  limit: number,
  pinnedTabIds: readonly string[] = [],
): string[] {
  const protectedTabs = new Set(pinnedTabIds);
  if (activeTabId) protectedTabs.add(activeTabId);
  const protectedOrder = [
    ...(activeTabId ? [activeTabId] : []),
    ...pinnedTabIds.filter((tabId) => tabId !== activeTabId),
  ];
  const eligible = [...protectedOrder, ...previous.filter((tabId) => !protectedTabs.has(tabId))]
    .filter((tabId, index, values) => keepable(tabId) && values.indexOf(tabId) === index);
  const protectedEligible = eligible.filter((tabId) => protectedTabs.has(tabId));
  const recent = eligible.filter((tabId) => !protectedTabs.has(tabId));
  return [...protectedEligible, ...recent.slice(0, Math.max(0, Math.floor(limit) - protectedEligible.length))];
}

export function sameTabOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tabId, index) => tabId === right[index]);
}
