// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../modules/settings';
import { t } from '../../../i18n';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { formatSynonymGroups, parseSynonymGroups, SearchSection } from './SearchSection';

vi.mock('../../../modules/search', () => ({
  getSearchCacheSize: () => new Promise<number>(() => {}),
  clearUnusedSearchCache: vi.fn(),
  rebuildSearchIndex: vi.fn(),
}));

function config(synonymGroups: string[][] = []): AppConfig {
  return {
    search: { candidatePoolSize: 256, maxQueryTerms: 32, synonymGroups },
  } as AppConfig;
}

function Harness({ initial, onChange }: { initial: AppConfig; onChange: (next: AppConfig) => void }) {
  const [current, setCurrent] = useState(initial);
  return (
    <SearchSection
      config={current}
      workspacePath={null}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
    />
  );
}

function synonymField(renderer: MountedDom): HTMLTextAreaElement {
  const field = renderer.container.querySelector<HTMLTextAreaElement>('textarea');
  if (!field) throw new Error('No synonym field');
  return field;
}

const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

function type(renderer: MountedDom, value: string): void {
  const field = synonymField(renderer);
  act(() => {
    setTextareaValue.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(renderer: MountedDom): void {
  act(() => {
    synonymField(renderer).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('synonym group parse and format', () => {
  it('round trips groups through the editor text', () => {
    const groups = [['машина', 'авто'], ['дом', 'жилище', 'квартира']];
    expect(parseSynonymGroups(formatSynonymGroups(groups))).toEqual(groups);
  });

  it('drops blank lines, trims members and skips single-member groups', () => {
    expect(parseSynonymGroups('  машина , авто \n\nодиночка\nдом,  ,жилище\n')).toEqual([
      ['машина', 'авто'],
      ['дом', 'жилище'],
    ]);
  });

  it('keeps at most eight members per group', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(parseSynonymGroups(members.join(','))).toEqual([members.slice(0, 8)]);
  });
});

describe('SearchSection synonym editor', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders the stored groups one per line and explains the format', () => {
    act(() => {
      renderer = mountDom(
        <SearchSection config={config([['машина', 'авто']])} workspacePath={null} onChange={vi.fn()} />,
      );
    });

    expect(synonymField(renderer!).value).toBe('машина, авто');
    expect(renderer!.container.textContent).toContain(t('settings.search.synonymsHint'));
  });

  it('persists trimmed groups without single-member lines on blur', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(<Harness initial={config()} onChange={onChange} />);
    });

    type(renderer!, ' машина , авто \nодиночка');
    expect(onChange).not.toHaveBeenCalled();

    blur(renderer!);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({
        candidatePoolSize: 256,
        maxQueryTerms: 32,
        synonymGroups: [['машина', 'авто']],
      }),
    }));
    expect(synonymField(renderer!).value).toBe('машина, авто');
  });

  it('does not rewrite unchanged groups when the field is left without edits', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <SearchSection config={config([['дом', 'жилище']])} workspacePath={null} onChange={onChange} />,
      );
    });

    blur(renderer!);

    expect(onChange).not.toHaveBeenCalled();
  });
});
