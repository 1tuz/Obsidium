import { t } from '../../../../i18n';
import { Plus } from 'lucide';
import { renderMarkdownToHtml } from '../../../../modules/export/markdownToHtml';
import { createIconElement } from '../../../Common/iconElement';
import {
    anchorAt,
    columnCount,
    mergeAt,
    rangesIntersect,
    rowCount,
    type CellRef,
    type MergeRange,
    type TableModel,
} from './model';
import { paintStripLabels } from './widgetDomStrips';
import { displayedColWidths, syncStripSizes } from './geometry';

function createTableAddIcon(): HTMLElement {
    const icon = document.createElement('span');
    icon.className = 'q-md-table-add-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(createIconElement(Plus, 1.5));
    return icon;
}

const BLOCK_ELEMENTS: Record<string, true> = {
    ADDRESS: true, ARTICLE: true, ASIDE: true, BLOCKQUOTE: true, DIV: true, DL: true,
    FIELDSET: true, FIGCAPTION: true, FIGURE: true, FOOTER: true, FORM: true,
    H1: true, H2: true, H3: true, H4: true, H5: true, H6: true, HEADER: true, HR: true,
    LI: true, MAIN: true, NAV: true, OL: true, P: true, PRE: true, SECTION: true,
    TABLE: true, UL: true,
};

function inlineCellMarkup(text: string): string | null {
    const template = document.createElement('template');
    template.innerHTML = renderMarkdownToHtml(text);
    const nodes = [...template.content.childNodes];
    const elements = nodes.filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);
    if (!elements.length) return null;
    const strayText = nodes.some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    );

    if (elements.length === 1 && !strayText && elements[0].tagName === 'P') {
        return elements[0].innerHTML;
    }
    if (strayText || elements.some((element) => BLOCK_ELEMENTS[element.tagName])) return null;
    return template.innerHTML;
}

export function setWrapperText(wrapper: HTMLElement, text: string): void {
    wrapper.replaceChildren();
    if (!text) {
        wrapper.appendChild(document.createElement('br'));
        return;
    }

    const wikiLink = text.match(/^\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/);
    if (wikiLink) {
        const target = wikiLink[1].trim();
        const link = document.createElement('span');
        link.className = 'q-md-link q-md-table-wiki-link';
        link.dataset.wikiTarget = target;
        link.textContent = wikiLink[2]?.trim() || target;
        wrapper.appendChild(link);
        return;
    }

    const markup = inlineCellMarkup(text);
    if (markup == null) {
        wrapper.textContent = text;
        return;
    }

    wrapper.innerHTML = markup;
    const anchors = wrapper.querySelectorAll('a');
    for (const anchor of anchors) anchor.setAttribute('rel', 'noopener noreferrer');
}

function buildRow(model: TableModel, row: number): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.style.height = `${model.rowHeights[row]}px`;
    const cols = columnCount(model);
    for (let col = 0; col < cols; col += 1) {
        const anchor = anchorAt(model, row, col);
        if (!anchor || anchor.row !== row || anchor.col !== col) continue;
        const merge = mergeAt(model, row, col);

        const el = document.createElement('td');
        el.className = 'q-md-table-cell';
        el.dataset.row = String(row);
        el.dataset.col = String(col);
        if (merge) {
            el.rowSpan = merge.bottom - merge.top + 1;
            el.colSpan = merge.right - merge.left + 1;
        }

        const align = model.aligns[col];
        if (align) el.style.textAlign = align;

        const wrapper = document.createElement('div');
        wrapper.className = 'q-md-table-cell-wrapper';
        setWrapperText(wrapper, model.cells[row][col]);
        el.appendChild(wrapper);
        tr.appendChild(el);
    }
    return tr;
}

function syncColumns(root: HTMLElement, model: TableModel): void {
    const table = root.querySelector('.q-md-table-editor') as HTMLTableElement | null;
    if (!table) return;

    const explicit = model.colSizing === 'explicit';
    table.dataset.sizing = explicit ? 'explicit' : 'auto';
    const widths = displayedColWidths(root, model);
    const colgroup = document.createElement('colgroup');
    for (let col = 0; col < columnCount(model); col += 1) {
        const el = document.createElement('col');
        if (explicit) el.style.width = `${widths[col]}px`;
        colgroup.appendChild(el);
    }
    const current = table.querySelector('colgroup');
    if (current) current.replaceWith(colgroup);
    else table.insertBefore(colgroup, table.firstChild);
    table.style.width = explicit ? `${widths.reduce((sum, width) => sum + width, 0)}px` : '100%';
}

export function refitTableColumns(root: HTMLElement, model: TableModel): void {
    syncColumns(root, model);
    syncStripSizes(root, model);
}

export function paintTableModel(root: HTMLElement, model: TableModel): void {
    const table = root.querySelector('.q-md-table-editor') as HTMLTableElement | null;
    if (!table) return;

    syncColumns(root, model);
    let tbody = table.querySelector('tbody');
    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }

    const rows: HTMLTableRowElement[] = [];
    for (let r = 0; r < rowCount(model); r += 1) {
        rows.push(buildRow(model, r));
    }
    tbody.replaceChildren(...rows);
    paintStripLabels(root, model);
    syncStripSizes(root, model);
}

export function renderTableWidgetDom(model: TableModel): HTMLElement {
    const root = document.createElement('div');
    root.className = 'q-md-table-widget';
    root.contentEditable = 'false';

    const shell = document.createElement('div');
    shell.className = 'q-md-table-shell';

    const scroll = document.createElement('div');
    scroll.className = 'q-md-table-scroll';

    const layout = document.createElement('div');
    layout.className = 'q-md-table-layout';

    const corner = document.createElement('div');
    corner.className = 'q-md-table-corner';
    corner.setAttribute('aria-hidden', 'true');

    const colStrip = document.createElement('div');
    colStrip.className = 'q-md-table-col-strip';
    colStrip.setAttribute('role', 'presentation');

    const rowStrip = document.createElement('div');
    rowStrip.className = 'q-md-table-row-strip';
    rowStrip.setAttribute('role', 'presentation');

    const tableHost = document.createElement('div');
    tableHost.className = 'q-md-table-table-host';

    const table = document.createElement('table');
    table.className = 'q-md-table-editor';
    table.tabIndex = -1;
    table.appendChild(document.createElement('tbody'));

    const selection = document.createElement('div');
    selection.className = 'q-md-table-selection-overlay';
    selection.hidden = true;

    const addCol = document.createElement('div');
    addCol.className = 'q-md-table-add-col';
    addCol.setAttribute('aria-label', t('editor.table.addColumn'));
    addCol.appendChild(createTableAddIcon());

    const addRow = document.createElement('div');
    addRow.className = 'q-md-table-add-row';
    addRow.setAttribute('aria-label', t('editor.table.addRow'));
    addRow.appendChild(createTableAddIcon());

    tableHost.append(table, selection);
    layout.append(corner, colStrip, rowStrip, tableHost, addCol, addRow);
    scroll.appendChild(layout);
    shell.appendChild(scroll);
    root.appendChild(shell);

    paintTableModel(root, model);
    return root;
}

export function findCellWrapper(root: HTMLElement, cell: CellRef): HTMLElement | null {
    const selector = `.q-md-table-cell[data-row="${cell.row}"][data-col="${cell.col}"] .q-md-table-cell-wrapper`;
    return root.querySelector(selector) as HTMLElement | null;
}

export function paintCellWrapper(root: HTMLElement, cell: CellRef, text: string): void {
    const wrapper = findCellWrapper(root, cell);
    if (wrapper) setWrapperText(wrapper, text);
}

export function paintTableSelection(root: HTMLElement, range: MergeRange | null): void {
    const overlay = root.querySelector('.q-md-table-selection-overlay') as HTMLElement | null;
    if (!overlay) return;
    if (!range) {
        overlay.hidden = true;
        return;
    }

    const selected = [...root.querySelectorAll<HTMLTableCellElement>('.q-md-table-cell')]
        .filter((cell) => {
            const row = Number(cell.dataset.row);
            const col = Number(cell.dataset.col);
            const span = { top: row, left: col, bottom: row + cell.rowSpan - 1, right: col + cell.colSpan - 1 };
            return rangesIntersect(span, range);
        });
    if (!selected.length || !overlay.parentElement) {
        overlay.hidden = true;
        return;
    }

    const parentRect = overlay.parentElement.getBoundingClientRect();
    const rects = selected.map((cell) => cell.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left)) - parentRect.left;
    const top = Math.min(...rects.map((rect) => rect.top)) - parentRect.top;
    const right = Math.max(...rects.map((rect) => rect.right)) - parentRect.left;
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - parentRect.top;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${right - left}px`;
    overlay.style.height = `${bottom - top}px`;
    overlay.hidden = false;
}
