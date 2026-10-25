// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { AppConfig } from '../../../modules/settings';
import { t } from '../../../i18n';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { JournalSection } from './JournalSection';

function config(overrides: Partial<AppConfig['journal']> = {}): AppConfig {
  return {
    journal: { folder: 'journal', dateFormat: 'YYYY-MM-DD', templatePath: null, ...overrides },
  } as AppConfig;
}

function typeInto(renderer: MountedDom, label: string, value: string): void {
  const row = [...renderer.container.querySelectorAll<HTMLElement>('.q-settings-row')]
    .find((candidate) => candidate.querySelector('.q-settings-row__label')?.textContent === label);
  const field = row?.querySelector<HTMLElement>('.q-input__field');
  const view = field ? EditorView.findFromDOM(field) : null;
  if (!view) throw new Error(`No editor field for ${label}`);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
}

describe('JournalSection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('saves the journal folder and keeps the other journal settings', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(<JournalSection config={config({ dateFormat: 'DD.MM.YYYY' })} onChange={onChange} />);
    });

    typeInto(renderer!, t('settings.journal.folder'), 'Journal/Daily');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      journal: expect.objectContaining({
        folder: 'Journal/Daily',
        dateFormat: 'DD.MM.YYYY',
        templatePath: null,
      }),
    }));
  });

  it('saves the date format', () => {
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<JournalSection config={config()} onChange={onChange} />); });

    typeInto(renderer!, t('settings.journal.dateFormat'), 'YYYY.MM.DD');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      journal: expect.objectContaining({ dateFormat: 'YYYY.MM.DD' }),
    }));
  });

  it('stores the template path and clears it when the field is emptied', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <JournalSection config={config({ templatePath: 'Templates/Daily.md' })} onChange={onChange} />,
      );
    });

    typeInto(renderer!, t('settings.journal.template'), 'Templates/Journal.md');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      journal: expect.objectContaining({ templatePath: 'Templates/Journal.md' }),
    }));

    typeInto(renderer!, t('settings.journal.template'), '');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      journal: expect.objectContaining({ templatePath: null }),
    }));
  });
});
