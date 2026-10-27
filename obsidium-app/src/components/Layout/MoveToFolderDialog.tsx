import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Common/Button';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { t } from '../../i18n';
import { readDirectory } from '../../modules/documents/fileGateway';
import { comparablePath, isInsidePath, parentDirectory, relativePath, samePath } from '../../modules/paths';

interface MoveToFolderDialogProps {
  open: boolean;
  workspacePath: string | null;
  rootFolder?: string | null;
  targets: readonly string[];
  allowedFolders?: ReadonlySet<string> | null;
  onClose: () => void;
  onMove: (folder: string) => Promise<void>;
}

async function foldersUnder(root: string, workspacePath: string): Promise<string[]> {
  const folders: string[] = [];
  const pending = [root];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const key = comparablePath(directory);
    if (visited.has(key)) continue;
    visited.add(key);
    const children = await readDirectory(directory);
    for (const child of children) {
      if (child.type !== 'folder') continue;
      if (!samePath(child.id, workspacePath) && !isInsidePath(child.id, workspacePath)) continue;
      folders.push(child.id);
      pending.push(child.id);
    }
  }
  return folders;
}

export function MoveToFolderDialog({
  open,
  workspacePath,
  rootFolder = workspacePath,
  targets,
  allowedFolders,
  onClose,
  onMove,
}: MoveToFolderDialogProps) {
  const [folders, setFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const options = useMemo(() => {
    if (!workspacePath) return [];
    const destinations = [
      ...(rootFolder ? [rootFolder] : []),
      ...folders.filter((folder) => !allowedFolders || allowedFolders.has(comparablePath(folder))),
    ];
    return destinations.sort((left, right) => (
      relativePath(workspacePath, left).localeCompare(relativePath(workspacePath, right))
    ));
  }, [allowedFolders, folders, rootFolder, workspacePath]);

  useEffect(() => {
    if (!open || !rootFolder || !workspacePath) return;
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setSelected(rootFolder);
    void foldersUnder(rootFolder, workspacePath)
      .then((next) => {
        if (current === generation.current) setFolders(next);
      })
      .catch((cause) => {
        if (current !== generation.current) return;
        console.error('Failed to list destination folders', cause);
        setError(t('fileTree.folderListFailed'));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [open, rootFolder, workspacePath]);

  const allowed = options.filter((folder) => !targets.some((target) => (
    samePath(folder, target)
    || samePath(folder, parentDirectory(target))
    || isInsidePath(folder, target)
  )));

  const move = async () => {
    if (!selected || pending || !allowed.some((folder) => samePath(folder, selected))) return;
    setPending(true);
    setError('');
    try {
      await onMove(selected);
      onClose();
    } catch (cause) {
      console.error('Failed to move selected files', cause);
      setError(t('fileTree.moveFailed', { reason: String(cause) }));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t('fileTree.moveToFolder')}
      dismissible={!pending}
      onClose={onClose}
    >
      <label className="q-file-move-dialog__field">
        <span>{t('fileTree.destination')}</span>
        <select
          autoFocus
          value={selected}
          disabled={loading || pending || allowed.length === 0}
          onChange={(event) => setSelected(event.currentTarget.value)}
        >
          {allowed.map((folder) => (
            <option key={folder} value={folder}>
              {samePath(folder, workspacePath) ? t('fileTree.vaultRoot') : relativePath(workspacePath!, folder)}
            </option>
          ))}
        </select>
      </label>
      {loading ? <p>{t('fileTree.loadingFolders')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <DialogFooter>
        <Button variant="ghost" disabled={pending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={loading || pending || allowed.length === 0} onClick={() => { void move(); }}>
          {pending ? t('fileTree.moving') : t('fileTree.move')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
