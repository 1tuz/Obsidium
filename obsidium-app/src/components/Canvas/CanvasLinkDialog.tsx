import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../Common/Button';
import { Dialog, DialogFooter } from '../Common/Dialog';
import './CanvasLinkDialog.css';

const allowedSchemes: Record<string, true> = { http: true, https: true, mailto: true, tel: true };
const schemePattern = /^[a-z][a-z\d+.-]*:/i;

export function normalizeCanvasLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return null;

  const scheme = schemePattern.exec(trimmed);
  if (!scheme) return trimmed;

  const name = scheme[0].slice(0, -1).toLowerCase();
  return allowedSchemes[name] ? trimmed : null;
}

export interface CanvasLinkDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  initialValue?: string;
  onClose: () => void;
  onSubmit: (url: string) => void;
}

export function CanvasLinkDialog({ open, mode, initialValue = '', onClose, onSubmit }: CanvasLinkDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setValue(initialValue);
    setInvalid(false);
  }, [open, initialValue]);

  const submit = () => {
    const normalized = normalizeCanvasLink(value);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(normalized);
  };

  return (
    <Dialog
      open={open}
      title={t(mode === 'add' ? 'canvas.link.addTitle' : 'canvas.link.editTitle')}
      closeLabel={t('common.cancel')}
      className="q-canvas-link-dialog"
      onClose={onClose}
    >
      <form
        className="q-canvas-link-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="q-canvas-link-dialog__body">
          <input
            type="text"
            className="q-canvas-link-dialog__field"
            value={value}
            autoFocus
            aria-label={t('canvas.link.address')}
            placeholder="https://"
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setInvalid(false);
            }}
          />
          {invalid ? <p className="q-canvas-link-dialog__error" role="alert">{t('canvas.link.invalid')}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit">{t(mode === 'add' ? 'canvas.link.add' : 'canvas.link.save')}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
