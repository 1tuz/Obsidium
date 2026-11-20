import type { EditorView } from '@codemirror/view';

export function resolveEditorScrollElement(container: HTMLElement, readOnly = false, scroller?: HTMLElement): HTMLElement {
  if (scroller) {
    const book = scroller.closest<HTMLElement>('.q-book-page:not(.q-book-page--inactive)');
    return book && container.contains(book) ? book : readOnly ? scroller : container;
  }
  const book = container.querySelector('.q-book-page:not(.q-book-page--inactive)');
  if (book) return book as HTMLElement;

  if (readOnly) {
    const reader = container.querySelector<HTMLElement>(
      '.q-editor-content--reading .q-editor-content__body .cm-scroller',
    );
    if (reader) return reader;
  }
  return container;
}

export function captureScroll(view: EditorView, scrollElement: HTMLElement) {
  const scrollportTop = scrollElement.getBoundingClientRect().top;
  const localTop = scrollportTop - view.scrollDOM.getBoundingClientRect().top;
  const block = view.lineBlockAtHeight(Math.max(0, localTop));
  const coords = view.coordsAtPos(block.from);
  return {
    anchor: block.from,
    offset: coords ? scrollportTop - coords.top : localTop - block.top,
  };
}
