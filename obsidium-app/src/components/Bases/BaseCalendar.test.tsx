// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { BaseCalendar } from './BaseCalendar';
import type { BaseRow, BaseViewDefinition } from '../../modules/bases';

const view: BaseViewDefinition = { type: 'calendar', name: 'Schedule', order: [], dateField: 'due' };

function row(path: string, due: string): BaseRow {
  return { path, fields: { due } };
}

describe('BaseCalendar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders a six-week Monday-first grid with entries and an undated counter', async () => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[row('/vault/Release.md', `${month}-01`), row('/vault/Idea.md', '')]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelectorAll('.q-base-calendar__weekdays span')).toHaveLength(7);
    expect(renderer!.container.querySelectorAll('.q-base-calendar__day')).toHaveLength(42);
    const cell = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .find((candidate) => candidate.getAttribute('aria-label') === `${month}-01`)!;
    expect(cell.textContent).toContain('Release');
    expect(renderer!.container.querySelector('.q-base-calendar__undated')?.textContent).toContain('1');
  });

  it('moves to the neighbouring month with the toolbar buttons', async () => {
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    const label = () => renderer!.container.querySelector('.q-base-calendar__month')?.textContent;
    const before = label();
    act(() => {
      renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
    });
    await actAndSettle();
    expect(label()).not.toBe(before);

    act(() => {
      renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click();
    });
    await actAndSettle();
    expect(label()).toBe(before);
  });

  it('creates a note on the day whose add button was pressed', async () => {
    const onCreateDay = vi.fn(async () => undefined);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onCreateDay={onCreateDay}
        />,
      );
    });
    await actAndSettle();

    const cell = renderer!.container.querySelector<HTMLElement>('.q-base-calendar__day--today')!;
    const date = cell.getAttribute('aria-label')!;
    act(() => cell.querySelector<HTMLButtonElement>('.q-base-calendar__add')!.click());
    await actAndSettle();
    expect(onCreateDay).toHaveBeenCalledWith(date);
  });

  it('marks the days that have a daily note and opens it on click', async () => {
    const onOpenJournal = vi.fn();
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const date = `${month}-12`;
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          journalDays={new Set([date])}
          onOpen={vi.fn()}
          onOpenJournal={onOpenJournal}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    const marked = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__journal')];
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('.q-base-calendar__day')?.getAttribute('aria-label')).toBe(date);
    act(() => marked[0].click());
    await actAndSettle();
    expect(onOpenJournal).toHaveBeenCalledWith(date);
  });
});
