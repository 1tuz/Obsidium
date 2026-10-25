import { t } from '../../i18n';
import { fileStem, isInsidePath, parentDirectory, relativePath } from '../../modules/paths';
import './ActivityNoteRow.css';

export interface ActivityNoteRowProps {
  path: string;
  detail: string;
  workspacePath: string;
  onOpenNote?: (path: string) => void;
}

export function ActivityNoteRow({
  path,
  detail,
  workspacePath,
  onOpenNote,
}: ActivityNoteRowProps) {
  const title = fileStem(path) || path;
  const folder = isInsidePath(path, workspacePath)
    ? parentDirectory(relativePath(workspacePath, path))
    : parentDirectory(path);
  return (
    <li className="q-activity-note">
      <button
        type="button"
        className="q-activity-note__button"
        aria-label={t('stats.activity.openNote', { name: title })}
        title={path}
        onClick={() => onOpenNote?.(path)}
      >
        <span className="q-activity-note__title">{title}</span>
        {folder ? <span className="q-activity-note__folder">{folder}</span> : null}
        <span className="q-activity-note__detail">{detail}</span>
      </button>
    </li>
  );
}
