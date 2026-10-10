import { useEffect, useState } from 'react';
import { nextLiveTabs, sameTabOrder } from '../modules/liveTabs';
import type { SessionTab } from '../modules/ui-state';
import { isMarkdownPath } from '../modules/documents/fileGateway';

export function useLiveTabs(
  tabs: SessionTab[],
  activeTabId: string | null,
  limit: number,
  pinnedTabIds: string[] = [],
): string[] {
  const [live, setLive] = useState<string[]>([]);

  useEffect(() => {
    const keepable = (tabId: string) => tabs.some(
      (tab) => tab.tabId === tabId && tab.kind === 'document' && isMarkdownPath(tab.path),
    );
    setLive((previous) => {
      const next = nextLiveTabs(previous, activeTabId, keepable, limit, pinnedTabIds);
      return sameTabOrder(next, previous) ? previous : next;
    });
  }, [activeTabId, limit, pinnedTabIds, tabs]);

  return live;
}
