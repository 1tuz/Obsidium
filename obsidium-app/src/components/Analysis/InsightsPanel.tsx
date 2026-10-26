import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { KnowledgeReportPanel } from './KnowledgeReportPanel';
import './InsightsPanel.css';

interface InsightsPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenNote: (path: string) => void;
  activity?: ReactNode;
  heading?: boolean;
}

export function InsightsPanel({
  active,
  workspacePath,
  onOpenNote,
  activity,
  heading = true,
}: InsightsPanelProps) {
  return (
    <div className="q-insights-panel">
      {heading && (
        <div className="q-insights-panel__header">
          <h2>{t('insights.title')}</h2>
        </div>
      )}
      {activity ? <div className="q-insights-panel__activity">{activity}</div> : null}
      <div className="q-insights-panel__body">
        <KnowledgeReportPanel
          active={active}
          workspacePath={workspacePath}
          onOpenNote={onOpenNote}
        />
      </div>
    </div>
  );
}
