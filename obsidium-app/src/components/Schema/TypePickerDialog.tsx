import { useEffect, useState } from 'react';
import { Check } from 'lucide';
import { Dialog } from '../Common/Dialog';
import { Icon } from '../Common/Icon';
import { ICON_IDS, type IconId } from '../Common/iconCatalog';
import { t } from '../../i18n';
import { getSchema, schemaErrorMessage, validateNote } from '../../modules/schema/gateway';
import { NOTE_TYPE, type ObjectType, type Violation } from '../../modules/schema/types';
import './TypePickerDialog.css';

interface Props {
  open: boolean;
  workspacePath: string | null;
  path: string | null;
  currentType: string | null;
  onClose: () => void;
  onSelect: (typeName: string | null) => Promise<void> | void;
}

function catalogIcon(name: string | undefined): IconId | null {
  if (!name) return null;
  return ICON_IDS.find((id) => id === name) ?? null;
}

function typeKey(type: ObjectType | null): string {
  return type ? type.name.toLowerCase() : NOTE_TYPE.toLowerCase();
}

export function TypePickerDialog({ open, workspacePath, path, currentType, onClose, onSelect }: Props) {
  const [types, setTypes] = useState<ObjectType[] | null>(null);
  const [activeType, setActiveType] = useState<string | null>(currentType);
  const [violations, setViolations] = useState<Violation[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveType(currentType);
    setError('');
  }, [open, currentType]);

  useEffect(() => {
    if (!open || !workspacePath) return;
    let active = true;
    setTypes(null);
    void getSchema(workspacePath)
      .then((schema) => {
        if (active) setTypes(schema.types);
      })
      .catch((cause: unknown) => {
        if (active) setError(t('schema.picker.loadError', { reason: schemaErrorMessage(cause) }));
      });
    return () => { active = false; };
  }, [open, workspacePath]);

  useEffect(() => {
    if (!open || !workspacePath || !path) return;
    let active = true;
    setViolations(null);
    void validateNote(workspacePath, path)
      .then((next) => {
        if (active) setViolations(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(t('schema.picker.validateError', { reason: schemaErrorMessage(cause) }));
      });
    return () => { active = false; };
  }, [open, workspacePath, path, activeType]);

  if (!open) return null;

  const choose = (name: string | null) => {
    if (pending) return;
    setPending(true);
    setError('');
    void Promise.resolve(onSelect(name))
      .then(() => setActiveType(name))
      .catch((cause: unknown) => {
        setError(t('schema.picker.writeError', { reason: schemaErrorMessage(cause) }));
      })
      .finally(() => setPending(false));
  };

  const options: (ObjectType | null)[] = [null, ...(types ?? [])];
  const plainKey = NOTE_TYPE.toLowerCase();
  const current = activeType ? activeType.toLowerCase() : plainKey;
  const known = current === plainKey || (types ?? []).some((type) => type.name.toLowerCase() === current);

  return (
    <Dialog
      open
      title={t('schema.picker.title')}
      closeLabel={t('schema.picker.close')}
      className="q-type-picker"
      onClose={onClose}
    >
      <div className="q-type-picker__body">
        {error ? <p role="alert" className="q-type-picker__error">{error}</p> : null}
        <div className="q-type-picker__list" role="listbox" aria-label={t('schema.picker.title')}>
          {options.map((type) => {
            const key = typeKey(type);
            const selected = key === current || (key === plainKey && !known);
            const icon = catalogIcon(type?.icon);
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={pending}
                className={`q-type-picker__option${selected ? ' is-selected' : ''}`}
                onClick={() => choose(type?.name ?? null)}
              >
                {icon ? <Icon icon={icon} size={16} /> : null}
                <span className="q-type-picker__name">{type ? type.name : t('schema.picker.plain')}</span>
                {selected ? <Icon icon={Check} size={16} /> : null}
              </button>
            );
          })}
        </div>
        {types?.length === 0 ? (
          <p className="q-type-picker__hint">{t('schema.picker.empty')}</p>
        ) : null}
        <section className="q-type-picker__violations" aria-label={t('schema.picker.violations')}>
          <h3 className="q-type-picker__section-title">{t('schema.picker.violations')}</h3>
          {violations === null ? null : violations.length === 0 ? (
            <p className="q-type-picker__hint">{t('schema.picker.noViolations')}</p>
          ) : (
            <ul>
              {violations.map((violation) => (
                <li key={`${violation.property}:${violation.reason}`}>
                  <span className="q-type-picker__property">{violation.property}</span>
                  <span className="q-type-picker__reason">{violation.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
