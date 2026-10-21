import { t } from '../../../../i18n';
import { columnCount, rowCount } from './model';
import type { TableModel } from './model';

function columnLabel(col: number): string {
    let index = col;
    let label = '';
    while (index >= 0) {
        label = String.fromCharCode(65 + (index % 26)) + label;
        index = Math.floor(index / 26) - 1;
    }
    return label;
}

export function paintStripLabels(root: HTMLElement, model: TableModel): void {
    const colStrip = root.querySelector('.q-md-table-col-strip');
    const rowStrip = root.querySelector('.q-md-table-row-strip');
    if (!colStrip || !rowStrip) return;

    const cols = columnCount(model);
    const rows = rowCount(model);

    colStrip.replaceChildren();
    for (let col = 0; col < cols; col += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-md-table-strip-btn q-md-table-col-strip-btn';
        button.dataset.col = String(col);
        button.textContent = columnLabel(col);
        button.setAttribute('aria-label', t('editor.table.columnAria', { label: columnLabel(col) }));
        colStrip.appendChild(button);
    }

    rowStrip.replaceChildren();
    for (let row = 0; row < rows; row += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-md-table-strip-btn q-md-table-row-strip-btn';
        button.dataset.row = String(row);
        button.textContent = String(row + 1);
        button.setAttribute('aria-label', t('editor.table.rowAria', { label: row + 1 }));
        rowStrip.appendChild(button);
    }
}
