// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import type { IndexRevisionEvent } from '../../modules/links/events';
import { formatNoteMoment, RECENT_CHANGES_LIMIT, type ActivityNote } from '../../modules/stats';
import { RecentChangesPanel } from './RecentChangesPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function moment(path: string, atMs: number): ActivityNote {
  return { path, timestampNs: atMs * 1_000_000 };
}

const notes: ActivityNote[] = [
  moment('/vault/notes/first.md', Date.UTC(2026, 9, 25, 9, 30)),
  moment('/vault/second.md', Date.UTC(2026, 9, 24, 18, 5)),
];

async function settle(): Promise<void> {
  await actAndSettle();
  await actAndSettle();
}

function rows(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button.q-activity-note__button')];
}

describe('RecentChangesPanel', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(notes as never);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('asks for the recent changes of the workspace with the default limit', async () => {
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" />);
    await settle();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('get_recent_changes', {
      workspacePath: '/vault',
      limit: RECENT_CHANGES_LIMIT,
    });
  });

  it('lists every change with its note title and moment', async () => {
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" />);
    await settle();
    const list = rows(mounted.container);
    expect(list.map((row) => row.querySelector('.q-activity-note__title')?.textContent))
      .toEqual(['first', 'second']);
    expect(list.map((row) => row.querySelector('.q-activity-note__detail')?.textContent))
      .toEqual(notes.map((note) => formatNoteMoment(note.timestampNs, 'en')));
    expect(list[0].getAttribute('title')).toBe('/vault/notes/first.md');
  });

  it('opens the note that the reader picks', async () => {
    const onOpenNote = vi.fn();
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" onOpenNote={onOpenNote} />);
    await settle();
    await act(() => {
      rows(mounted?.container as HTMLElement)[1].click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('/vault/second.md');
  });

  it('keeps the caller limit', async () => {
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" limit={5} />);
    await settle();
    expect(mockedInvoke).toHaveBeenCalledWith('get_recent_changes', {
      workspacePath: '/vault',
      limit: 5,
    });
  });

  it('reloads when the index of this workspace moves on', async () => {
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" />);
    await settle();
    const calls = vi.mocked(useTauriEvent).mock.calls;
    const onRevision = calls[calls.length - 1][1] as (payload: IndexRevisionEvent) => void;

    await act(() => {
      onRevision({ workspacePath: '/elsewhere', generation: 1, revision: 2 });
    });
    await settle();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await act(() => {
      onRevision({ workspacePath: '/vault', generation: 1, revision: 3 });
    });
    await settle();
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing has changed yet', async () => {
    mockedInvoke.mockResolvedValue([] as never);
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" />);
    await settle();
    expect(mounted.container.querySelector('.q-recent-changes__status')?.textContent)
      .toBe(t('stats.activity.recentEmpty'));
    expect(rows(mounted.container)).toHaveLength(0);
  });

  it('reports a failed load', async () => {
    mockedInvoke.mockRejectedValue(new Error('index is not ready'));
    mounted = mountDom(<RecentChangesPanel workspacePath="/vault" />);
    await settle();
    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('stats.activity.recentFailed', { reason: 'index is not ready' }));
  });

  it('renders nothing without a workspace', async () => {
    mounted = mountDom(<RecentChangesPanel workspacePath={null} />);
    await settle();
    expect(mounted.container.querySelector('.q-recent-changes')).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
