// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';
import { BaseTimeline } from './BaseTimeline';
import type { BaseRow, BaseViewDefinition } from '../../modules/bases';

const view: BaseViewDefinition = {
  type: 'timeline',
  name: 'Roadmap',
  order: [],
  startField: 'start',
  endField: 'end',
};

function row(path: string, start: string, end: string): BaseRow {
  return { path, fields: { start, end } };
}

describe('BaseTimeline', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders a bar per dated row, a month scale, and the undated count', async () => {
    const rows = [
      row('/vault/Alpha.md', '2026-10-01', '2026-10-03'),
      row('/vault/Beta.md', '2026-10-05', '2026-10-05'),
      { path: '/vault/Undated.md', fields: { start: '2026-10-02' } } as BaseRow,
    ];
    act(() => {
      renderer = mountDom(
        <BaseTimeline rows={rows} view={view} workspacePath="/vault" onOpen={vi.fn()} />,
      );
    });
    await actAndSettle();

    const bars = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-timeline__bar')];
    expect(bars).toHaveLength(2);
    expect(bars[0].textContent).toBe('Alpha');
    expect(bars[0].style.left).toBe('0%');
    expect(bars[0].style.width).toBe('60%');
    expect(bars[1].style.left).toBe('80%');
    expect(bars[1].style.width).toBe('20%');
    expect(renderer!.container.querySelectorAll('.q-base-timeline__month')).toHaveLength(1);
    expect(renderer!.container.querySelector('.q-base-timeline__undated')?.textContent)
      .toBe(t('bases.timelineUndated', { count: '1' }));
  });

  it('opens the note whose bar was clicked', async () => {
    const onOpen = vi.fn();
    act(() => {
      renderer = mountDom(
        <BaseTimeline
          rows={[row('/vault/Alpha.md', '2026-10-01', '2026-10-02')]}
          view={view}
          workspacePath="/vault"
          onOpen={onOpen}
        />,
      );
    });
    await actAndSettle();

    const bar = renderer!.container.querySelector<HTMLButtonElement>('.q-base-timeline__bar')!;
    expect(bar.getAttribute('aria-label')).toBe(t('bases.timelineBar', {
      name: 'Alpha',
      start: '2026-10-01',
      end: '2026-10-02',
    }));
    act(() => bar.click());
    await actAndSettle();
    expect(onOpen).toHaveBeenCalledWith('/vault/Alpha.md');
  });

  it('shows the empty notice instead of a scale when no row has both dates', async () => {
    act(() => {
      renderer = mountDom(
        <BaseTimeline
          rows={[{ path: '/vault/Undated.md', fields: { start: '2026-10-01' } } as BaseRow]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelectorAll('.q-base-timeline__bar')).toHaveLength(0);
    expect(renderer!.container.querySelector('.q-base-timeline__grid')).toBeNull();
    expect(renderer!.container.querySelector('.q-base-state')?.textContent).toBe(t('bases.timelineEmpty'));
    expect(renderer!.container.querySelector('.q-base-timeline__undated')?.textContent)
      .toBe(t('bases.timelineUndated', { count: '1' }));
  });

  it('marks today when the range contains it', async () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    act(() => {
      renderer = mountDom(
        <BaseTimeline
          rows={[row('/vault/Alpha.md', iso, iso)]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelectorAll('.q-base-timeline__today')).toHaveLength(1);
    expect(renderer!.container.querySelector('.q-base-timeline__today-label')?.textContent)
      .toBe(t('bases.calendarToday'));
  });
});
