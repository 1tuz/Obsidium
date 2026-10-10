// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditingToolbar } from './EditingToolbar';
import type { EditorView } from '@codemirror/view';

const readyView = { state: { readOnly: false } } as EditorView;

describe('EditingToolbar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('does not show a disabled toolbar before the editor is ready', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={null} position="top" />); });
    expect(renderer!.container.querySelector('.q-editing-toolbar')).toBeNull();
  });

  it('centers the top toolbar in the editor pane', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/components/Editor/EditingToolbar.css'), 'utf8');
    expect(styles).toMatch(/\.q-editing-toolbar--top\s*\{[^}]*align-self:\s*center;[^}]*width:\s*max-content;/s);
    expect(styles).toMatch(/\.q-editing-toolbar--top\s*\{[^}]*max-width:\s*100%;/s);
  });

  it('exposes the remaining Markdown heading levels and image insertion', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={readyView} position="top" />); });
    const labels = [...renderer!.container.querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toContain('Heading 4');
    expect(labels).toContain('Heading 5');
    expect(labels).toContain('Heading 6');
    expect(labels).toContain('Image');
  });
});
