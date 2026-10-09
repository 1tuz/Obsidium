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

  it('offers separate reading and editing mode buttons', () => {
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
    const reading = renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Reading mode"]');
    const editing = renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Editing mode"]');
    expect(reading).not.toBeNull();
    expect(editing).not.toBeNull();
    expect(reading?.getAttribute('aria-pressed')).toBe('false');
    expect(editing?.getAttribute('aria-pressed')).toBe('true');
    act(() => reading?.click());
    expect(onModeChange).toHaveBeenLastCalledWith(true);
    act(() => editing?.click());
    expect(onModeChange).toHaveBeenLastCalledWith(false);
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
    expect(renderer!.container.querySelector('[aria-label="Reading mode"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(renderer!.container.querySelector('[aria-label="Editing mode"]')?.getAttribute('aria-pressed')).toBe('false');
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
          showModeButtons={false}
        />,
      );
    });
    expect(renderer!.container.querySelector('[aria-label="Reading mode"]')).toBeNull();
    expect(renderer!.container.querySelector('[aria-label="Editing mode"]')).toBeNull();
  });
});
