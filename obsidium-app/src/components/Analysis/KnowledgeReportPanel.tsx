import { useMemo, useState } from 'react';
import { Check } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { EmptyState } from '../Common/EmptyState';
import { ScrollArea } from '../Common/ScrollArea';
import { plural, t } from '../../i18n';
import {
  DEFAULT_STALE_DAYS,
  MAX_STALE_DAYS,
  clampStaleDays,
  filterSection,
  reportSections,
  reportTotal,
  useKnowledgeReport,
  type ReportRow,
  type ReportSection,
} from '../../modules/analysis';
import './KnowledgeReportPanel.css';

interface KnowledgeReportPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenNote: (path: string) => void;
}

function rowDetail(section: ReportSection, row: ReportRow): string {
  if (section.id === 'staleNotes') return plural('insights.days', Number(row.detail));
  if (section.id === 'brokenLinks') return `[[${row.detail}]]`;
  return '';
}

function ReportSectionView({
  section,
  onOpenNote,
}: {
  section: ReportSection;
  onOpenNote: (path: string) => void;
}) {
  return (
    <section className="q-knowledge-report__section" aria-labelledby={`q-insights-${section.id}`}>
      <h3 className="q-knowledge-report__section-title" id={`q-insights-${section.id}`}>
        <span>{t(`insights.${section.id}.title`)}</span>
        <span className="q-knowledge-report__count">{section.count}</span>
      </h3>
      <p className="q-knowledge-report__hint">{t(`insights.${section.id}.hint`)}</p>
      {section.rows.length === 0 ? (
        <p className="q-knowledge-report__section-empty">
          {t(section.count === 0 ? `insights.${section.id}.empty` : 'insights.filterEmpty')}
        </p>
      ) : (
        <ul className="q-knowledge-report__rows">
          {section.rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="q-knowledge-report__row"
                onClick={() => onOpenNote(row.path)}
              >
                <span className="q-knowledge-report__row-title">{row.title}</span>
                <span className="q-knowledge-report__row-detail">{rowDetail(section, row)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function KnowledgeReportPanel({
  active,
  workspacePath,
  onOpenNote,
}: KnowledgeReportPanelProps) {
  const [staleDays, setStaleDays] = useState(DEFAULT_STALE_DAYS);
  const [draft, setDraft] = useState(String(DEFAULT_STALE_DAYS));
  const [query, setQuery] = useState('');
  const { report, failed, loading, reload } = useKnowledgeReport(workspacePath, staleDays, active);
  const sections = useMemo(
    () => reportSections(report).map((section) => filterSection(section, query)),
    [query, report],
  );
  const total = reportTotal(report);

  const commitDays = (value: string) => {
    setDraft(value);
    const parsed = Number(value);
    if (value.trim() === '' || Number.isNaN(parsed) || parsed <= 0) return;
    setStaleDays(clampStaleDays(parsed));
  };

  return (
    <div className="q-knowledge-report">
      <div className="q-knowledge-report__toolbar">
        <label className="q-knowledge-report__days">
          <span>{t('insights.staleDays')}</span>
          <input
            type="number"
            min={1}
            max={MAX_STALE_DAYS}
            value={draft}
            aria-label={t('insights.staleDays')}
            onChange={(event) => commitDays(event.currentTarget.value)}
            onBlur={() => setDraft(String(staleDays))}
          />
        </label>
        <IconButton label={t('insights.refresh')} size="small" onClick={reload}>
          <Icon icon="sync" />
        </IconButton>
      </div>

      <input
        type="search"
        className="q-knowledge-report__filter"
        placeholder={t('insights.filter')}
        aria-label={t('insights.filter')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      {failed ? (
        <p className="q-knowledge-report__error" role="alert">{t('insights.failed')}</p>
      ) : null}
      {report?.indexing ? (
        <p className="q-knowledge-report__status">{t('insights.indexing')}</p>
      ) : null}

      {loading ? (
        <p className="q-knowledge-report__status">{t('insights.loading')}</p>
      ) : !report ? null : total === 0 ? (
        <EmptyState icon={Check} title={t('insights.empty')} compact />
      ) : (
        <ScrollArea className="q-knowledge-report__body">
          {sections.map((section) => (
            <ReportSectionView
              key={section.id}
              section={section}
              onOpenNote={onOpenNote}
            />
          ))}
        </ScrollArea>
      )}
    </div>
  );
}
