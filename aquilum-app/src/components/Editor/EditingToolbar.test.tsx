// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditingToolbar } from './EditingToolbar';

describe('EditingToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('uses the top toolbar variant above the editor', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={null} position="top" />); });
    expect(renderer!.container.querySelector('.q-editing-toolbar')?.classList.contains(
      'q-editing-toolbar--top',
    )).toBe(true);
  });

  it('exposes the remaining Markdown heading levels and image insertion', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={null} position="top" />); });
    const labels = [...renderer!.container.querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toContain('Heading 4');
    expect(labels).toContain('Heading 5');
    expect(labels).toContain('Heading 6');
    expect(labels).toContain('Image');
  });
});
