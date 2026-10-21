// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';
import { CanvasNotePicker } from './CanvasNotePicker';

const state = vi.hoisted(() => ({
  notes: [] as Array<{ path: string; title: string; folder: string }>,
  results: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../modules/canvas/recentNotes', () => ({
  CANVAS_RECENT_NOTES_LIMIT: 20,
  loadRecentCanvasNotes: vi.fn(async () => state.notes),
}));

vi.mock('../../modules/search', () => ({
  useKnowledgeSearch: () => ({
    failed: false,
    queryTerms: [],
    results: state.results,
    status: {
      state: 'ready',
      updating: false,
      generation: 1,
      revision: 1,
      indexedDocuments: state.results.length,
      scannedDocuments: state.results.length,
    },
  }),
}));

vi.mock('../Common/CodeMirrorField', () => ({
  CodeMirrorField: ({
    value,
    onChange,
    onKeyDown,
    ariaLabel,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    ariaLabel: string;
    placeholder: string;
  }) => (
    <input
      className="q-canvas-search-input"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

async function type(renderer: MountedDom, value: string): Promise<void> {
  const field = renderer.container.querySelector<HTMLInputElement>('input');
  if (!field) throw new Error('Missing picker input');
  await actAndSettle(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CanvasNotePicker', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.notes = [];
    state.results = [];
  });

  it('lists recent notes while the query is empty', async () => {
    state.notes = [{ path: '/vault/Notes/Plan.md', title: 'Plan', folder: 'Notes' }];

    act(() => {
      renderer = mountDom(
        <CanvasNotePicker open workspacePath="/vault" onClose={vi.fn()} onSelect={vi.fn()} />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.textContent).toContain(t('canvas.search.recent'));
    const rows = [...renderer!.container.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Plan');
  });

  it('offers to create a note from the typed query', async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();

    act(() => {
      renderer = mountDom(
        <CanvasNotePicker
          open
          workspacePath="/vault"
          onClose={onClose}
          onSelect={vi.fn()}
          onCreate={onCreate}
        />,
      );
    });
    await actAndSettle();
    await type(renderer!, 'Fresh idea');

    const createLabel = t('canvas.search.create', { query: 'Fresh idea' });
    const create = [...renderer!.container.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((row) => row.textContent?.includes(createLabel)) ?? null;
    expect(create).not.toBeNull();

    await actAndSettle(() => {
      create!.dispatchEvent(new Event('click', { bubbles: true }));
    });

    expect(onCreate).toHaveBeenCalledWith('Fresh idea');
    expect(onClose).toHaveBeenCalled();
  });

  it('reports an empty result set for the query', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasNotePicker open workspacePath="/vault" onClose={vi.fn()} onSelect={vi.fn()} />,
      );
    });
    await actAndSettle();
    await type(renderer!, 'missing note');

    expect(renderer!.container.textContent).toContain(t('canvas.search.empty'));
  });
});