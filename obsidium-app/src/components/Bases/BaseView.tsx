import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  evaluateBaseFilter,
  getBaseRows,
  kanbanProperty,
  kanbanWritableProperty,
  parseBase,
  sortBaseRows,
  type BaseDefinition,
  type BaseFieldValue,
  type BaseRow,
  type BaseSort,
  type BaseViewDefinition,
} from '../../modules/bases';
import { planKanbanCard } from '../../modules/bases/cardCreation';
import { resolveBaseViewIndex } from '../../modules/bases/viewSelection';
import './BaseView.css';

interface BaseViewProps {
  path: string;
  workspacePath: string;
  indexReady: boolean;
  indexRevision: number;
  onOpenNote: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
  onFileDeleted?: (path: string) => void;
  viewRequest?: { path: string; index: number; id: number } | null;
  onViewRequestConsumed?: (id: number) => void;
}

interface LoadedBase {
  path: string;
  definition: BaseDefinition;
  rows: BaseRow[];
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
    ?? key.replace(/^formula\./, '');
}

function editableKey(property: string): string | null {
  if (property.startsWith('file.') || property.startsWith('formula.')) return null;
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

function viewColumns(view: BaseViewDefinition, rows: readonly BaseRow[]): string[] {
  if (view.order.length > 0) return view.order;
  const properties = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row.fields)) properties.add(key);
  }
  return ['file.name', ...[...properties].slice(0, 7)];
}

export function BaseView({
  path,
  workspacePath,
  indexReady,
  indexRevision,
  onOpenNote,
  onFileRenamed,
  onFileDeleted,
  viewRequest,
  onViewRequestConsumed,
}: BaseViewProps) {
  const [loaded, setLoaded] = useState<LoadedBase | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeView, setActiveView] = useState(0);
  const [sort, setSort] = useState<BaseSort[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const selectedPath = useRef('');
  const selectionRevision = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  const persistView = useCallback((index: number) => {
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => saveBaseView(workspacePath, path, index))
      .catch((error) => console.error('Failed to save active Base view', error));
  }, [path, workspacePath]);

  useEffect(() => {
    setLoaded(null);
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
    void Promise.all([readFileSnapshot(path), getBaseRows(workspacePath)])
      .then(([snapshot, rows]) => {
        if (!cancelled) setLoaded({ path, definition: parseBase(snapshot.content), rows });
      })
      .catch((error) => {
        console.error('Failed to load base', error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [indexReady, indexRevision, path, workspacePath]);

  const view = loaded?.definition.views[Math.min(activeView, (loaded?.definition.views.length ?? 1) - 1)];
  const materialized = useMemo(() => {
    if (!loaded || !view) return { rows: [] as BaseRow[], unsupported: false };
    let unsupported = loaded.definition.unsupportedKeys.length > 0
      || view.order.some((property) => property.startsWith('formula.'));
    const rows = loaded.rows.filter((row) => {
      const global = evaluateBaseFilter(loaded.definition.filters, row, workspacePath);
      const local = evaluateBaseFilter(view.filters, row, workspacePath);
      unsupported ||= global.unsupported || local.unsupported;
      return global.match && local.match;
    });
    const sorting = sort.length > 0
      ? sort
      : view.sort?.length
        ? view.sort
        : [{ property: 'file.name', direction: 'ASC' as const }];
    const ordered = sortBaseRows(rows, sorting, workspacePath);
    return {
      rows: view.limit ? ordered.slice(0, view.limit) : ordered,
      unsupported,
    };
  }, [loaded, sort, view, workspacePath]);

  const columns = useMemo(
    () => view && loaded ? viewColumns(view, materialized.rows) : [],
    [loaded, materialized.rows, view],
  );

  if (failed) return <div className="q-base-state">{t('bases.error')}</div>;
  if (!loaded || !view) return <div className="q-base-state">{t('bases.loading')}</div>;

  const commitProperty = async (row: BaseRow, property: string, value: string) => {
    const key = editableKey(property);
    if (!key) return;
    const previous = row.fields[key];
    const array = Array.isArray(previous);
    const snapshot = await readFileSnapshot(row.path);
    const content = nextFrontmatter(snapshot.content, key, value, array);
    await writeFileAtomic(row.path, content, snapshot.hash);
    setLoaded((current) => current ? {
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
    setLoaded((current) => current && current.path === path ? {
      ...current,
      rows: [...current.rows.filter((row) => row.path !== created), { path: created, fields: draft.fields }],
    } : current);
  };

  const renameCard = async (row: BaseRow, name: string) => {
    const safe = sanitizeFileName(name);
    if (!safe || safe !== name.trim()) throw new Error(t('bases.kanbanInvalidTitle'));
    const renamed = await renameWorkspaceFile(row.path, safe);
    if (!renamed) return;
    setLoaded((current) => current ? {
      ...current,
      rows: current.rows.map((entry) => entry.path === row.path ? { ...entry, path: renamed } : entry),
    } : current);
    onFileRenamed?.(row.path, renamed);
  };

  const deleteCard = async (row: BaseRow) => {
    await trashFile(workspacePath, row.path);
    setLoaded((current) => current ? {
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

  const grouped = groupRows(materialized.rows, view, workspacePath);
  const kind = ['table', 'list', 'cards', 'kanban'].includes(view.type) ? view.type : 'table';

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
        </div>
        <span className="q-base-view__count">{materialized.rows.length}</span>
      </header>

      {materialized.unsupported && (
        <p className="q-base-view__notice">{t('bases.unsupported')}</p>
      )}

      <div className="q-base-view__scroll">
        {materialized.rows.length === 0 && kind !== 'kanban' ? (
          <div className="q-base-state">{t('bases.empty')}</div>
        ) : kind === 'kanban' ? (
          <BaseKanban
            rows={materialized.rows}
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
        ) : grouped.map((group) => (
          <section className="q-base-group" key={group.key}>
            {group.label !== null && <h2>{group.label || t('bases.groupEmpty')}</h2>}
            {kind === 'table' && (
              <BaseTable
                rows={group.rows}
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
              <BaseList rows={group.rows} workspacePath={workspacePath} onOpen={onOpenNote} />
            )}
            {kind === 'cards' && (
              <BaseCards
                rows={group.rows}
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

function groupRows(rows: BaseRow[], view: BaseViewDefinition, workspacePath: string) {
  if (!view.groupBy) return [{ key: '__all__', label: null as string | null, rows }];
  const buckets = new Map<string, BaseRow[]>();
  for (const row of rows) {
    const value = displayValue(baseProperty(row, view.groupBy.property, workspacePath));
    const bucket = buckets.get(value) ?? [];
    bucket.push(row);
    buckets.set(value, bucket);
  }
  const groups = [...buckets.entries()].map(([label, items]) => ({ key: label || '__empty__', label, rows: items }));
  const direction = view.groupBy.direction === 'DESC' ? -1 : 1;
  const configured = new Map((view.groupOrder ?? []).map((value, index) => [String(value ?? ''), index]));
  groups.sort((left, right) => {
    const a = configured.get(left.label);
    const b = configured.get(right.label);
    if (a !== undefined || b !== undefined) return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
    return left.label.localeCompare(right.label, undefined, { numeric: true }) * direction;
  });
  return groups;
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
  const [dragging, setDragging] = useState<{ title: string; x: number; y: number } | null>(null);
  const pointer = useRef<{ id: number; row: BaseRow; x: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [menu, setMenu] = useState<{ row: BaseRow; position: MenuPosition } | null>(null);
  const [renameTarget, setRenameTarget] = useState<BaseRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BaseRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const groupProperty = kanbanProperty(view);
  const writable = kanbanWritableProperty(groupProperty);
  const board = buildKanbanColumns(rows, view, workspacePath);
  const cardFields = columns
    .filter((property) => property !== 'file.name' && property !== groupProperty)
    .slice(0, 4);

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
    try {
      await onCommit(row, groupProperty, value);
      setError('');
    } catch (cause) {
      setError(t('bases.kanbanMoveError', { reason: String(cause) }));
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, row: BaseRow) => {
    if (!writable || event.button !== 0 || pointer.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('select, input, textarea, .q-base-kanban__menu-trigger')) return;
    pointer.current = { id: event.pointerId, row, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = pointer.current;
    if (!session || session.id !== event.pointerId) return;
    if (!session.active && Math.hypot(event.clientX - session.x, event.clientY - session.y) < 6) return;
    session.active = true;
    event.preventDefault();
    setDragging({ title: rowTitle(session.row, workspacePath), x: event.clientX, y: event.clientY });
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-kanban-column]');
    setDragOver(target?.dataset.kanbanColumnKey ?? null);
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = pointer.current;
    if (!session || session.id !== event.pointerId) return;
    pointer.current = null;
    setDragging(null);
    setDragOver(null);
    if (!session.active || event.type === 'pointercancel') return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-kanban-column]');
    if (target) void move(session.row, target.dataset.kanbanColumn ?? '');
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
                  className="q-base-kanban__card"
                  tabIndex={0}
                  aria-label={rowTitle(row, workspacePath)}
                  onPointerDown={(event) => startDrag(event, row)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onContextMenu={(event) => { event.preventDefault(); showMenu(row, event.clientX, event.clientY); }}
                  onClick={(event) => {
                    if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); return; }
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
                    <button type="button" className="q-base-card__title" onClick={() => { if (!suppressClick.current) onOpen(row.path); }}>
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
      {dragging && (
        <div className="q-base-kanban__drag-ghost" aria-hidden="true"
          style={{ left: dragging.x + 12, top: dragging.y + 12 }}>
          {dragging.title}
        </div>
      )}
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
