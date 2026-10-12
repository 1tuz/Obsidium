// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { PdfViewer } from './PdfViewer';

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfMocks.getDocument,
}));

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  disconnect() {}
}

describe('PdfViewer', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: pdfMocks.render,
    };
    const pdf = { numPages: 2, getPage: pdfMocks.getPage };
    pdfMocks.getPage.mockResolvedValue(page);
    pdfMocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(pdf),
      destroy: pdfMocks.destroy,
    });
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('devicePixelRatio', 1);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.restoreAllMocks();
  });

  it('renders one page at a time and navigates between pages', async () => {
    await actAndSettle(() => {
      renderer = mountDom(<PdfViewer path="manual.pdf" workspacePath="/notes" />);
    });

    expect(renderer!.container.textContent).toContain('Page 1 of 2');
    expect(renderer!.container.querySelector('canvas')?.width).toBeGreaterThan(0);
    expect(pdfMocks.getPage).toHaveBeenCalledWith(1);

    const canvas = renderer!.container.querySelector('canvas')!;
    const initialWidth = Number.parseFloat(canvas.style.width);
    const zoomIn = renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    await actAndSettle(() => zoomIn.click());
    expect(Number.parseFloat(canvas.style.width)).toBeGreaterThan(initialWidth);

    const next = [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Next page');
    await actAndSettle(() => next?.click());

    expect(renderer!.container.textContent).toContain('Page 2 of 2');
    expect(pdfMocks.getPage).toHaveBeenCalledWith(2);
  });

  it('shows a readable error when the file cannot be parsed', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('invalid PDF')),
      destroy: pdfMocks.destroy,
    });
    await actAndSettle(() => {
      renderer = mountDom(<PdfViewer path="broken.pdf" workspacePath="/notes" />);
    });

    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not open this PDF.');
  });
});
