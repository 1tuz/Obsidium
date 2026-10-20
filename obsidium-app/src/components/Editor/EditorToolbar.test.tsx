// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditorToolbar } from './EditorToolbar';

describe('EditorToolbar modes', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows the current mode and toggles to the other mode', () => {
    const onModeChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Note.md"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly={false}
          onModeChange={onModeChange}
        />,
      );
    });
    const mode = renderer!.container.querySelector<HTMLButtonElement>('[aria-pressed]');
    expect(mode?.getAttribute('aria-label')).toBe('Editing mode');
    expect(mode?.getAttribute('aria-pressed')).toBe('false');
    expect(renderer!.container.querySelectorAll('[aria-label="Reading mode"], [aria-label="Editing mode"]')).toHaveLength(1);
    act(() => mode?.click());
    expect(onModeChange).toHaveBeenLastCalledWith(true);
  });

  it('marks reading mode as selected while reading', () => {
    const onModeChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Note.md"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly
          onModeChange={onModeChange}
        />,
      );
    });
    const mode = renderer!.container.querySelector<HTMLButtonElement>('[aria-pressed]');
    expect(mode?.getAttribute('aria-label')).toBe('Reading mode');
    expect(mode?.getAttribute('aria-pressed')).toBe('true');
    act(() => mode?.click());
    expect(onModeChange).toHaveBeenLastCalledWith(false);
  });

  it('changes its icon with the current mode', () => {
    const props = {
      fileName: 'Note.md',
      canGoBack: false,
      canGoForward: false,
      onNavigate: () => {},
      onSearch: () => {},
      onExportPdf: () => {},
      focusMode: false,
      onToggleFocusMode: () => {},
      onModeChange: () => {},
    };
    act(() => { renderer = mountDom(<EditorToolbar {...props} readOnly={false} />); });
    const editingIcon = renderer!.container.querySelector('[aria-pressed] svg')?.outerHTML;
    act(() => { renderer!.unmount(); });
    act(() => { renderer = mountDom(<EditorToolbar {...props} readOnly />); });
    const readingIcon = renderer!.container.querySelector('[aria-pressed] svg')?.outerHTML;
    expect(editingIcon).not.toBe(readingIcon);
  });

  it('hides the mode toggle while viewing history', () => {
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Note.md"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly
          onModeChange={() => {}}
          showModeToggle={false}
        />,
      );
    });
    expect(renderer!.container.querySelector('.q-icon-button[aria-pressed]')).toBeNull();
  });

  it('renames the note from the row and keeps the draft on failure', async () => {
    const onRename = vi.fn(async () => false);
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Plan.md"
          noteName="Plan"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly={false}
          onModeChange={() => {}}
          onRename={onRename}
        />,
      );
    });
    const field = renderer!.container.querySelector<HTMLInputElement>('input[aria-label="Note name"]')!;
    expect(field.value).toBe('Plan');
    await act(async () => {
      field.value = 'Renamed';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onRename).toHaveBeenCalledWith('Renamed');
    expect(field.value).toBe('Plan');
  });

  it('applies the rename on Enter and reverts on Escape', async () => {
    const onRename = vi.fn(async () => true);
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Plan.md"
          noteName="Plan"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly={false}
          onModeChange={() => {}}
          onRename={onRename}
        />,
      );
    });
    const field = renderer!.container.querySelector<HTMLInputElement>('input[aria-label="Note name"]')!;
    await act(async () => {
      field.value = 'Renamed';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onRename).toHaveBeenCalledWith('Renamed');

    await act(async () => {
      field.value = 'Discarded';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(field.value).toBe('Plan');
  });

  it('saves the note from the row and reports the result', async () => {
    const onSave = vi.fn(async () => {});
    act(() => {
      renderer = mountDom(
        <EditorToolbar
          fileName="Plan.md"
          noteName="Plan"
          canGoBack={false}
          canGoForward={false}
          onNavigate={() => {}}
          onSearch={() => {}}
          onExportPdf={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          readOnly={false}
          onModeChange={() => {}}
          onSave={onSave}
        />,
      );
    });
    await act(async () => { renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Save now"]')!.click(); });
    expect(onSave).toHaveBeenCalledOnce();
    expect(renderer!.container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });
});
