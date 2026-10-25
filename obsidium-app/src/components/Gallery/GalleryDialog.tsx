import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from 'lucide';
import { t } from '../../i18n';
import { fileName, isInsidePath, relativePath } from '../../modules/paths';
import { listWorkspaceImages, type WorkspaceImage } from '../../modules/gallery/gateway';
import { Dialog } from '../Common/Dialog';
import { EmptyState } from '../Common/EmptyState';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { ScrollArea } from '../Common/ScrollArea';
import './GalleryDialog.css';

interface GalleryDialogProps {
  open: boolean;
  workspacePath: string | null;
  onClose: () => void;
}

type GalleryStatus = 'loading' | 'ready' | 'error';

export function GalleryDialog({ open, workspacePath, onClose }: GalleryDialogProps) {
  const [images, setImages] = useState<WorkspaceImage[]>([]);
  const [status, setStatus] = useState<GalleryStatus>('loading');
  const [viewerPath, setViewerPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setImages([]);
      setStatus('loading');
      setViewerPath(null);
      return;
    }
    setViewerPath(null);
    if (!workspacePath) {
      setImages([]);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    listWorkspaceImages(workspacePath)
      .then((entries) => {
        if (cancelled) return;
        setImages(entries);
        setStatus('ready');
      })
      .catch((reason) => {
        if (cancelled) return;
        console.error('Failed to list workspace images', reason);
        setImages([]);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePath]);

  const ordered = useMemo(() => [...images].sort((left, right) => (
    right.mtime - left.mtime || left.path.localeCompare(right.path)
  )), [images]);
  const viewerIndex = viewerPath
    ? ordered.findIndex((image) => image.path === viewerPath)
    : -1;
  const viewerImage = viewerIndex >= 0 ? ordered[viewerIndex] : null;

  const step = useCallback((delta: number) => {
    setViewerPath((current) => {
      if (!current) return current;
      const index = ordered.findIndex((image) => image.path === current);
      if (index < 0) return current;
      const next = ordered[(index + delta + ordered.length) % ordered.length];
      return next ? next.path : current;
    });
  }, [ordered]);

  useEffect(() => {
    if (!viewerImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [step, viewerImage]);

  return (
    <>
      <Dialog
        open={open}
        title={t('gallery.title')}
        closeLabel={t('gallery.close')}
        className="q-gallery-dialog"
        overlayClassName="q-gallery-overlay"
        onClose={onClose}
      >
        {status === 'loading' && (
          <p className="q-gallery-status" role="status">{t('gallery.loading')}</p>
        )}
        {status === 'error' && (
          <p className="q-gallery-status q-gallery-status--error" role="alert">{t('gallery.error')}</p>
        )}
        {status === 'ready' && ordered.length === 0 && (
          <div className="q-gallery-empty">
            <EmptyState icon={ImageIcon} title={t('gallery.empty')} compact />
          </div>
        )}
        {status === 'ready' && ordered.length > 0 && (
          <ScrollArea className="q-gallery-scroll">
            <ul className="q-gallery-grid">
              {ordered.map((image) => (
                <li key={image.path}>
                  <button
                    type="button"
                    className="q-gallery-tile"
                    title={workspacePath && isInsidePath(image.path, workspacePath)
                      ? relativePath(workspacePath, image.path)
                      : image.path}
                    onClick={() => setViewerPath(image.path)}
                  >
                    <img
                      className="q-gallery-tile__image"
                      src={convertFileSrc(image.path)}
                      alt={fileName(image.path)}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    <span className="q-gallery-tile__name">{fileName(image.path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </Dialog>

      <Dialog
        open={open && Boolean(viewerImage)}
        title={viewerImage ? fileName(viewerImage.path) : t('gallery.title')}
        headerless
        className="q-gallery-viewer"
        overlayClassName="q-gallery-viewer-overlay"
        onClose={() => setViewerPath(null)}
      >
        {viewerImage && (
          <div
            className="q-gallery-viewer__stage"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setViewerPath(null);
            }}
          >
            <img
              className="q-gallery-viewer__image"
              src={convertFileSrc(viewerImage.path)}
              alt={fileName(viewerImage.path)}
              draggable={false}
            />
            <div className="q-gallery-viewer__bar">
              <IconButton label={t('gallery.previous')} onClick={() => step(-1)}>
                <Icon icon={ChevronLeft} />
              </IconButton>
              <span className="q-gallery-viewer__counter">
                {t('gallery.position', { current: viewerIndex + 1, total: ordered.length })}
              </span>
              <IconButton label={t('gallery.next')} onClick={() => step(1)}>
                <Icon icon={ChevronRight} />
              </IconButton>
              <IconButton label={t('gallery.closeViewer')} onClick={() => setViewerPath(null)}>
                <Icon icon={X} />
              </IconButton>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
