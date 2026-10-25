import { t } from '../../../../i18n';
import {
  baseProperty,
  type BaseDefinition,
  type BaseEvaluation,
  type BaseFieldValue,
  type BaseRow,
} from '../../../../modules/bases';
import { fileName } from '../../../../modules/paths';
import { BASE_FENCE_CLASSES } from './constants';
import type { BaseFenceResult } from './store';

export function renderBaseFenceDom(
  result: BaseFenceResult | undefined,
  basePath: string,
  workspacePath: string,
): HTMLElement {
  const root = document.createElement('div');
  root.className = BASE_FENCE_CLASSES.root;
  root.contentEditable = 'false';

  const card = document.createElement('div');
  card.className = BASE_FENCE_CLASSES.card;
  root.append(card);

  if (!result) {
    card.classList.add(BASE_FENCE_CLASSES.pending);
    card.append(textRow(BASE_FENCE_CLASSES.message, t('bases.loading')));
    return root;
  }

  if (result.status === 'failed') {
    card.classList.add(BASE_FENCE_CLASSES.failed);
    card.append(textRow(BASE_FENCE_CLASSES.message, result.message));
    return root;
  }

  const { definition, evaluation, viewIndex } = result;
  const head = document.createElement('div');
  head.className = BASE_FENCE_CLASSES.head;
  const name = document.createElement('span');
  name.className = BASE_FENCE_CLASSES.headName;
  name.textContent = `${fileName(basePath)} · ${definition.views[viewIndex]?.name || t('bases.untitledView')}`;
  const count = document.createElement('span');
  count.className = BASE_FENCE_CLASSES.headCount;
  count.textContent = String(evaluation.rows.length);
  head.append(name, count);
  card.append(head);

  if (evaluation.unsupported) {
    card.append(textRow('q-base-view__notice', t('bases.unsupported')));
  }
  for (const error of evaluation.errors) {
    card.append(textRow('q-base-view__notice', `${error.formula}: ${error.message}`));
  }

  if (evaluation.rows.length === 0) {
    card.append(textRow('q-base-state', t('bases.empty')));
    return root;
  }

  const groups = evaluation.groups.length > 0
    ? evaluation.groups
    : [{ label: null, start: 0, end: evaluation.rows.length }];
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'q-base-group';
    if (group.label !== null) {
      const heading = document.createElement('h2');
      heading.textContent = group.label || t('bases.groupEmpty');
      section.append(heading);
    }
    section.append(
      table(evaluation, definition, evaluation.rows.slice(group.start, group.end), workspacePath),
    );
    card.append(section);
  }
  return root;
}

function table(
  evaluation: BaseEvaluation,
  definition: BaseDefinition,
  rows: readonly BaseRow[],
  workspacePath: string,
): HTMLTableElement {
  const element = document.createElement('table');
  element.className = 'q-base-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const property of evaluation.columns) {
    const cell = document.createElement('th');
    cell.textContent = propertyLabel(definition, property);
    headRow.append(cell);
  }
  thead.append(headRow);
  element.append(thead);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const line = document.createElement('tr');
    for (const property of evaluation.columns) {
      const cell = document.createElement('td');
      if (property === 'file.name') {
        const link = document.createElement('span');
        link.className = 'q-base-link';
        link.dataset.baseRowPath = row.path;
        link.textContent = rowTitle(row, workspacePath);
        cell.append(link);
      } else {
        cell.textContent = displayValue(baseProperty(row, property, workspacePath)) || '—';
      }
      line.append(cell);
    }
    body.append(line);
  }
  element.append(body);
  return element;
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

function displayValue(value: BaseFieldValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

function rowTitle(row: BaseRow, workspacePath: string): string {
  return displayValue(baseProperty(row, 'file.name', workspacePath)) || fileName(row.path);
}

function textRow(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}
