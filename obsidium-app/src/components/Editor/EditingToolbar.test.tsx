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
    document.querySelectorAll('.q-editing-toolbar__menu').forEach((menu) => menu.remove());
  });

  it('does not show a disabled toolbar before the editor is ready', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={null} position="top" />); });
    expect(renderer!.container.querySelector('.q-editing-toolbar')).toBeNull();
  });

  it('stretches the top toolbar across the editor pane', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/components/Editor/EditingToolbar.css'), 'utf8');
    expect(styles).toMatch(/\.q-editing-toolbar\s*\{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.q-editing-toolbar--top\s*\{[^}]*align-self:\s*stretch;/s);
    expect(styles).not.toMatch(/\.q-editing-toolbar--top\s*\{[^}]*width:\s*max-content;/s);
  });

  it('keeps every heading level and image insertion reachable', async () => {
    act(() => { renderer = mountDom(<EditingToolbar view={readyView} position="top" />); });
    const trigger = renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Headings"]')!;
    expect(trigger).not.toBeNull();
    await act(async () => { trigger.click(); });

    const items = [...document.querySelectorAll('.q-editing-toolbar__menu-item')]
      .map((item) => item.textContent);
    expect(items).toEqual(expect.arrayContaining(['Heading 4', 'Heading 5', 'Heading 6']));

    const labels = [...renderer!.container.querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toContain('Image');
    expect(labels).toContain('Lists');
  });

  it('opens the list menu with all three list kinds', async () => {
    act(() => { renderer = mountDom(<EditingToolbar view={readyView} position="top" />); });
    const trigger = renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Lists"]')!;
    await act(async () => { trigger.click(); });
    const items = [...document.querySelectorAll('.q-editing-toolbar__menu-item')]
      .map((item) => item.textContent);
    expect(items).toEqual(expect.arrayContaining(['Bulleted list', 'Numbered list', 'Task list']));
  });
});
