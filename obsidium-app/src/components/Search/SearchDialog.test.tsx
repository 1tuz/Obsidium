// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import type { SearchIndexStatus, SearchResponse } from '../../modules/search';
import { SearchDialog } from './SearchDialog';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const readyStatus: SearchIndexStatus = {
  state: 'ready',
  updating: false,
  generation: 1,
  revision: 1,
  indexedDocuments: 1,
  scannedDocuments: 1,
};

const searchResponse: SearchResponse = {
  queryTerms: ['машин'],
  results: [
    {
      path: '/vault/a.md',
      title: 'a',
      extension: 'md',
      snippet: 'Мы искали машины',
      matchCount: 1,
      matchOffset: 0,
      heading: 'Раздел',
      matchedTerms: ['машин'],
      matchedTags: ['проект'],
    },
    {
      path: '/vault/b.md',
      title: 'b',
      extension: 'md',
      snippet: 'Ещё машины',
      matchCount: 1,
      matchOffset: 0,
      matchedTerms: ['машин'],
      matchedTags: [],
    },
  ],
  status: readyStatus,
};

function editorView(renderer: MountedDom): EditorView {
  const field = renderer.container.querySelector<HTMLElement>('.q-search-input');
  const view = field ? EditorView.findFromDOM(field) : null;
  if (!view) throw new Error('Search editor is not mounted');
  return view;
}

function editorContent(renderer: MountedDom): HTMLElement {
  const content = renderer.container.querySelector<HTMLElement>('.cm-content');
  if (!content) throw new Error('Search editor content is not mounted');
  return content;
}

async function typeQuery(renderer: MountedDom, value: string): Promise<void> {
  const view = editorView(renderer);
  await actAndSettle(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
}

async function settleSearch(): Promise<void> {
  await actAndSettle();
  await actAndSettle(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
}

function mountDialog() {
  return mountDom(
    <SearchDialog
      open
      workspacePath="/vault"
      onClose={() => {}}
      onOpenResult={() => {}}
      onCreate={() => {}}
    />,
  );
}

describe('SearchDialog', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    const mocked = vi.mocked(invoke);
    mocked.mockReset();
    mocked.mockImplementation(((command: string) => {
      if (command === 'prepare_search_index' || command === 'get_search_index_status') {
        return Promise.resolve(readyStatus);
      }
      if (command === 'search_knowledge_base') {
        return Promise.resolve(searchResponse);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    }) as unknown as typeof invoke);
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('appends a clicked term chip to the query and searches again', async () => {
    act(() => { renderer = mountDialog(); });
    await actAndSettle();

    await typeQuery(renderer!, 'машины');
    await settleSearch();

    const chips = [...renderer!.container.querySelectorAll<HTMLElement>('.q-search-result__matches .q-chip')];
    const termChip = chips.find((chip) => chip.textContent === 'машин');
    expect(termChip).toBeDefined();

    await actAndSettle(() => {
      termChip!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settleSearch();

    expect(editorView(renderer!).state.doc.toString()).toBe('машины машин');

    const searches = vi.mocked(invoke).mock.calls
      .filter(([command]) => command === 'search_knowledge_base');
    expect(searches.length).toBeGreaterThanOrEqual(2);
    expect(searches[searches.length - 1][1]).toMatchObject({
      workspacePath: '/vault',
      query: 'машины машин',
    });
  });

  it('moves the result selection with ArrowDown inside the editor', async () => {
    act(() => { renderer = mountDialog(); });
    await actAndSettle();

    await typeQuery(renderer!, 'машины');
    await settleSearch();

    const cards = [...renderer!.container.querySelectorAll<HTMLElement>('.q-search-result')];
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute('aria-selected')).toBe('true');
    expect(cards[1].getAttribute('aria-selected')).toBe('false');

    const content = editorContent(renderer!);
    await actAndSettle(() => {
      editorView(renderer!).focus();
      content.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(cards[0].getAttribute('aria-selected')).toBe('false');
    expect(cards[1].getAttribute('aria-selected')).toBe('true');
  });
});
