import { useCallback, useEffect, useState } from 'react';
import { knowledgeReport } from './gateway';
import { clampStaleDays, type KnowledgeReport } from './report';

interface ReportState {
  key: string;
  report: KnowledgeReport;
  failed: boolean;
}

export function useKnowledgeReport(
  workspacePath: string | null,
  staleAfterDays: number,
  enabled: boolean,
) {
  const days = clampStaleDays(staleAfterDays);
  const [token, setToken] = useState(0);
  const [state, setState] = useState<ReportState | null>(null);
  const key = workspacePath && enabled ? `${workspacePath}\0${days}` : null;

  useEffect(() => {
    if (!key || !workspacePath) return;
    let current = true;
    void knowledgeReport(workspacePath, days)
      .then((report) => {
        if (current) setState({ key, report, failed: false });
      })
      .catch((error) => {
        if (!current) return;
        console.error('Failed to load the knowledge report', error);
        setState({ key, report: { brokenLinks: [], isolatedNotes: [], staleNotes: [], unusedTags: { tags: [], total: 0, truncated: false }, staleAfterDays: days, indexedDocuments: 0, indexing: false }, failed: true });
      });
    return () => {
      current = false;
    };
  }, [days, key, token, workspacePath]);

  const reload = useCallback(() => setToken((current) => current + 1), []);
  const settled = state?.key === key ? state : null;

  return {
    report: settled?.report ?? null,
    failed: settled?.failed ?? false,
    loading: Boolean(key) && !settled,
    reload,
  };
}
