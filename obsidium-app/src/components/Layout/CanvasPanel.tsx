import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Common/Button';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { scanCanvases, type VaultCanvas } from '../../modules/canvas/scanCanvases';
import { isCanvasPath, readDirectory } from '../../modules/documents/fileGateway';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { WORKSPACE_CHANGED_EVENT } from '../../hooks/useWorkspaceEvents';
import './CanvasPanel.css';

interface CanvasPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenCanvas: (path: string) => void;
  onCreateCanvas: () => void;
}

interface CanvasFolder {
  name: string;
  canvases: VaultCanvas[];
  folders: CanvasFolder[];
}

function canvasFolders(canvases: readonly VaultCanvas[]): CanvasFolder {
  const root: CanvasFolder = { name: '', canvases: [], folders: [] };
  for (const canvas of canvases) {
    const parts = canvas.folder ? canvas.folder.split('/') : [];
    let current = root;
    for (const name of parts) {
      let folder = current.folders.find((candidate) => candidate.name === name);
      if (!folder) {
        folder = { name, canvases: [], folders: [] };
        current.folders.push(folder);
      }
      current = folder;
    }
    current.canvases.push(canvas);
  }
  return root;
}

function CanvasTree({
  folder,
  onOpenCanvas,
}: {
  folder: CanvasFolder;
  onOpenCanvas: (path: string) => void;
}) {
  return (
    <ul className="q-canvas-panel__tree">
      {folder.folders.map((child) => (
        <li key={child.name}>
          <details open>
            <summary><Icon icon="folder" />{child.name}</summary>
            <CanvasTree folder={child} onOpenCanvas={onOpenCanvas} />
          </details>
        </li>
      ))}
      {folder.canvases.map((canvas) => (
        <li key={canvas.path}>
          <button
            type="button"
            className="q-canvas-panel__item"
            title={canvas.path}
            onClick={() => onOpenCanvas(canvas.path)}
          >
            <Icon icon="canvas" />
            <span>{canvas.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CanvasPanel({ active, workspacePath, onOpenCanvas, onCreateCanvas }: CanvasPanelProps) {
  const revision = useRef(0);
  const [canvases, setCanvases] = useState<VaultCanvas[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tree = useMemo(() => canvasFolders(canvases), [canvases]);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setCanvases([]);
      return;
    }
    const current = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const next = await scanCanvases(
        workspacePath,
        readDirectory,
        () => current !== revision.current,
      );
      if (current === revision.current) setCanvases(next);
    } catch (cause) {
      console.error('Failed to scan canvases', cause);
      if (current === revision.current) setError(String(cause));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  useEffect(() => () => {
    revision.current += 1;
  }, []);

  useTauriEvent<string[]>(WORKSPACE_CHANGED_EVENT, (paths) => {
    if (!paths.some(isCanvasPath)) return;
    void refresh();
  }, active);

  return (
    <section className="q-canvas-panel" aria-label={t('canvasPanel.title')}>
      <header className="q-canvas-panel__header">
        <h2>{t('canvasPanel.title')}</h2>
        <Button size="s" onClick={onCreateCanvas}>{t('canvasPanel.create')}</Button>
      </header>
      {loading && canvases.length === 0 ? <p>{t('canvasPanel.loading')}</p> : null}
      {error ? <p role="alert">{t('error.recoveryFailed', { reason: error })}</p> : null}
      {!loading && !error && canvases.length === 0 ? <p>{t('canvasPanel.empty')}</p> : null}
      {canvases.length > 0 ? <CanvasTree folder={tree} onOpenCanvas={onOpenCanvas} /> : null}
    </section>
  );
}
