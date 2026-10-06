import { useEffect } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { samePath } from '../paths';
import type { DiskSync } from './diskSync';

const DOCUMENTS_CHANGED_EVENT = 'documents-changed';

export function useExternalDocSync(sync: DiskSync | null, filePath: string): void {
  useTauriEvent<string[]>(DOCUMENTS_CHANGED_EVENT, (paths) => {
    if (sync && paths.some((path) => samePath(path, filePath))) void sync.pull();
  }, sync !== null);

  useEffect(() => {
    if (!sync) return undefined;
    const pullFromDisk = () => { void sync.pull(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') pullFromDisk();
    };
    window.addEventListener('focus', pullFromDisk);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', pullFromDisk);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sync]);
}
