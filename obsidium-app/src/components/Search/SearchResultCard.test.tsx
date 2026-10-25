// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import type { SearchResult } from '../../modules/search';
import { SearchResultCard } from './SearchResultCard';

interface CardOptions {
  queryTerms?: string[];
  selected?: boolean;
  onSelect?: (newTab: boolean) => void;
  onHover?: () => void;
  onAddQueryTerm?: (term: string) => void;
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    path: '/vault/a.md',
    title: 'Заметка',
    extension: 'md',
    snippet: 'Мы искали машины в тексте',
    matchCount: 3,
    matchOffset: 0,
    ...overrides,
  };
}

function cardNode(result: SearchResult, options: CardOptions = {}) {
  return (
    <SearchResultCard
      result={result}
      queryTerms={options.queryTerms ?? []}
      selected={options.selected ?? false}
      onSelect={options.onSelect ?? (() => {})}
      onHover={options.onHover ?? (() => {})}
      onAddQueryTerm={options.onAddQueryTerm ?? (() => {})}
    />
  );
}

function snippetMarks(renderer: MountedDom): (string | null)[] {
  return [...renderer.container.querySelectorAll<HTMLElement>('.q-search-result__snippet mark')]
    .map((mark) => mark.textContent);
}

describe('SearchResultCard', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders matched terms, tags, heading and the match count', () => {
    act(() => {
      renderer = mountDom(cardNode(
        makeResult({
          matchedTerms: ['машин', 'note'],
          matchedTags: ['проект'],
          heading: 'Раздел',
          matchCount: 3,
        }),
        { onAddQueryTerm: () => {} },
      ));
    });

    const chips = [...renderer!.container.querySelectorAll<HTMLElement>('.q-search-result__matches .q-chip')];
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toBe('машин');
    expect(chips[1].textContent).toBe('note');
    expect(chips[2].textContent).toBe('#проект');
    expect(renderer!.container.querySelector('.q-search-result__heading')?.textContent).toBe('Раздел');
    expect(renderer!.container.querySelector('.q-search-result__count')?.textContent).toContain('3');
  });

  it('adds a term without selecting the card and opens the card otherwise', async () => {
    const onSelect = vi.fn();
    const onAddQueryTerm = vi.fn();
    act(() => {
      renderer = mountDom(cardNode(
        makeResult({ matchedTerms: ['машин'] }),
        { onSelect, onAddQueryTerm },
      ));
    });

    const chip = renderer!.container.querySelector<HTMLElement>('.q-search-result__matches .q-chip')!;
    await actAndSettle(() => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onAddQueryTerm).toHaveBeenCalledTimes(1);
    expect(onAddQueryTerm).toHaveBeenCalledWith('машин');
    expect(onSelect).not.toHaveBeenCalled();

    const body = renderer!.container.querySelector<HTMLElement>('.q-search-result__snippet')!;
    await actAndSettle(() => {
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(false);

    await actAndSettle(() => {
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(true);
  });

  it('adds a tag chip with the tag: prefix', async () => {
    const onAddQueryTerm = vi.fn();
    act(() => {
      renderer = mountDom(cardNode(
        makeResult({ matchedTags: ['проект'] }),
        { onAddQueryTerm },
      ));
    });

    const tagChip = renderer!.container.querySelector<HTMLElement>('.q-search-result__chip--tag')!;
    expect(tagChip.textContent).toBe('#проект');
    await actAndSettle(() => {
      tagChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onAddQueryTerm).toHaveBeenCalledTimes(1);
    expect(onAddQueryTerm).toHaveBeenCalledWith('tag:проект');
  });

  it('highlights only matched terms that occur in the snippet', () => {
    act(() => {
      renderer = mountDom(cardNode(makeResult({
        snippet: 'Мы искали машины в тексте',
        matchedTerms: ['машин', 'велосипед'],
      }), { onAddQueryTerm: () => {} }));
    });

    expect(snippetMarks(renderer!)).toEqual(['машин']);

    act(() => {
      renderer!.update(cardNode(makeResult({
        snippet: 'Мы искали машины в тексте',
        matchedTerms: ['велосипед'],
      }), { queryTerms: ['машин'], onAddQueryTerm: () => {} }));
    });

    expect(snippetMarks(renderer!)).toEqual([]);
  });

  it('renders a legacy response without match metadata', () => {
    const legacy: SearchResult = {
      path: '/vault/legacy.md',
      title: 'legacy',
      extension: 'md',
      snippet: 'Мы искали машины',
      matchCount: 1,
      matchOffset: 0,
    };

    act(() => {
      renderer = mountDom(cardNode(legacy, { queryTerms: ['машин'], onAddQueryTerm: () => {} }));
    });

    expect(renderer!.container.querySelector('.q-search-result')).not.toBeNull();
    expect(renderer!.container.querySelector('.q-search-result__matches')).toBeNull();
    expect(renderer!.container.querySelector('.q-search-result__heading')).toBeNull();
    expect(snippetMarks(renderer!)).toEqual(['машин']);
  });
});
