import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { FILE_ICON_CHOICES, type FileIconAssignment } from './iconize';
import './IconizePicker.css';

interface IconizePickerProps {
  anchor: HTMLElement;
  value?: FileIconAssignment;
  onChange: (icon: FileIconAssignment | null) => void;
  onClose: () => void;
}

export function IconizePicker({ anchor, value, onChange, onClose }: IconizePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onClose, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onClose, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [onClose]);

  const bounds = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, bounds.left), Math.max(8, window.innerWidth - 230));
  const top = bounds.bottom + 270 < window.innerHeight ? bounds.bottom : Math.max(8, bounds.top - 270);
  return createPortal(<div
    ref={ref}
    className="q-iconize-picker"
    style={{ left, top }}
    role="dialog"
    aria-label={t('fileTree.iconize')}
    onMouseDown={(event) => event.stopPropagation()}
  >
    <div className="q-iconize-picker__grid">
      {FILE_ICON_CHOICES.map(({ name, icon }) => (
        <button type="button" key={name} title={name} aria-label={name}
          aria-pressed={value?.name === name}
          onClick={() => onChange({ name, color: value?.color ?? '#808080' })}
        ><Icon icon={icon} /></button>
      ))}
    </div>
    <label className="q-iconize-picker__color">
      {t('fileTree.iconColor')}
      <input type="color" value={value?.color ?? '#808080'}
        onChange={event => onChange({ name: value?.name ?? 'file', color: event.currentTarget.value })}
      />
    </label>
    <button className="q-iconize-picker__reset" type="button" onClick={() => { onChange(null); onClose(); }}>
      {t('fileTree.iconReset')}
    </button>
  </div>, document.body);
}
