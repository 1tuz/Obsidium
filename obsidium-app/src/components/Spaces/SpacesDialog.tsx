import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide';
import { t } from '../../i18n';
import { Button } from '../Common/Button';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { Dropdown } from '../Common/Dropdown';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { Input } from '../Common/Input';
import { ScrollArea } from '../Common/ScrollArea';
import { folderOptions, listSpaceFiles, type Space } from '../../modules/spaces';
import './SpacesDialog.css';

interface SpacesDialogProps {
  open: boolean;
  workspacePath: string | null;
  spaces: Space[];
  onClose: () => void;
  onSave: (space: Space) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface SpaceForm {
  id: string;
  name: string;
  root: string;
  tags: string;
  folders: string;
}

function spaceFromForm(form: SpaceForm): Space {
  const split = (value: string) => value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    id: form.id,
    name: form.name.trim(),
    root: form.root,
    includeTags: split(form.tags),
    excludeFolders: split(form.folders),
  };
}

export function SpacesDialog({ open, workspacePath, spaces, onClose, onSave, onDelete }: SpacesDialogProps) {
  const [folders, setFolders] = useState<string[]>([]);
  const [form, setForm] = useState<SpaceForm | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);

  useEffect(() => {
    if (!open) {
      setFolders([]);
      setForm(null);
      setError(null);
      setDeleteTarget(null);
      return;
    }
    if (!workspacePath) {
      setFolders([]);
      return;
    }
    let cancelled = false;
    void listSpaceFiles(workspacePath, null)
      .then((paths) => {
        if (!cancelled) setFolders(folderOptions(workspacePath, paths));
      })
      .catch((reason) => {
        if (cancelled) return;
        console.error('Failed to list space folders', reason);
        setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePath]);

  const submit = useCallback(async () => {
    if (!form || form.name.trim() === '') return;
    setPending(true);
    setError(null);
    try {
      await onSave(spaceFromForm(form));
      setForm(null);
    } catch (reason) {
      console.error('Failed to save a space', reason);
      setError(String(reason));
    } finally {
      setPending(false);
    }
  }, [form, onSave]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(deleteTarget.id);
    } catch (reason) {
      console.error('Failed to delete a space', reason);
      setError(String(reason));
    } finally {
      setPending(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDelete]);

  const rootOptions = [
    { value: '', label: t('spaces.rootWholeVault') },
    ...folders.map((folder) => ({ value: folder, label: folder })),
  ];

  return (
    <>
      <Dialog
        open={open}
        title={form ? (form.id === '' ? t('spaces.createTitle') : t('spaces.editTitle')) : t('spaces.dialogTitle')}
        closeLabel={t('common.cancel')}
        className="q-spaces-dialog"
        onClose={onClose}
      >
        {form ? (
          <ScrollArea className="q-spaces-dialog__form">
            <div className="q-spaces-field">
              <span className="q-spaces-field__label">{t('spaces.name')}</span>
              <Input
                value={form.name}
                ariaLabel={t('spaces.name')}
                placeholder={t('spaces.namePlaceholder')}
                fullWidth
                disabled={pending}
                onChange={(name) => setForm({ ...form, name })}
              />
            </div>
            <div className="q-spaces-field">
              <span className="q-spaces-field__label">{t('spaces.root')}</span>
              <Dropdown
                value={form.root}
                options={rootOptions}
                ariaLabel={t('spaces.root')}
                disabled={pending}
                onChange={(root) => setForm({ ...form, root })}
              />
            </div>
            <div className="q-spaces-field">
              <span className="q-spaces-field__label">{t('spaces.includeTags')}</span>
              <Input
                value={form.tags}
                ariaLabel={t('spaces.includeTags')}
                placeholder={t('spaces.includeTagsPlaceholder')}
                fullWidth
                disabled={pending}
                onChange={(tags) => setForm({ ...form, tags })}
              />
            </div>
            <div className="q-spaces-field">
              <span className="q-spaces-field__label">{t('spaces.excludeFolders')}</span>
              <Input
                value={form.folders}
                ariaLabel={t('spaces.excludeFolders')}
                placeholder={t('spaces.excludeFoldersPlaceholder')}
                fullWidth
                disabled={pending}
                onChange={(foldersValue) => setForm({ ...form, folders: foldersValue })}
              />
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="q-spaces-dialog__list">
            {spaces.map((space) => (
              <div className="q-spaces-row" key={space.id}>
                <span className="q-spaces-row__text">
                  <span className="q-spaces-row__name">{space.name}</span>
                  <span className="q-spaces-row__root">{space.root === '' ? t('spaces.rootWholeVault') : space.root}</span>
                </span>
                <IconButton
                  size="small"
                  label={t('spaces.edit')}
                  disabled={pending}
                  onClick={() => setForm({
                    id: space.id,
                    name: space.name,
                    root: space.root,
                    tags: space.includeTags.join(', '),
                    folders: space.excludeFolders.join(', '),
                  })}
                >
                  <Icon icon={Pencil} />
                </IconButton>
                <IconButton
                  size="small"
                  label={t('spaces.delete')}
                  disabled={pending}
                  onClick={() => setDeleteTarget(space)}
                >
                  <Icon icon={Trash2} />
                </IconButton>
              </div>
            ))}
          </ScrollArea>
        )}

        {error ? <p className="q-spaces-dialog__error" role="alert">{error}</p> : null}

        <DialogFooter>
          {form ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button disabled={pending || form.name.trim() === ''} onClick={() => void submit()}>
                {t('spaces.save')}
              </Button>
            </>
          ) : (
            <Button disabled={pending} onClick={() => setForm({ id: '', name: '', root: '', tags: '', folders: '' })}>
              <Icon icon={Plus} />
              {t('spaces.newSpace')}
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('spaces.deleteTitle')}
        description={t('spaces.deleteDescription', { name: deleteTarget ? deleteTarget.name : '' })}
        confirmLabel={t('common.delete')}
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
