import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import './CanvasMedia.css';

type MediaStatus = 'loading' | 'ready' | 'error';

interface CanvasMediaProps {
  kind: 'image' | 'video';
  src: string;
  label: string;
}

export function CanvasMedia({ kind, src, label }: CanvasMediaProps) {
  const [status, setStatus] = useState<MediaStatus>('loading');
  const elementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  useEffect(() => {
    setStatus('loading');
    const element = elementRef.current;
    if (!element) return;
    const loaded = element instanceof HTMLVideoElement
      ? element.readyState >= HTMLMediaElement.HAVE_METADATA
      : element.complete && element.naturalWidth > 0;
    if (loaded) setStatus('ready');
  }, [src, kind]);

  const failed = status === 'error';

  return (
    <div className="q-canvas-card__media" data-state={status}>
      {kind === 'image' ? (
        <img
          ref={(element) => { elementRef.current = element; }}
          className="q-canvas-card__media-image"
          src={src}
          alt={label}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          style={failed ? { visibility: 'hidden' } : undefined}
        />
      ) : (
        <video
          ref={(element) => { elementRef.current = element; }}
          className="q-canvas-card__media-video"
          src={src}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={() => setStatus('ready')}
          onError={() => setStatus('error')}
          style={failed ? { visibility: 'hidden' } : undefined}
        />
      )}
      {status === 'loading' && (
        <span className="q-canvas-card__media-state" role="status">
          {t('canvas.media.loading')}
        </span>
      )}
      {failed && (
        <span className="q-canvas-card__media-error" role="alert">
          {t('canvas.media.error', { name: label })}
        </span>
      )}
    </div>
  );
}
