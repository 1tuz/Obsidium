// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditingToolbar } from './EditingToolbar';
import { ariaKeyshortcut, formatShortcut, SHORTCUTS } from '../../config/shortcuts';
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

  it('packs the toolbar groups instead of spreading them across the pane', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/components/Editor/EditingToolbar.css'), 'utf8');
    expect(styles).toMatch(/\.q-editing-toolbar\s*\{[^}]*justify-content:\s*flex-start;/s);
    expect(styles).toMatch(/\.q-editing-toolbar--top\s*\{[^}]*justify-content:\s*flex-start;/s);
    expect(styles).not.toMatch(/justify-content:\s*space-between/);
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

  it('advertises the inline formatting shortcuts on their buttons', () => {
    act(() => { renderer = mountDom(<EditingToolbar view={readyView} position="top" />); });
    const buttons = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')];
    const buttonFor = (label: string) => buttons.find((button) => button.getAttribute('aria-label') === label)!;

    const bold = buttonFor('Bold');
    expect(bold.title).toBe(`Bold (${formatShortcut(SHORTCUTS.BOLD)})`);
    expect(bold.getAttribute('aria-keyshortcuts')).toBe(ariaKeyshortcut(SHORTCUTS.BOLD));
    expect(bold.getAttribute('aria-keyshortcuts')).toBe('Control+B');

    expect(buttonFor('Italic').title).toContain(formatShortcut(SHORTCUTS.ITALIC));
    expect(buttonFor('Strikethrough').title).toContain(formatShortcut(SHORTCUTS.STRIKETHROUGH));
    expect(buttonFor('Highlight').title).toContain(formatShortcut(SHORTCUTS.HIGHLIGHT));
    expect(buttonFor('Inline code').title).toContain(formatShortcut(SHORTCUTS.INLINE_CODE));
    expect(buttonFor('Link').title).toContain(formatShortcut(SHORTCUTS.LINK));

    expect(buttonFor('Blockquote').title).toBe('Blockquote');
    expect(buttonFor('Blockquote').getAttribute('aria-keyshortcuts')).toBeNull();
  });
});
