import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide';
import { Button } from '../Common/Button';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import type { BaseFilter, BaseGroupBy, BaseSort, BaseViewDefinition } from '../../modules/bases';
import './BaseEditorPanel.css';

export interface BaseViewEdit {
  name: string;
  limit: number | null;
  groupBy: BaseGroupBy | null;
  sort: BaseSort[];
  relations: string[];
  order: string[];
  filters?: BaseFilter | null;
}

interface BaseEditorPanelProps {
  view: BaseViewDefinition;
  columns: string[];
  relations: string[];
  onClose: () => void;
  onSave: (edit: BaseViewEdit) => Promise<boolean>;
}

type FilterMode = 'and' | 'or';
type FilterOperator =
  | 'is'
  | 'isNot'
  | 'greater'
  | 'greaterOrEqual'
  | 'less'
  | 'lessOrEqual'
  | 'contains'
  | 'hasTag'
  | 'inFolder';

interface FilterCondition {
  property: string;
  operator: FilterOperator;
  value: string;
}

const FILTER_OPERATORS: FilterOperator[] = [
  'is',
  'isNot',
  'greater',
  'greaterOrEqual',
  'less',
  'lessOrEqual',
  'contains',
  'hasTag',
  'inFolder',
];

const COMPARISON_SYMBOLS: Partial<Record<FilterOperator, string>> = {
  is: '==',
  isNot: '!=',
  greater: '>',
  greaterOrEqual: '>=',
  less: '<',
  lessOrEqual: '<=',
};

const PROPERTYLESS_OPERATORS: FilterOperator[] = ['hasTag', 'inFolder'];

function operatorLabel(operator: FilterOperator): string {
  return t(`bases.editorFilterOperator.${operator}`);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function parseCondition(expression: string): FilterCondition | null {
  const source = expression.trim();
  const tag = /^file\.hasTag\((.+)\)$/u.exec(source);
  if (tag) return { property: '', operator: 'hasTag', value: unquote(tag[1]) };
  const folder = /^file\.inFolder\((.+)\)$/u.exec(source);
  if (folder) return { property: '', operator: 'inFolder', value: unquote(folder[1]) };
  const contains = /^([\w.-]+)\.contains\((.+)\)$/u.exec(source);
  if (contains) return { property: contains[1], operator: 'contains', value: unquote(contains[2]) };
  const comparison = /^([\w.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u.exec(source);
  if (!comparison) return null;
  const operator = (Object.keys(COMPARISON_SYMBOLS) as FilterOperator[])
    .find((candidate) => COMPARISON_SYMBOLS[candidate] === comparison[2]);
  if (!operator) return null;
  return { property: comparison[1], operator, value: unquote(comparison[3]) };
}

function quoteValue(value: string): string {
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value) || /^(?:true|false)$/iu.test(value)) return value;
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

function filterExpression(condition: FilterCondition): string {
  const value = quoteValue(condition.value.trim());
  if (condition.operator === 'hasTag') return `file.hasTag(${value})`;
  if (condition.operator === 'inFolder') return `file.inFolder(${value})`;
  if (condition.operator === 'contains') return `${condition.property}.contains(${value})`;
  return `${condition.property} ${COMPARISON_SYMBOLS[condition.operator]} ${value}`;
}

function buildFilters(conditions: FilterCondition[], mode: FilterMode): BaseFilter | null {
  const expressions = conditions.map(filterExpression);
  if (expressions.length === 0) return null;
  if (expressions.length === 1) return expressions[0];
  return mode === 'or' ? { or: expressions } : { and: expressions };
}

function readFilters(
  filters: BaseFilter | undefined,
): { mode: FilterMode; conditions: FilterCondition[] } | null {
  if (filters === undefined) return { mode: 'and', conditions: [] };
  if (typeof filters === 'string') {
    const condition = parseCondition(filters);
    return condition ? { mode: 'and', conditions: [condition] } : null;
  }
  const operands = filters.and ?? filters.or;
  if (!operands) return null;
  const conditions: FilterCondition[] = [];
  for (const operand of operands) {
    if (typeof operand !== 'string') return null;
    const condition = parseCondition(operand);
    if (!condition) return null;
    conditions.push(condition);
  }
  return { mode: filters.or ? 'or' : 'and', conditions };
}

interface FilterSectionProps {
  advanced: boolean;
  busy: boolean;
  conditions: FilterCondition[];
  mode: FilterMode;
  propertyOptions: string[];
  onChange: (index: number, patch: Partial<FilterCondition>) => void;
  onMode: (mode: FilterMode) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

function FilterSection({
  advanced,
  busy,
  conditions,
  mode,
  propertyOptions,
  onChange,
  onMode,
  onAdd,
  onRemove,
}: FilterSectionProps) {
  return (
    <div className="q-base-editor__field">
      <span>{t('bases.editorFilters')}</span>
      {advanced ? (
        <p className="q-base-editor__empty">{t('bases.editorFiltersAdvanced')}</p>
      ) : (
        <>
          {conditions.length > 1 && (
            <select
              aria-label={t('bases.editorFilterMatch')}
              value={mode}
              onChange={(event) => onMode(event.currentTarget.value === 'or' ? 'or' : 'and')}
            >
              <option value="and">{t('bases.editorFilterMatchAll')}</option>
              <option value="or">{t('bases.editorFilterMatchAny')}</option>
            </select>
          )}
          {conditions.length === 0 && (
            <p className="q-base-editor__empty">{t('bases.editorFiltersEmpty')}</p>
          )}
          {conditions.map((condition, index) => {
            const properties = [...new Set([condition.property, ...propertyOptions])]
              .filter(Boolean);
            const propertyless = PROPERTYLESS_OPERATORS.includes(condition.operator);
            return (
              <div className="q-base-editor__row" key={index}>
                {!propertyless && (
                  <select
                    aria-label={t('bases.editorFilterProperty', { index: index + 1 })}
                    value={condition.property}
                    onChange={(event) => onChange(index, { property: event.currentTarget.value })}
                  >
                    {properties.map((property) => (
                      <option key={property} value={property}>{property}</option>
                    ))}
                  </select>
                )}
                <select
                  aria-label={t('bases.editorFilterOperatorLabel', { index: index + 1 })}
                  value={condition.operator}
                  onChange={(event) => onChange(index, {
                    operator: event.currentTarget.value as FilterOperator,
                  })}
                >
                  {FILTER_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>{operatorLabel(operator)}</option>
                  ))}
                </select>
                <input
                  className="q-base-editor__value"
                  aria-label={t('bases.editorFilterValue', { index: index + 1 })}
                  value={condition.value}
                  onChange={(event) => onChange(index, { value: event.currentTarget.value })}
                />
                <button
                  type="button"
                  aria-label={t('bases.editorFilterRemove', { index: index + 1 })}
                  disabled={busy}
                  onClick={() => onRemove(index)}
                >
                  <Icon icon={X} />
                </button>
              </div>
            );
          })}
          <Button variant="ghost" size="s" disabled={busy} onClick={onAdd}>
            <Icon icon={Plus} /> {t('bases.editorFilterAdd')}
          </Button>
        </>
      )}
    </div>
  );
}

interface ColumnOrderSectionProps {
  busy: boolean;
  columns: string[];
  onMove: (index: number, delta: number) => void;
}

function ColumnOrderSection({ busy, columns, onMove }: ColumnOrderSectionProps) {
  return (
    <div className="q-base-editor__field">
      <span>{t('bases.editorColumns')}</span>
      {columns.length === 0 ? (
        <p className="q-base-editor__empty">{t('bases.editorColumnsEmpty')}</p>
      ) : (
        <div className="q-base-editor__sort">
          {columns.map((column, index) => (
            <div className="q-base-editor__column-row" key={`${column}:${index}`}>
              <span title={column}>{column}</span>
              <button
                type="button"
                aria-label={t('bases.editorColumnUp', { property: column })}
                disabled={busy || index === 0}
                onClick={() => onMove(index, -1)}
              >
                <Icon icon={ArrowUp} />
              </button>
              <button
                type="button"
                aria-label={t('bases.editorColumnDown', { property: column })}
                disabled={busy || index === columns.length - 1}
                onClick={() => onMove(index, 1)}
              >
                <Icon icon={ArrowDown} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BaseEditorPanel({ view, columns, relations, onClose, onSave }: BaseEditorPanelProps) {
  const [name, setName] = useState(view.name);
  const [limit, setLimit] = useState(view.limit === undefined ? '' : String(view.limit));
  const [groupProperty, setGroupProperty] = useState(view.groupBy?.property ?? '');
  const [groupDirection, setGroupDirection] = useState<'ASC' | 'DESC'>(
    view.groupBy?.direction === 'DESC' ? 'DESC' : 'ASC',
  );
  const [sort, setSort] = useState<BaseSort[]>(view.sort ?? []);
  const [relationKeys, setRelationKeys] = useState<string[]>(relations);
  const initialFilters = readFilters(view.filters);
  const [filterMode, setFilterMode] = useState<FilterMode>(initialFilters?.mode ?? 'and');
  const [conditions, setConditions] = useState<FilterCondition[]>(initialFilters?.conditions ?? []);
  const [order, setOrder] = useState<string[]>(view.order);
  const [sortProperty, setSortProperty] = useState(
    columns.find((property) => !(view.sort ?? []).some((entry) => entry.property === property)) ?? '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const advancedFilters = initialFilters === null;
  const orderColumns = order.length > 0 ? order : columns;
  const available = columns.filter((property) => !sort.some((entry) => entry.property === property));
  const choice = available.includes(sortProperty) ? sortProperty : available[0] ?? '';
  const groupOptions = groupProperty && !columns.includes(groupProperty)
    ? [groupProperty, ...columns]
    : columns;
  const relationOptions = [...new Set([...columns, ...relationKeys])]
    .filter((property) => !/^(?:file|formula|summary)\./u.test(property));

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
    if (!advancedFilters) {
      for (const condition of conditions) {
        if (!PROPERTYLESS_OPERATORS.includes(condition.operator) && !condition.property) {
          setError(t('bases.editorFilterPropertyRequired'));
          return;
        }
        if (!condition.value.trim()) {
          setError(t('bases.editorFilterValueRequired'));
          return;
        }
      }
    }
    setBusy(true);
    setError('');
    try {
      const saved = await onSave({
        name: trimmed,
        limit: nextLimit,
        groupBy: groupProperty ? { property: groupProperty, direction: groupDirection } : null,
        sort,
        relations: relationKeys,
        order: order.length > 0 ? order : view.order,
        filters: advancedFilters ? undefined : buildFilters(conditions, filterMode),
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

  const changeCondition = (index: number, patch: Partial<FilterCondition>) => {
    setConditions((current) => current.map((entry, position) => {
      if (position !== index) return entry;
      const next = { ...entry, ...patch };
      if (!PROPERTYLESS_OPERATORS.includes(next.operator) && !next.property) {
        next.property = columns[0] ?? '';
      }
      return next;
    }));
  };

  const addCondition = () => {
    setConditions((current) => [...current, {
      property: columns[0] ?? '',
      operator: 'is',
      value: '',
    }]);
  };

  const removeCondition = (index: number) => {
    setConditions((current) => current.filter((_, position) => position !== index));
  };

  const moveColumn = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= orderColumns.length) return;
    const next = [...orderColumns];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
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
        <FilterSection
          advanced={advancedFilters}
          busy={busy}
          conditions={conditions}
          mode={filterMode}
          propertyOptions={columns}
          onChange={changeCondition}
          onMode={setFilterMode}
          onAdd={addCondition}
          onRemove={removeCondition}
        />
        <ColumnOrderSection busy={busy} columns={orderColumns} onMove={moveColumn} />
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
        <div className="q-base-editor__field">
          <span>{t('bases.editorRelations')}</span>
          {relationOptions.length === 0 ? (
            <p className="q-base-editor__empty">{t('bases.editorRelationsEmpty')}</p>
          ) : (
            <div className="q-base-editor__sort">
              {relationOptions.map((property) => (
                <div className="q-base-editor__row" key={property}>
                  <span title={property}>{property}</span>
                  <select
                    aria-label={t('bases.editorPropertyType', { property })}
                    value={relationKeys.includes(property) ? 'relation' : ''}
                    onChange={(event) => {
                      const relation = event.currentTarget.value === 'relation';
                      setRelationKeys((current) => (relation
                        ? [...current.filter((entry) => entry !== property), property]
                        : current.filter((entry) => entry !== property)));
                    }}
                  >
                    <option value="">{t('bases.editorPropertyTypeText')}</option>
                    <option value="relation">{t('bases.editorPropertyTypeRelation')}</option>
                  </select>
                </div>
              ))}
            </div>
          )}
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
