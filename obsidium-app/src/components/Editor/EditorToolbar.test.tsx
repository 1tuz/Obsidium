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
});
