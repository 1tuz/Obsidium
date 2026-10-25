// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';

const state = vi.hoisted(() => ({
  schema: { version: 1, types: [] as { name: string; icon?: string; properties: unknown[] }[] },
  violations: [] as { property: string; reason: string }[],
  schemaError: null as unknown,
}));

vi.mock('../../modules/schema/gateway', () => ({
  getSchema: vi.fn(async () => {
    if (state.schemaError) throw state.schemaError;
    return state.schema;
  }),
  validateNote: vi.fn(async () => state.violations),
  schemaErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const { TypePickerDialog } = await import('./TypePickerDialog');
const { getSchema, validateNote } = await import('../../modules/schema/gateway');

function options(renderer: MountedDom): HTMLButtonElement[] {
  return [...renderer.container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

describe('TypePickerDialog', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.schema = { version: 1, types: [] };
    state.violations = [];
    state.schemaError = null;
    vi.clearAllMocks();
  });

  it('lists the plain note and every schema type, marking the current one', async () => {
    state.schema = {
      version: 1,
      types: [
        { name: 'Book', icon: 'book', properties: [] },
        { name: 'Person', properties: [] },
      ],
    };
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType="Book"
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const labels = options(renderer!).map((option) => option.textContent);
    expect(labels).toEqual([t('schema.picker.plain'), 'Book', 'Person']);
    expect(options(renderer!).map((option) => option.getAttribute('aria-selected')))
      .toEqual(['false', 'true', 'false']);
    expect(getSchema).toHaveBeenCalledWith('/vault');
    expect(validateNote).toHaveBeenCalledWith('/vault', '/vault/Dune.md');
  });

  it('marks the plain note when the note has no type', async () => {
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType={null}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    expect(options(renderer!)[0]?.getAttribute('aria-selected')).toBe('true');
    expect(renderer!.container.textContent).toContain(t('schema.picker.empty'));
  });

  it('falls back to the plain note when the declared type is not in the schema', async () => {
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType="Ghost"
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    expect(options(renderer!)[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows violations with the property name and the reason', async () => {
    state.violations = [{ property: 'author', reason: 'обязательное свойство не заполнено' }];
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType="Book"
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    const item = renderer!.container.querySelector('.q-type-picker__violations li');
    expect(item?.textContent).toBe('authorобязательное свойство не заполнено');
  });

  it('passes the chosen type to the callback and revalidates afterwards', async () => {
    state.schema = { version: 1, types: [{ name: 'Book', properties: [] }] };
    const onSelect = vi.fn(async () => {
      state.violations = [{ property: 'type', reason: 'неизвестный тип «Book»' }];
    });
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType={null}
          onClose={vi.fn()}
          onSelect={onSelect}
        />,
      );
    });
    await actAndSettle();

    await actAndSettle(() => options(renderer!)[1]?.click());
    await actAndSettle();

    expect(onSelect).toHaveBeenCalledWith('Book');
    expect(options(renderer!)[1]?.getAttribute('aria-selected')).toBe('true');
    expect(renderer!.container.querySelector('.q-type-picker__violations li')?.textContent)
      .toBe('typeнеизвестный тип «Book»');
  });

  it('removes the type through the callback', async () => {
    state.schema = { version: 1, types: [{ name: 'Book', properties: [] }] };
    const onSelect = vi.fn();
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType="Book"
          onClose={vi.fn()}
          onSelect={onSelect}
        />,
      );
    });
    await actAndSettle();

    await actAndSettle(() => options(renderer!)[0]?.click());
    await actAndSettle();

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(options(renderer!)[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows a gateway failure as text instead of crashing', async () => {
    state.schemaError = new Error('schema.json повреждён');
    act(() => {
      renderer = mountDom(
        <TypePickerDialog
          open
          workspacePath="/vault"
          path="/vault/Dune.md"
          currentType={null}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('schema.picker.loadError', { reason: 'schema.json повреждён' }));
    expect(renderer!.container.querySelector('.q-dialog')).not.toBeNull();
  });
});
