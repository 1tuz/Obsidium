import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { resolveVaultAssetUrl } from '../../modules/docs/vaultAssets';
import { t } from '../../i18n';
import './PdfViewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  path: string;
  workspacePath: string;
}

export function PdfViewer({ path, workspacePath }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setPageNumber(1);
    setError(false);
    const loadingTask = getDocument({ url: resolveVaultAssetUrl(workspacePath, path, '') });
    void loadingTask.promise.then((loaded) => {
      if (active) setDocument(loaded);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [path, workspacePath]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => setWidth(scroll.clientWidth));
    observer.observe(scroll);
    setWidth(scroll.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvasRef.current || width < 1) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void document.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(0.5, Math.min((width - 48) / baseViewport.width, 1.5)) * zoom;
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) {
        setError(true);
        return;
      }
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      return renderTask.promise;
    }).catch((renderError) => {
      if (!cancelled && (renderError as { name?: string }).name !== 'RenderingCancelledException') {
        setError(true);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, width, zoom]);

  return (
    <section className="q-pdf-reader" aria-label={t('pdf.reader')}>
      <nav className="q-pdf-toolbar" aria-label={t('pdf.controls')}>
        <button type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={!document || pageNumber <= 1}>
          {t('pdf.previous')}
        </button>
        <span aria-live="polite">
          {document ? t('pdf.pageCount', { page: pageNumber, count: document.numPages }) : t('pdf.loading')}
        </span>
        <button type="button" onClick={() => setPageNumber((page) => Math.min(document?.numPages ?? page, page + 1))} disabled={!document || pageNumber >= document.numPages}>
          {t('pdf.next')}
        </button>
        <span className="q-pdf-toolbar-spacer" />
        <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.2))} disabled={zoom <= 0.5} aria-label={t('pdf.zoomOut')}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))} disabled={zoom >= 2.4} aria-label={t('pdf.zoomIn')}>
          +
        </button>
      </nav>
      <div className="q-pdf-scroll" ref={scrollRef}>
        {error ? <p className="q-pdf-error" role="alert">{t('pdf.openFailed')}</p> : null}
        <canvas ref={canvasRef} className="q-pdf-page" aria-label={t('pdf.page', { page: pageNumber })} />
      </div>
    </section>
  );
}
