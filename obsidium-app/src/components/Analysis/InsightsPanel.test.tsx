// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { InsightsPanel } from './InsightsPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('InsightsPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('hosts the report and leaves one named slot for extra insights blocks', async () => {
    vi.mocked(invoke).mockResolvedValue({
      brokenLinks: [],
      isolatedNotes: [],
      staleNotes: [],
      unusedTags: { tags: [], total: 0, truncated: false },
      staleAfterDays: 90,
      indexedDocuments: 2,
      indexing: false,
    });
    renderer = mountDom(
      <InsightsPanel
        active
        workspacePath="/vault"
        onOpenNote={() => {}}
        activity={<p class="probe">activity</p>}
      />,
    );
    await actAndSettle();
    await actAndSettle();

    expect(renderer.container.querySelector('h2')?.textContent).toBe(t('insights.title'));
    expect(renderer.container.querySelector('.q-knowledge-report')).not.toBeNull();
    expect(renderer.container.querySelector('.q-insights-panel__activity .probe')).not.toBeNull();
  });

  it('renders no slot container when nothing is passed into it', async () => {
    vi.mocked(invoke).mockResolvedValue({
      brokenLinks: [],
      isolatedNotes: [],
      staleNotes: [],
      unusedTags: { tags: [], total: 0, truncated: false },
      staleAfterDays: 90,
      indexedDocuments: 0,
      indexing: false,
    });
    renderer = mountDom(
      <InsightsPanel active workspacePath="/vault" onOpenNote={() => {}} />,
    );
    await actAndSettle();
    await actAndSettle();

    expect(renderer.container.querySelector('.q-insights-panel__activity')).toBeNull();
  });
});
