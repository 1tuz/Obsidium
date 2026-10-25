// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import type { KnowledgeReport } from '../../modules/analysis';
import { KnowledgeReportPanel } from './KnowledgeReportPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const emptyReport: KnowledgeReport = {
  brokenLinks: [],
  isolatedNotes: [],
  staleNotes: [],
  staleAfterDays: 90,
  indexedDocuments: 4,
  indexing: false,
};

const report: KnowledgeReport = {
  brokenLinks: [
    { sourcePath: '/vault/a.md', sourceTitle: 'a', target: 'Ghost', line: 3 },
    { sourcePath: '/vault/b.md', sourceTitle: 'b', target: 'Missing note', line: 7 },
  ],
  isolatedNotes: [{ path: '/vault/orphan.md', title: 'orphan' }],
  staleNotes: [{ path: '/vault/old.md', title: 'old', modifiedNs: 1, days: 400 }],
  staleAfterDays: 90,
  indexedDocuments: 4,
  indexing: false,
};

function rows(renderer: MountedDom): HTMLButtonElement[] {
  return [...renderer.container.querySelectorAll<HTMLButtonElement>('.q-knowledge-report__row')];
}

function sectionTitles(renderer: MountedDom): string[] {
  return [...renderer.container.querySelectorAll('.q-knowledge-report__section-title span:first-child')]
    .map((node) => node.textContent ?? '');
}

describe('KnowledgeReportPanel', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('reads the report from the existing search index command', async () => {
    vi.mocked(invoke).mockResolvedValue(emptyReport);
    renderer = mountDom(<KnowledgeReportPanel active workspacePath="/vault" onOpenNote={() => {}} />);
    await actAndSettle();
    await actAndSettle();

    expect(invoke).toHaveBeenCalledWith('get_knowledge_report', {
      workspacePath: '/vault',
      staleAfterDays: 90,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when nothing needs fixing', async () => {
    vi.mocked(invoke).mockResolvedValue(emptyReport);
    renderer = mountDom(<KnowledgeReportPanel active workspacePath="/vault" onOpenNote={() => {}} />);
    await actAndSettle();
    await actAndSettle();

    expect(renderer.container.textContent).toContain(t('insights.empty'));
    expect(sectionTitles(renderer)).toEqual([]);
    expect(rows(renderer)).toEqual([]);
  });

  it('renders four counts and opens a note from every section', async () => {
    const onOpenNote = vi.fn();
    vi.mocked(invoke).mockResolvedValue(report);
    renderer = mountDom(
      <KnowledgeReportPanel active workspacePath="/vault" onOpenNote={onOpenNote} />,
    );
    await actAndSettle();
    await actAndSettle();

    expect(sectionTitles(renderer)).toEqual([
      t('insights.brokenLinks.title'),
      t('insights.isolatedNotes.title'),
      t('insights.staleNotes.title'),
    ]);
    const counts = [...renderer.container.querySelectorAll('.q-knowledge-report__count')]
      .map((node) => node.textContent);
    expect(counts).toEqual(['2', '1', '1']);
    expect(rows(renderer).map((row) => row.textContent)).toEqual([
      'a[[Ghost]]',
      'b[[Missing note]]',
      'orphan',
      `old${t('insights.days.other', { count: 400 })}`,
    ]);

    act(() => rows(renderer!)[1].click());
    act(() => rows(renderer!)[2].click());
    expect(onOpenNote.mock.calls).toEqual([['/vault/b.md'], ['/vault/orphan.md']]);
  });

  it('rebuilds the report on refresh and on a new stale window', async () => {
    vi.mocked(invoke).mockResolvedValue(report);
    renderer = mountDom(<KnowledgeReportPanel active workspacePath="/vault" onOpenNote={() => {}} />);
    await actAndSettle();
    await actAndSettle();

    act(() => renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('insights.refresh')}"]`,
    )!.click());
    await actAndSettle();
    await actAndSettle();
    expect(invoke).toHaveBeenCalledTimes(2);

    const field = renderer.container.querySelector<HTMLInputElement>(
      `input[aria-label="${t('insights.staleDays')}"]`,
    )!;
    act(() => {
      field.value = '30';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await actAndSettle();
    await actAndSettle();

    expect(invoke).toHaveBeenLastCalledWith('get_knowledge_report', {
      workspacePath: '/vault',
      staleAfterDays: 30,
    });
  });

  it('narrows the visible rows without dropping the section counts', async () => {
    vi.mocked(invoke).mockResolvedValue(report);
    renderer = mountDom(<KnowledgeReportPanel active workspacePath="/vault" onOpenNote={() => {}} />);
    await actAndSettle();
    await actAndSettle();

    const filter = renderer.container.querySelector<HTMLInputElement>(
      `input[aria-label="${t('insights.filter')}"]`,
    )!;
    act(() => {
      filter.value = 'ghost';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await actAndSettle();
    await actAndSettle();

    expect(rows(renderer).map((row) => row.textContent)).toEqual(['a[[Ghost]]']);
    const counts = [...renderer.container.querySelectorAll('.q-knowledge-report__count')]
      .map((node) => node.textContent);
    expect(counts).toEqual(['2', '1', '1']);
    expect(renderer.container.textContent).toContain(t('insights.filterEmpty'));
  });

  it('stays idle until the panel is shown and reports a failed load', async () => {
    vi.mocked(invoke).mockResolvedValue(report);
    renderer = mountDom(
      <KnowledgeReportPanel active={false} workspacePath="/vault" onOpenNote={() => {}} />,
    );
    await actAndSettle();
    await actAndSettle();
    expect(invoke).not.toHaveBeenCalled();

    vi.mocked(invoke).mockRejectedValue(new Error('index unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderer.update(<KnowledgeReportPanel active workspacePath="/vault" onOpenNote={() => {}} />);
    await actAndSettle();
    await actAndSettle();

    expect(renderer.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('insights.failed'));
    error.mockRestore();
  });
});
