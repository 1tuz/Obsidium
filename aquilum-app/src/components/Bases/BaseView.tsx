import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { fileName } from '../../modules/paths';
import { readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { setFrontmatterField } from '../../modules/docs/frontmatter';
import { loadBaseView, saveBaseView } from '../../modules/ui-state/gateway';
import {
  baseProperty,
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
import { resolveBaseViewIndex } from '../../modules/bases/viewSelection';
import './BaseView.css';

interface BaseViewProps {
  path: string;
  workspacePath: string;
  indexReady: boolean;
  indexRevision: number;
  onOpenNote: (path: string) => void;
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
            workspacePath={workspacePath}
            onCommit={commitProperty}
            onOpen={onOpenNote}
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
  workspacePath,
  onCommit,
  onOpen,
}: {
  rows: BaseRow[];
  columns: string[];
  definition: BaseDefinition;
  view: BaseViewDefinition;
  workspacePath: string;
  onCommit: (row: BaseRow, property: string, value: string) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  const groupProperty = kanbanProperty(view);
  const writable = kanbanWritableProperty(groupProperty);
  const board = buildKanbanColumns(rows, view, workspacePath);
  const cardFields = columns
    .filter((property) => property !== 'file.name' && property !== groupProperty)
    .slice(0, 4);

  const move = (event: DragEvent, value: string) => {
    if (!writable) return;
    event.preventDefault();
    const path = event.dataTransfer?.getData('text/plain');
    const row = rows.find((candidate) => candidate.path === path);
    if (!row) return;
    const current = displayValue(baseProperty(row, groupProperty, workspacePath));
    if (current === value) return;
    void onCommit(row, groupProperty, value)
      .catch((error) => console.error('Failed to move base kanban card', error));
  };

  return (
    <div className="q-base-kanban" role="list">
      {board.map((column) => (
        <section
          key={column.key}
          className="q-base-kanban__column"
          onDragOver={(event) => { if (writable) event.preventDefault(); }}
          onDrop={(event) => move(event, column.value)}
        >
          <header className="q-base-kanban__header">
            <span>{column.value || t('bases.groupEmpty')}</span>
            <strong>{column.rows.length}</strong>
          </header>
          <div className="q-base-kanban__cards">
            {column.rows.map((row) => (
              <article
                key={row.path}
                className="q-base-kanban__card"
                draggable={writable}
                onDragStart={(event) => {
                  event.dataTransfer?.setData('text/plain', row.path);
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                }}
              >
                <button type="button" className="q-base-card__title" onClick={() => onOpen(row.path)}>
                  {rowTitle(row, workspacePath)}
                </button>
                {cardFields.map((property) => (
                  <div className="q-base-card__property" key={property}>
                    <span>{propertyLabel(definition, property)}</span>
                    <strong>{displayValue(baseProperty(row, property, workspacePath)) || '—'}</strong>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
