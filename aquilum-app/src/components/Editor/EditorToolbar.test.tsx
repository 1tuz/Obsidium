// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditorToolbar } from './EditorToolbar';

describe('EditorToolbar mode toggle', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('offers reading mode while editing and switches on request', () => {
    const onToggleReadMode = vi.fn();
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
          onToggleReadMode={onToggleReadMode}
        />,
      );
    });
    const button = [...renderer!.container.querySelectorAll('button')]
      .find((item) => item.textContent === 'Reading mode');
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(onToggleReadMode).toHaveBeenCalledOnce();
  });

  it('offers editing mode while reading', () => {
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
          onToggleReadMode={() => {}}
        />,
      );
    });
    expect([...renderer!.container.querySelectorAll('button')]
      .some((item) => item.textContent === 'Editing mode')).toBe(true);
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
          onToggleReadMode={() => {}}
          showModeToggle={false}
        />,
      );
    });
    expect([...renderer!.container.querySelectorAll('button')]
      .some((item) => item.textContent === 'Editing mode' || item.textContent === 'Reading mode')).toBe(false);
  });
});
