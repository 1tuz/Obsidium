// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../modules/settings';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { BuiltinsSection } from './BuiltinsSection';

describe('BuiltinsSection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('allows the Kanban feature to be enabled', () => {
    const config = { builtins: { editingToolbar: true, kanban: false, toolbarPosition: 'top' } } as AppConfig;
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<BuiltinsSection config={config} onChange={onChange} />); });

    const toggle = [...renderer!.container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
      .find((button) => button.getAttribute('aria-label') === 'Kanban')!;
    expect(toggle.disabled).toBe(false);
    act(() => toggle.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      builtins: expect.objectContaining({ kanban: true }),
    }));
  });
});
