import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide';
import { Icon } from '../Common/Icon';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Menu, type MenuPosition } from '../Common/Menu';
import { Button } from '../Common/Button';
import { t } from '../../i18n';
import { childPath, fileName } from '../../modules/paths';
import { createAtFreeName, createFile, ensureDirectory, readFileSnapshot, trashFile, writeFileAtomic } from '../../modules/documents/fileGateway';
import { renameWorkspaceFile } from '../../modules/documents/renameWorkspaceFile';
import { sanitizeFileName } from '../../modules/documents/documentFactory';
import { setFrontmatterField } from '../../modules/docs/frontmatter';
import { loadBaseView, saveBaseView } from '../../modules/ui-state/gateway';
import {
  baseProperty,
  boardMembership,
  buildKanbanColumns,
  kanbanProperty,
  kanbanWritableProperty,
  parseBase,
  queryBase,
  serializeBase,
  type BaseDefinition,
  type BaseEvaluation,
  type BaseFieldValue,
  type BaseRow,
  type BaseSort,
  type BaseViewDefinition,
} from '../../modules/bases';
import { calendarDate } from '../../modules/bases/calendar';
import { journalDates, journalNotePath } from '../../modules/journal';
import type { JournalSettings } from '../../modules/settings';
import { planCalendarCard, planKanbanCard } from '../../modules/bases/cardCreation';
import { BaseCalendar } from './BaseCalendar';
import { resolveBaseViewIndex } from '../../modules/bases/viewSelection';
import './BaseView.css';

interface BaseViewProps {
  path: string;
  workspacePath: string;
  indexReady: boolean;
  indexRevision: number;
  journalSettings?: JournalSettings | null;
  onOpenNote: (path: string, offset?: number) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
  onFileDeleted?: (path: string) => void;
  viewRequest?: { path: string; index: number; id: number } | null;
  onViewRequestConsumed?: (id: number) => void;
}

interface LoadedBase {
  path: string;
  definition: BaseDefinition;
}

function displayValue(value: BaseFieldValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

function propertyLabel(definition: BaseDefinition, property: string): string {
  if (property === 'file.name') return 'Name';
  if (property === 'file.path') return 'Path';
  if (property === 'file.ext') return 'Ext';
  const key = property.startsWith('note.') ? property.slice('note.'.length) : property;
  return definition.propertyLabels[property]
    ?? definition.propertyLabels[key]
    ?? key.replace(/^(?:formula|summary)\./, '');
}

function editableKey(property: string): string | null {
  if (property.startsWith('file.') || property.startsWith('formula.') || property.startsWith('summary.')) {
    return null;
  }
  return property.startsWith('note.') ? property.slice('note.'.length) : property;
}

function yamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[\w./@+-]+(?: [\w./@+-]+)*$/u.test(trimmed)
    && !/^(true|false|null|~|[+-]?(?:\d+\.?\d*|\.\d+))$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(true|false|null|~|[+-]?(?:\d+\.?\d*|\.\d+))$/i.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}

function nextFrontmatter(
  content: string,
  key: string,
  value: string,
  array: boolean,
): string {
  const serialized = array
    ? `[${value.split(',').map((item) => item.trim()).filter(Boolean).map(yamlScalar).join(', ')}]`
    : yamlScalar(value);
  const updated = setFrontmatterField(content, key, serialized);
  if (updated !== null) return updated;
  if (!serialized) return content;
  const separator = content.includes('\r\n') ? '\r\n' : '\n';
  const line = serialized ? `${key}: ${serialized}` : `${key}:`;
  return `---${separator}${line}${separator}---${separator}${content}`;
}

function rowTitle(row: BaseRow, workspacePath: string): string {
  return displayValue(baseProperty(row, 'file.name', workspacePath)) || fileName(row.path);
}

function detectDateProperty(rows: readonly BaseRow[], workspacePath: string): string {
  const properties = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row.fields)) {
      if (calendarDate(baseProperty(row, key, workspacePath)) !== null) properties.add(key);
    }
  }
  return [...properties][0] ?? 'date';
}

export function BaseView({
  path,
  workspacePath,
  indexReady,
  indexRevision,
  journalSettings,
  onOpenNote,
  onFileRenamed,
  onFileDeleted,
  viewRequest,
  onViewRequestConsumed,
}: BaseViewProps) {
  const [loaded, setLoaded] = useState<LoadedBase | null>(null);
  const [evaluation, setEvaluation] = useState<BaseEvaluation | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeView, setActiveView] = useState(0);
  const [sort, setSort] = useState<BaseSort[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [addViewMenu, setAddViewMenu] = useState(false);
  const [actionError, setActionError] = useState('');
  const [journalDays, setJournalDays] = useState<ReadonlySet<string>>(() => new Set());
  const selectedPath = useRef('');
  const selectionRevision = useRef(0);
  const evaluationPath = useRef('');
  const saveQueue = useRef(Promise.resolve());

  const persistView = useCallback((index: number) => {
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => saveBaseView(workspacePath, path, index))
      .catch((error) => console.error('Failed to save active Base view', error));
  }, [path, workspacePath]);

  useEffect(() => {
    setLoaded(null);
    setEvaluation(null);
    evaluationPath.current = '';
    setActiveView(0);
    selectedPath.current = '';
    selectionRevision.current += 1;
    setSort([]);
    setEditing(null);
  }, [path]);

  useEffect(() => {
    if (!loaded || loaded.path !== path) return;
    if (viewRequest?.path === path) {
      const index = resolveBaseViewIndex(viewRequest.index, null, loaded.definition.views.length);
      selectionRevision.current += 1;
      selectedPath.current = path;
      setActiveView(index);
      persistView(index);
      onViewRequestConsumed?.(viewRequest.id);
      return;
    }
    if (selectedPath.current === path) return;
    selectedPath.current = path;
    const revision = selectionRevision.current;
    void loadBaseView(workspacePath, path)
      .then((savedIndex) => {
        if (selectionRevision.current !== revision) return;
        setActiveView(resolveBaseViewIndex(undefined, savedIndex, loaded.definition.views.length));
      })
      .catch((error) => console.error('Failed to load active Base view', error));
  }, [loaded, onViewRequestConsumed, path, persistView, viewRequest, workspacePath]);

  useEffect(() => {
    if (!indexReady) return;
    let cancelled = false;
    setFailed(false);
    void readFileSnapshot(path)
      .then((snapshot) => {
        if (!cancelled) setLoaded({ path, definition: parseBase(snapshot.content) });
      })
      .catch((error) => {
        console.error('Failed to load base', error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [indexReady, indexRevision, path]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void queryBase(workspacePath, { definition: loaded.definition, viewIndex: activeView, sort })
      .then((result) => {
        if (cancelled) return;
        evaluationPath.current = loaded.path;
        setEvaluation(result);
      })
      .catch((error) => {
        console.error('Failed to evaluate base', error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [activeView, indexRevision, loaded, sort, workspacePath]);

  const view = loaded?.definition.views[Math.min(activeView, (loaded?.definition.views.length ?? 1) - 1)];
  const rows = evaluation?.rows ?? [];
  const groups = evaluation?.groups ?? [];
  const columns = evaluation?.columns ?? [];
  const unsupported = evaluation?.unsupported ?? false;

  const calendarOpen = view?.type === 'calendar';
  useEffect(() => {
    if (!calendarOpen || !workspacePath) return;
    let active = true;
    void journalDates(workspacePath)
      .then((dates) => {
        if (active) setJournalDays(new Set(dates));
      })
      .catch((error) => console.error('Failed to load journal dates', error));
    return () => {
      active = false;
    };
  }, [calendarOpen, indexRevision, journalSettings, workspacePath]);

  if (failed) return <div className="q-base-state">{t('bases.error')}</div>;
  if (!loaded || !view || !evaluation) return <div className="q-base-state">{t('bases.loading')}</div>;

  const commitProperty = async (row: BaseRow, property: string, value: string) => {
    const key = editableKey(property);
    if (!key) return;
    const previous = row.fields[key];
    const array = Array.isArray(previous);
    const snapshot = await readFileSnapshot(row.path);
    const content = nextFrontmatter(snapshot.content, key, value, array);
    await writeFileAtomic(row.path, content, snapshot.hash);
    setEvaluation((current) => current ? {
      ...current,
      rows: current.rows.map((candidate) => candidate.path === row.path ? {
        ...candidate,
        fields: {
          ...candidate.fields,
          [key]: array
            ? value.split(',').map((item) => item.trim()).filter(Boolean)
            : value,
        },
      } : candidate),
    } : current);
  };

  const createCard = async (title: string, groupValue: string) => {
    if (!loaded) return;
    const viewIndex = Math.min(activeView, loaded.definition.views.length - 1);
    const draft = planKanbanCard(loaded.definition, viewIndex, path, workspacePath, title, groupValue);
    const safeName = sanitizeFileName(title);
    if (!safeName) throw new Error(t('bases.kanbanInvalidTitle'));
    await ensureDirectory(draft.directory);
    const created = await createAtFreeName(
      (attempt) => childPath(draft.directory, `${safeName}${attempt ? ` ${attempt}` : ''}.md`),
      (candidate) => createFile(candidate, draft.content),
    );
    if (!created) throw new Error(t('bases.kanbanNameExhausted'));
    setEvaluation((current) => current && evaluationPath.current === path ? {
      ...current,
      rows: [...current.rows.filter((row) => row.path !== created), { path: created, fields: draft.fields }],
    } : current);
  };

  const reportCalendarError = useCallback((error: unknown) => {
    setActionError(error instanceof Error ? error.message : String(error));
  }, []);

  const openJournalNote = async (date: string) => {
    try {
      onOpenNote(await journalNotePath(workspacePath, date));
    } catch (error) {
      reportCalendarError(error);
    }
  };

  const createCalendarCard = async (date: string) => {
    if (!loaded) return;
    const viewIndex = Math.min(activeView, loaded.definition.views.length - 1);
    const draft = planCalendarCard(loaded.definition, viewIndex, path, workspacePath, date, date);
    await ensureDirectory(draft.directory);
    const created = await createAtFreeName(
      (attempt) => childPath(draft.directory, `${date}${attempt ? ` ${attempt}` : ''}.md`),
      (candidate) => createFile(candidate, draft.content),
    );
    if (!created) throw new Error(t('bases.kanbanNameExhausted'));
    setEvaluation((current) => current && evaluationPath.current === path ? {
      ...current,
      rows: [...current.rows.filter((row) => row.path !== created), { path: created, fields: draft.fields }],
    } : current);
  };

  const renameCard = async (row: BaseRow, name: string) => {
    const safe = sanitizeFileName(name);
    if (!safe || safe !== name.trim()) throw new Error(t('bases.kanbanInvalidTitle'));
    const renamed = await renameWorkspaceFile(row.path, safe);
    if (!renamed) return;
    setEvaluation((current) => current ? {
      ...current,
      rows: current.rows.map((entry) => entry.path === row.path ? { ...entry, path: renamed } : entry),
    } : current);
    onFileRenamed?.(row.path, renamed);
  };

  const deleteCard = async (row: BaseRow) => {
    await trashFile(workspacePath, row.path);
    setEvaluation((current) => current ? {
      ...current,
      rows: current.rows.filter((entry) => entry.path !== row.path),
    } : current);
    onFileDeleted?.(row.path);
  };

  const toggleSort = (property: string) => {
    setSort((current) => current[0]?.property === property
      ? [{ property, direction: current[0].direction === 'ASC' ? 'DESC' : 'ASC' }]
      : [{ property, direction: 'ASC' }]);
  };

  const addView = async (type: string) => {
    const snapshot = await readFileSnapshot(path);
    const dateField = type === 'calendar' ? detectDateProperty(rows, workspacePath) : undefined;
    const definition = parseBase(snapshot.content);
    definition.views.push({
      type,
      name: t(`bases.viewName.${type}`),
      order: [],
      ...(dateField ? { dateField } : {}),
    });
    const next = serializeBase(definition);
    await writeFileAtomic(path, next, snapshot.hash);
    const parsed = parseBase(next);
    setLoaded((current) => current ? { ...current, definition: parsed } : current);
    const index = parsed.views.length - 1;
    selectionRevision.current += 1;
    selectedPath.current = path;
    setActiveView(index);
    setSort([]);
    persistView(index);
  };

  const kind = ['table', 'list', 'cards', 'kanban', 'calendar'].includes(view.type) ? view.type : 'table';

  return (
    <section className="q-base-view" aria-label={view.name}>
      <header className="q-base-view__header">
        <div className="q-base-view__tabs" role="tablist">
          {loaded.definition.views.map((candidate, index) => (
            <button
              key={`${candidate.name}:${index}`}
              type="button"
              role="tab"
              aria-selected={index === activeView}
              onClick={() => {
                selectionRevision.current += 1;
                setActiveView(index);
                selectedPath.current = path;
                setSort([]);
                persistView(index);
              }}
            >
              {candidate.name || t('bases.untitledView')}
            </button>
          ))}
          <button
            type="button"
            className="q-base-view__add"
            aria-label={t('bases.addView')}
            onClick={() => setAddViewMenu((open) => !open)}
          >
            <Icon icon={Plus} />
          </button>
          {addViewMenu && (
            <div className="q-base-view__add-menu" role="menu" aria-label={t('bases.addView')}>
              {(['table', 'list', 'cards', 'kanban', 'calendar'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddViewMenu(false);
                    void addView(type).catch((error) => console.error('Failed to add a Base view', error));
                  }}
                >
                  {t(`bases.viewType.${type}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="q-base-view__count">{rows.length}</span>
      </header>

      {unsupported && (
        <p className="q-base-view__notice">{t('bases.unsupported')}</p>
      )}

      {evaluation?.errors.map((error) => (
        <p
          key={`${error.formula}\u0000${error.message}`}
          className="q-base-view__notice q-base-view__error"
          role="alert"
        >{`formula.${error.formula}: ${error.message}`}</p>
      ))}

      {actionError && (
        <p className="q-base-view__notice q-base-view__error" role="alert">{actionError}</p>
      )}

      <div className="q-base-view__scroll">
        {rows.length === 0 && kind !== 'kanban' && kind !== 'calendar' ? (
          <div className="q-base-state">{t('bases.empty')}</div>
        ) : kind === 'calendar' ? (
          <BaseCalendar
            rows={rows}
            view={view}
            workspacePath={workspacePath}
            journalDays={journalDays}
            indexRevision={indexRevision}
            onOpen={onOpenNote}
            onOpenEvent={(path, offset) => onOpenNote(path, offset)}
            onOpenJournal={(date) => void openJournalNote(date)}
            onCreateDay={createCalendarCard}
            onCreateError={reportCalendarError}
          />
        ) : kind === 'kanban' ? (
          <BaseKanban
            rows={rows}
            columns={columns}
            definition={loaded.definition}
            view={view}
            viewIndex={Math.min(activeView, loaded.definition.views.length - 1)}
            workspacePath={workspacePath}
            onCommit={commitProperty}
            onCreate={createCard}
            onOpen={onOpenNote}
            onRename={renameCard}
            onDelete={deleteCard}
          />
        ) : groups.map((group, index) => (
          <section className="q-base-group" key={`${group.label ?? '__all__'}:${index}`}>
            {group.label !== null && <h2>{group.label || t('bases.groupEmpty')}</h2>}
            {kind === 'table' && (
              <BaseTable
                rows={rows.slice(group.start, group.end)}
                columns={columns}
                definition={loaded.definition}
                workspacePath={workspacePath}
                editing={editing}
                sort={sort}
                onSort={toggleSort}
                onEditing={setEditing}
                onCommit={commitProperty}
                onOpen={onOpenNote}
              />
            )}
            {kind === 'list' && (
              <BaseList rows={rows.slice(group.start, group.end)} workspacePath={workspacePath} onOpen={onOpenNote} />
            )}
            {kind === 'cards' && (
              <BaseCards
                rows={rows.slice(group.start, group.end)}
                columns={columns.filter((property) => property !== 'file.name')}
                definition={loaded.definition}
                workspacePath={workspacePath}
                onOpen={onOpenNote}
              />
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

interface BaseTableProps {
  rows: BaseRow[];
  columns: string[];
  definition: BaseDefinition;
  workspacePath: string;
  editing: string | null;
  sort: BaseSort[];
  onSort: (property: string) => void;
  onEditing: (key: string | null) => void;
  onCommit: (row: BaseRow, property: string, value: string) => Promise<void>;
  onOpen: (path: string) => void;
}

function BaseTable({
  rows,
  columns,
  definition,
  workspacePath,
  editing,
  sort,
  onSort,
  onEditing,
  onCommit,
  onOpen,
}: BaseTableProps) {
  return (
    <table className="q-base-table">
      <thead>
        <tr>
          {columns.map((property) => {
            const active = sort[0]?.property === property;
            return (
              <th key={property}>
                <button type="button" onClick={() => onSort(property)}>
                  {propertyLabel(definition, property)}
                  {active && <Icon icon={sort[0].direction === 'DESC' ? ChevronDown : ChevronUp} />}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path}>
            {columns.map((property) => {
              const key = `${row.path}\0${property}`;
              const value = baseProperty(row, property, workspacePath);
              const editable = editableKey(property);
              if (property === 'file.name') {
                return (
                  <td key={property}>
                    <button className="q-base-link" type="button" onClick={() => onOpen(row.path)}>
                      {rowTitle(row, workspacePath)} <Icon icon={ExternalLink} />
                    </button>
                  </td>
                );
              }
              return (
                <td key={property} onDblClick={() => { if (editable) onEditing(key); }}>
                  {editing === key && editable ? (
                    <input
                      autoFocus
                      defaultValue={displayValue(value)}
                      onBlur={(event) => {
                        const next = event.currentTarget.value;
                        onEditing(null);
                        void onCommit(row, property, next).catch((error) => console.error('Failed to edit base property', error));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') onEditing(null);
                      }}
                    />
                  ) : <span>{displayValue(value) || '—'}</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BaseList({
  rows,
  workspacePath,
  onOpen,
}: { rows: BaseRow[]; workspacePath: string; onOpen: (path: string) => void }) {
  return (
    <div className="q-base-list">
      {rows.map((row) => (
        <button key={row.path} type="button" onClick={() => onOpen(row.path)}>
          {rowTitle(row, workspacePath)}
        </button>
      ))}
    </div>
  );
}

function BaseCards({
  rows,
  columns,
  definition,
  workspacePath,
  onOpen,
}: {
  rows: BaseRow[];
  columns: string[];
  definition: BaseDefinition;
  workspacePath: string;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="q-base-cards">
      {rows.map((row) => (
        <article key={row.path} className="q-base-card">
          <button type="button" className="q-base-card__title" onClick={() => onOpen(row.path)}>
            {rowTitle(row, workspacePath)}
          </button>
          {columns.slice(0, 6).map((property) => (
            <div className="q-base-card__property" key={property}>
              <span>{propertyLabel(definition, property)}</span>
              <strong>{displayValue(baseProperty(row, property, workspacePath)) || '—'}</strong>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function BaseKanban({
  rows,
  columns,
  definition,
  view,
  viewIndex,
  workspacePath,
  onCommit,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: {
  rows: BaseRow[];
  columns: string[];
  definition: BaseDefinition;
  view: BaseViewDefinition;
  viewIndex: number;
  workspacePath: string;
  onCommit: (row: BaseRow, property: string, value: string) => Promise<void>;
  onCreate: (title: string, group: string) => Promise<void>;
  onOpen: (path: string) => void;
  onRename: (row: BaseRow, name: string) => Promise<void>;
  onDelete: (row: BaseRow) => Promise<void>;
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const dragged = useRef<BaseRow | null>(null);
  const [menu, setMenu] = useState<{ row: BaseRow; position: MenuPosition } | null>(null);
  const [renameTarget, setRenameTarget] = useState<BaseRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BaseRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const groupProperty = kanbanProperty(view);
  const writable = kanbanWritableProperty(groupProperty);
  const groupKey = editableKey(groupProperty);
  const board = buildKanbanColumns(groupKey ? rows.map((row) => moves[row.path] === undefined ? row : {
    ...row,
    fields: { ...row.fields, [groupKey]: moves[row.path] },
  }) : rows, view, workspacePath);
  const cardFields = columns
    .filter((property) => property !== 'file.name' && property !== groupProperty)
    .slice(0, 4);

  const clearMove = (path: string) => setMoves((current) => {
    if (!(path in current)) return current;
    const next = { ...current };
    delete next[path];
    return next;
  });

  const move = async (row: BaseRow, value: string) => {
    if (!writable || Array.isArray(baseProperty(row, groupProperty, workspacePath))) {
      setError(t('bases.kanbanNotWritable'));
      return;
    }
    const membership = boardMembership(definition, viewIndex);
    if (membership.kind === 'property'
      && membership.property === groupProperty.replace(/^note\./, '')
      && value !== membership.value) {
      setError(t('bases.kanbanExcluded'));
      return;
    }
    const current = displayValue(baseProperty(row, groupProperty, workspacePath));
    if (current === value) return;
    setMoves((state) => ({ ...state, [row.path]: value }));
    try {
      await onCommit(row, groupProperty, value);
      clearMove(row.path);
      setError('');
    } catch (cause) {
      clearMove(row.path);
      setError(t('bases.kanbanMoveError', { reason: String(cause) }));
    }
  };

  const startDrag = (event: ReactDragEvent<HTMLElement>, row: BaseRow) => {
    dragged.current = row;
    setDraggingPath(row.path);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.path);
    }
  };
  const endDrag = () => {
    dragged.current = null;
    setDraggingPath(null);
    setDragOver(null);
  };
  const dragOverColumn = (event: ReactDragEvent<HTMLElement>, key: string) => {
    if (!writable || !dragged.current) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  };
  const leaveColumn = (event: ReactDragEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragOver(null);
  };
  const dropOnColumn = (event: ReactDragEvent<HTMLElement>, value: string) => {
    event.preventDefault();
    const row = dragged.current
      ?? rows.find((candidate) => candidate.path === event.dataTransfer?.getData('text/plain'));
    endDrag();
    if (row) void move(row, value);
  };
  const showMenu = (row: BaseRow, x: number, y: number) => {
    setMenu({ row, position: { left: x, top: y } });
  };
  const submitRename = async () => {
    if (!renameTarget || actionBusy) return;
    setActionBusy(true);
    try {
      await onRename(renameTarget, renameValue.trim());
      setRenameTarget(null);
      setError('');
    } catch (cause) {
      setError(t('bases.kanbanRenameError', { reason: String(cause) }));
    } finally { setActionBusy(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || actionBusy) return;
    setActionBusy(true);
    try {
      await onDelete(deleteTarget);
      setDeleteTarget(null);
      setError('');
    } catch (cause) {
      setError(t('bases.kanbanDeleteError', { reason: String(cause) }));
    } finally { setActionBusy(false); }
  };

  const create = async (value: string) => {
    if (!draft.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      await onCreate(draft.trim(), value);
      setDraft('');
      setAddingTo(null);
    } catch (cause) {
      setError(t('bases.kanbanCreateError', { reason: String(cause) }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="q-base-kanban-wrapper">
      {error && <p className="q-base-kanban__error" role="alert">{error}</p>}
      <div className="q-base-kanban" role="list">
        {board.map((column) => (
          <section
            key={column.key}
            data-kanban-column={column.value}
            data-kanban-column-key={column.key}
            className={`q-base-kanban__column${dragOver === column.key ? ' q-base-kanban__column--drop' : ''}`}
            onDragOver={(event) => dragOverColumn(event, column.key)}
            onDragLeave={leaveColumn}
            onDrop={(event) => dropOnColumn(event, column.value)}
          >
            <header className="q-base-kanban__header">
              <span title={!column.value ? t('bases.kanbanUnassignedHint') : undefined}>
                {column.value || t('bases.kanbanUnassigned')}
              </span>
              <strong>{column.rows.length}</strong>
            </header>
            <div className="q-base-kanban__cards">
              {column.rows.map((row) => (
                <article
                  key={row.path}
                  className={`q-base-kanban__card${draggingPath === row.path ? ' q-base-kanban__card--dragging' : ''}`}
                  tabIndex={0}
                  draggable={writable}
                  aria-label={rowTitle(row, workspacePath)}
                  onDragStart={(event) => startDrag(event, row)}
                  onDragEnd={endDrag}
                  onContextMenu={(event) => { event.preventDefault(); showMenu(row, event.clientX, event.clientY); }}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest('button, select, input')) onOpen(row.path);
                  }}
                  onKeyDown={(event) => {
                    if (event.currentTarget !== event.target) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault(); onOpen(row.path);
                    }
                  }}
                >
                  <div className="q-base-kanban__card-heading">
                    <button type="button" className="q-base-card__title" onClick={() => onOpen(row.path)}>
                      {rowTitle(row, workspacePath)}
                    </button>
                    <button type="button" className="q-base-kanban__menu-trigger"
                      aria-label={t('bases.kanbanCardActions', { title: rowTitle(row, workspacePath) })}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        showMenu(row, rect.right, rect.bottom);
                      }}
                    ><Icon icon={MoreHorizontal} /></button>
                  </div>
                  {cardFields.map((property) => (
                    <div className="q-base-card__property" key={property}>
                      <span>{propertyLabel(definition, property)}</span>
                      <strong>{displayValue(baseProperty(row, property, workspacePath)) || '—'}</strong>
                    </div>
                  ))}
                  {writable && (
                    <select
                      className="q-base-kanban__move"
                      draggable={false}
                      aria-label={t('bases.kanbanMoveTo', { title: rowTitle(row, workspacePath) })}
                      value={column.value}
                      onChange={(event) => void move(row, event.currentTarget.value)}
                    >
                      {board.map((target) => (
                        <option value={target.value} key={target.key}>
                          {target.value || t('bases.kanbanUnassigned')}
                        </option>
                      ))}
                    </select>
                  )}
                </article>
              ))}
            </div>
            <div className="q-base-kanban__footer">
              {addingTo === column.key ? (
                <div className="q-base-kanban__composer">
                  <input
                    autoFocus
                    value={draft}
                    placeholder={t('bases.kanbanCardTitle')}
                    aria-label={t('bases.kanbanCardTitle')}
                    disabled={creating}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); void create(column.value); }
                      if (event.key === 'Escape') { setAddingTo(null); setDraft(''); setError(''); }
                    }}
                  />
                  <div className="q-base-kanban__composer-actions">
                    <button type="button" disabled={creating || !draft.trim()} onClick={() => void create(column.value)}>
                      {creating ? t('bases.kanbanCreating') : t('bases.kanbanCreate')}
                    </button>
                    <button type="button" disabled={creating} onClick={() => { setAddingTo(null); setDraft(''); }}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="q-base-kanban__add"
                  aria-label={t('bases.kanbanAddTo', { column: column.value || t('bases.kanbanUnassigned') })}
                  onClick={() => { setDraft(''); setError(''); setAddingTo(column.key); }}
                >
                  <Icon icon={Plus} /> {t('bases.kanbanAdd')}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      <Menu open={Boolean(menu)} position={menu?.position ?? null}
        onClose={() => setMenu(null)} items={menu ? [
          { id: 'open', label: t('bases.kanbanOpen'), icon: ExternalLink,
            onSelect: () => onOpen(menu.row.path) },
          { id: 'rename', label: t('common.rename'), icon: Pencil,
            onSelect: () => { setRenameValue(rowTitle(menu.row, workspacePath)); setRenameTarget(menu.row); setError(''); } },
          { id: 'delete', label: t('common.delete'), icon: Trash2,
            onSelect: () => { setDeleteTarget(menu.row); setError(''); } },
        ] : []} />
      <Dialog open={Boolean(renameTarget)} title={t('bases.kanbanRenameTitle')}
        closeLabel={t('common.cancel')} dismissible={!actionBusy}
        onClose={() => setRenameTarget(null)} className="q-base-kanban__dialog">
        <div className="q-base-kanban__dialog-body">
          <input autoFocus value={renameValue} aria-label={t('bases.kanbanCardTitle')}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitRename(); } }} />
          {error && <p role="alert" className="q-base-kanban__error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={actionBusy} onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button>
          <Button disabled={actionBusy || !renameValue.trim()} onClick={() => void submitRename()}>{t('common.rename')}</Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog open={Boolean(deleteTarget)}
        title={t('bases.kanbanDeleteTitle')}
        description={t('bases.kanbanDeleteDescription', { title: deleteTarget ? rowTitle(deleteTarget, workspacePath) : '' })}
        confirmLabel={t('common.delete')} error={error} pending={actionBusy}
        onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
    </div>
  );
}
