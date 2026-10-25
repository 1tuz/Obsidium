export type ReportSectionId = 'brokenLinks' | 'isolatedNotes' | 'staleNotes';

export interface BrokenLinkEntry {
  sourcePath: string;
  sourceTitle: string;
  target: string;
  line: number;
}

export interface ReportNoteEntry {
  path: string;
  title: string;
}

export interface StaleNoteEntry {
  path: string;
  title: string;
  modifiedNs: number;
  days: number;
}

export interface KnowledgeReport {
  brokenLinks: BrokenLinkEntry[];
  isolatedNotes: ReportNoteEntry[];
  staleNotes: StaleNoteEntry[];
  staleAfterDays: number;
  indexedDocuments: number;
  indexing: boolean;
}

export interface ReportRow {
  key: string;
  path: string;
  title: string;
  detail: string;
}

export interface ReportSection {
  id: ReportSectionId;
  count: number;
  rows: ReportRow[];
}

export const DEFAULT_STALE_DAYS = 90;
export const MAX_STALE_DAYS = 3650;

export function clampStaleDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_STALE_DAYS;
  return Math.min(Math.floor(value), MAX_STALE_DAYS);
}

export function emptyReport(staleAfterDays = DEFAULT_STALE_DAYS): KnowledgeReport {
  return {
    brokenLinks: [],
    isolatedNotes: [],
    staleNotes: [],
    staleAfterDays: clampStaleDays(staleAfterDays),
    indexedDocuments: 0,
    indexing: false,
  };
}

export function brokenLinkRow(entry: BrokenLinkEntry, index: number): ReportRow {
  return {
    key: `broken:${entry.sourcePath}:${entry.line}:${entry.target}:${index}`,
    path: entry.sourcePath,
    title: entry.sourceTitle,
    detail: entry.target,
  };
}

export function isolatedNoteRow(entry: ReportNoteEntry): ReportRow {
  return {
    key: `isolated:${entry.path}`,
    path: entry.path,
    title: entry.title,
    detail: '',
  };
}

export function staleNoteRow(entry: StaleNoteEntry): ReportRow {
  return {
    key: `stale:${entry.path}`,
    path: entry.path,
    title: entry.title,
    detail: String(entry.days),
  };
}

function compareRows(section: ReportSectionId, left: ReportRow, right: ReportRow): number {
  if (section === 'staleNotes') {
    const age = Number(right.detail) - Number(left.detail);
    if (age !== 0) return age;
  }
  const byTitle = left.title.toLowerCase().localeCompare(right.title.toLowerCase());
  if (byTitle !== 0) return byTitle;
  return left.path.localeCompare(right.path);
}

export function sortRows(section: ReportSectionId, rows: readonly ReportRow[]): ReportRow[] {
  return [...rows].sort((left, right) => compareRows(section, left, right));
}

export function reportSections(report: KnowledgeReport | null): ReportSection[] {
  if (!report) return [];
  const brokenLinks = report.brokenLinks.map(brokenLinkRow);
  const isolatedNotes = report.isolatedNotes.map(isolatedNoteRow);
  const staleNotes = report.staleNotes.map(staleNoteRow);
  return [
    { id: 'brokenLinks', count: brokenLinks.length, rows: sortRows('brokenLinks', brokenLinks) },
    { id: 'isolatedNotes', count: isolatedNotes.length, rows: sortRows('isolatedNotes', isolatedNotes) },
    { id: 'staleNotes', count: staleNotes.length, rows: sortRows('staleNotes', staleNotes) },
  ];
}

export function filterRows(rows: readonly ReportRow[], query: string): ReportRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => (
    row.title.toLowerCase().includes(needle)
    || row.detail.toLowerCase().includes(needle)
    || row.path.toLowerCase().includes(needle)
  ));
}

export function filterSection(section: ReportSection, query: string): ReportSection {
  return { ...section, rows: filterRows(section.rows, query) };
}

export function reportTotal(report: KnowledgeReport | null): number {
  if (!report) return 0;
  return report.brokenLinks.length + report.isolatedNotes.length + report.staleNotes.length;
}
