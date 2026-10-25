// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { FoliateReaderEngine } from './ReaderEngine';
import { flattenToc, type RawTocItem } from './readerToc';

vi.mock('foliate-js/view.js', () => ({}));

const fakeToc: RawTocItem[] = [
  {
    id: 0,
    label: 'Chapter 1',
    href: 'ch1.xhtml',
    subitems: [{ id: 1, label: 'Section 1.1', href: 'ch1.xhtml#s1' }],
  },
  { id: 2, label: 'Chapter 2', href: 'ch2.xhtml' },
  { id: 3, label: 'No target', href: null },
];

type FakeRenderer = HTMLDivElement & {
  start: number;
  scrollBy: (dx: number, dy: number) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
};

type FakeView = HTMLDivElement & {
  open: (book: File | Blob | string) => Promise<void>;
  init: (opts: { lastLocation?: unknown; showTextStart?: boolean }) => Promise<void>;
  goTo: (target: string) => Promise<unknown>;
  getCFI: (index: number, range?: Range) => string;
  addAnnotation: (annotation: { value: string }, remove?: boolean) => Promise<void>;
  close: () => void;
  book?: { destroy?: () => void; toc?: readonly RawTocItem[] };
  renderer?: FakeRenderer;
};

const originalCreateElement = document.createElement.bind(document) as unknown as (
  tagName: string,
  options?: string | ElementCreationOptions,
) => HTMLElement;

let host: HTMLElement;
let engine: FoliateReaderEngine | null = null;
let fakeView: FakeView;
let goTo: Mock<(target: string) => Promise<unknown>>;
let createElementSpy: MockInstance<typeof document.createElement>;
let createdTags: string[];

function makeView(): FakeView {
  const element = originalCreateElement('div') as FakeView;
  const renderer = originalCreateElement('div') as FakeRenderer;
  renderer.start = 0;
  renderer.scrollBy = vi.fn();
  renderer.next = vi.fn(async () => {});
  renderer.prev = vi.fn(async () => {});
  goTo = vi.fn<(target: string) => Promise<unknown>>(async () => undefined);
  element.open = vi.fn(async () => {});
  element.init = vi.fn(async () => {});
  element.goTo = goTo;
  element.getCFI = vi.fn(() => 'epubcfi(/6/4)');
  element.addAnnotation = vi.fn(async () => {});
  element.close = vi.fn();
  element.book = { toc: fakeToc };
  element.renderer = renderer;
  return element;
}

beforeEach(() => {
  createdTags = [];
  fakeView = makeView();
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, options?: string | ElementCreationOptions) => {
      createdTags.push(tagName);
      return tagName === 'foliate-view' ? fakeView : originalCreateElement(tagName, options);
    },
  );
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  engine?.close();
  engine = null;
  createElementSpy.mockRestore();
  document.body.replaceChildren();
});

async function openEngine(): Promise<FoliateReaderEngine> {
  const reader = new FoliateReaderEngine(host);
  await reader.open(new File([new Uint8Array(4)], 'b.epub'));
  engine = reader;
  return reader;
}

describe('FoliateReaderEngine table of contents', () => {
  it('exposes the book toc after open without measuring or annotating', async () => {
    const reader = await openEngine();

    expect(reader.toc).toEqual(flattenToc(fakeToc));
    expect(reader.toc.map((item) => item.label)).toEqual([
      'Chapter 1',
      'Section 1.1',
      'Chapter 2',
      'No target',
    ]);
    expect(createdTags.filter((tag) => tag === 'foliate-view')).toHaveLength(1);
    expect(createdTags).not.toContain('canvas');
    expect(fakeView.addAnnotation).not.toHaveBeenCalled();
  });

  it('navigates to the href of a toc entry', async () => {
    const reader = await openEngine();
    const item = reader.toc.find((entry) => entry.id === 1);

    expect(item?.href).toBe('ch1.xhtml#s1');
    await reader.goToToc(1);

    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo).toHaveBeenCalledWith('ch1.xhtml#s1');
  });

  it('ignores an unknown id and entries without an href', async () => {
    const reader = await openEngine();

    await expect(reader.goToToc(9999)).resolves.toBeUndefined();
    await expect(reader.goToToc(3)).resolves.toBeUndefined();

    expect(goTo).not.toHaveBeenCalled();
  });

  it('swallows navigation failures', async () => {
    const reader = await openEngine();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    goTo.mockRejectedValueOnce(new Error('broken cfi'));

    await expect(reader.goTo('epubcfi(/6/4!/nope)')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('surfaces the active toc id in relocate events', async () => {
    const reader = await openEngine();
    const listener = vi.fn();
    reader.onRelocate(listener);

    fakeView.dispatchEvent(new CustomEvent('relocate', {
      detail: { cfi: 'epubcfi(/6/4)', fraction: 0.25, tocItem: { id: 2 } },
    }));

    expect(listener).toHaveBeenCalledWith({ cfi: 'epubcfi(/6/4)', fraction: 0.25, tocId: 2 });

    fakeView.dispatchEvent(new CustomEvent('relocate', {
      detail: { cfi: 'epubcfi(/6/6)', fraction: 0.5 },
    }));

    expect(listener).toHaveBeenLastCalledWith({ cfi: 'epubcfi(/6/6)', fraction: 0.5, tocId: null });
  });

  it('empties the toc on close', async () => {
    const reader = await openEngine();
    expect(reader.toc.length).toBeGreaterThan(0);

    reader.close();

    expect(reader.toc).toEqual([]);
  });
});
