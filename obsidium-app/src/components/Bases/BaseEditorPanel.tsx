import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide';
import { Button } from '../Common/Button';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import type { BaseGroupBy, BaseSort, BaseViewDefinition } from '../../modules/bases';
import './BaseEditorPanel.css';

export interface BaseViewEdit {
  name: string;
  limit: number | null;
  groupBy: BaseGroupBy | null;
  sort: BaseSort[];
}

interface BaseEditorPanelProps {
  view: BaseViewDefinition;
  columns: string[];
  onClose: () => void;
  onSave: (edit: BaseViewEdit) => Promise<boolean>;
}

export function BaseEditorPanel({ view, columns, onClose, onSave }: BaseEditorPanelProps) {
  const [name, setName] = useState(view.name);
  const [limit, setLimit] = useState(view.limit === undefined ? '' : String(view.limit));
  const [groupProperty, setGroupProperty] = useState(view.groupBy?.property ?? '');
  const [groupDirection, setGroupDirection] = useState<'ASC' | 'DESC'>(
    view.groupBy?.direction === 'DESC' ? 'DESC' : 'ASC',
  );
  const [sort, setSort] = useState<BaseSort[]>(view.sort ?? []);
  const [sortProperty, setSortProperty] = useState(
    columns.find((property) => !(view.sort ?? []).some((entry) => entry.property === property)) ?? '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const available = columns.filter((property) => !sort.some((entry) => entry.property === property));
  const choice = available.includes(sortProperty) ? sortProperty : available[0] ?? '';
  const groupOptions = groupProperty && !columns.includes(groupProperty)
    ? [groupProperty, ...columns]
    : columns;

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('bases.editorNameRequired'));
      return;
    }
    const limitText = limit.trim();
    let nextLimit: number | null = null;
    if (limitText) {
      const parsed = Number(limitText);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError(t('bases.editorLimitInvalid'));
        return;
      }
      nextLimit = parsed;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await onSave({
        name: trimmed,
        limit: nextLimit,
        groupBy: groupProperty ? { property: groupProperty, direction: groupDirection } : null,
        sort,
      });
      if (saved) onClose();
      else setBusy(false);
    } catch (cause) {
      setError(t('bases.editorSaveError', { reason: String(cause) }));
      setBusy(false);
    }
  };

  const addSort = () => {
    if (!choice) return;
    setSort((current) => [...current, { property: choice, direction: 'ASC' }]);
    setSortProperty('');
  };

  const toggleDirection = (property: string) => {
    setSort((current) => current.map((entry) => (entry.property === property
      ? { ...entry, direction: entry.direction === 'DESC' ? 'ASC' : 'DESC' }
      : entry)));
  };

  const removeSort = (property: string) => {
    setSort((current) => current.filter((entry) => entry.property !== property));
  };

  return (
    <Dialog
      open
      title={t('bases.editorTitle')}
      closeLabel={t('common.cancel')}
      dismissible={!busy}
      onClose={onClose}
      className="q-base-editor"
    >
      <div className="q-base-editor__body">
        <label className="q-base-editor__field">
          <span>{t('bases.editorName')}</span>
          <input
            className="q-base-editor__name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <label className="q-base-editor__field">
          <span>{t('bases.editorLimit')}</span>
          <input
            className="q-base-editor__limit"
            type="number"
            min={1}
            step={1}
            placeholder={t('bases.editorLimitUnlimited')}
            value={limit}
            onChange={(event) => setLimit(event.currentTarget.value)}
          />
        </label>
        <div className="q-base-editor__field">
          <span>{t('bases.editorGroupBy')}</span>
          <div className="q-base-editor__row">
            <select
              aria-label={t('bases.editorGroupBy')}
              value={groupProperty}
              onChange={(event) => setGroupProperty(event.currentTarget.value)}
            >
              <option value="">{t('bases.editorGroupNone')}</option>
              {groupOptions.map((property) => (
                <option key={property} value={property}>{property}</option>
              ))}
            </select>
            <select
              aria-label={t('bases.editorGroupDirection')}
              value={groupDirection}
              disabled={!groupProperty}
              onChange={(event) => setGroupDirection(event.currentTarget.value === 'DESC' ? 'DESC' : 'ASC')}
            >
              <option value="ASC">{t('bases.editorAscending')}</option>
              <option value="DESC">{t('bases.editorDescending')}</option>
            </select>
          </div>
        </div>
        <div className="q-base-editor__field">
          <span>{t('bases.editorSort')}</span>
          {sort.length === 0 ? (
            <p className="q-base-editor__empty">{t('bases.editorSortEmpty')}</p>
          ) : (
            <div className="q-base-editor__sort">
              {sort.map((entry, index) => (
                <div className="q-base-editor__sort-row" key={`${entry.property}:${index}`}>
                  <span title={entry.property}>{entry.property}</span>
                  <button
                    type="button"
                    aria-label={t('bases.editorSortDirection', { property: entry.property })}
                    onClick={() => toggleDirection(entry.property)}
                  >
                    <Icon icon={entry.direction === 'DESC' ? ArrowDown : ArrowUp} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('bases.editorSortRemove', { property: entry.property })}
                    onClick={() => removeSort(entry.property)}
                  >
                    <Icon icon={X} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="q-base-editor__row">
            <select
              aria-label={t('bases.editorSortAdd')}
              value={choice}
              disabled={available.length === 0}
              onChange={(event) => setSortProperty(event.currentTarget.value)}
            >
              {available.length === 0
                ? <option value="">{t('bases.editorSortEmpty')}</option>
                : available.map((property) => <option key={property} value={property}>{property}</option>)}
            </select>
            <Button variant="ghost" size="s" disabled={!choice || busy} onClick={addSort}>
              <Icon icon={Plus} /> {t('bases.editorSortAdd')}
            </Button>
          </div>
        </div>
        {error && <p className="q-base-editor__error" role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? t('bases.editorSaving') : t('bases.editorSave')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
