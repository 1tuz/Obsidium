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

  it('uses a full-width layout above the editor', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={null} position="top" />); });
    expect(renderer!.container.querySelector('.q-editing-toolbar')?.classList.contains(
      'q-editing-toolbar--top',
    )).toBe(true);
  });
});
