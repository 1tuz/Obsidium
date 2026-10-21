import { columnCount, MIN_COL_WIDTH, type TableModel } from './model';

function measuredSize(size: number): number | null {
    return Number.isFinite(size) && size > 0 ? size : null;
}

export function tableOverlayHost(root: HTMLElement): HTMLElement {
    return (root.querySelector('.q-md-table-layout') as HTMLElement | null) ?? root;
}

export function scaleColWidths(widths: number[], available: number | null | undefined): number[] {
    const stored = widths.map((width) => (Number.isFinite(width) && width > 0 ? width : MIN_COL_WIDTH));
    if (stored.length === 0) return [];
    const total = stored.reduce((sum, width) => sum + width, 0);
    const room = available != null && Number.isFinite(available) && available > 0 ? Math.floor(available) : null;
    if (room == null || total <= 0) return stored;

    const scaled = new Array<number>(stored.length).fill(0);
    let pool = stored.map((_, index) => index);
    let remaining = Math.max(room, stored.length * MIN_COL_WIDTH);

    while (pool.length > 0) {
        const weight = pool.reduce((sum, index) => sum + stored[index], 0);
        const exact = pool.map((index) => (stored[index] / weight) * remaining);
        const clamped = pool.filter((_, slot) => exact[slot] < MIN_COL_WIDTH);
        if (clamped.length > 0) {
            const fixed = new Set(clamped);
            for (const index of clamped) scaled[index] = MIN_COL_WIDTH;
            remaining -= clamped.length * MIN_COL_WIDTH;
            pool = pool.filter((index) => !fixed.has(index));
            continue;
        }

        const floors = exact.map((width) => Math.floor(width));
        floors.forEach((width, slot) => {
            scaled[pool[slot]] = width;
        });
        let leftover = remaining - floors.reduce((sum, width) => sum + width, 0);
        const order = exact
            .map((width, slot) => ({ index: pool[slot], fraction: width - Math.floor(width) }))
            .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
        for (const { index } of order) {
            if (leftover <= 0) break;
            scaled[index] += 1;
            leftover -= 1;
        }
        break;
    }
    return scaled;
}

export function tableAvailableWidth(root: HTMLElement): number | null {
    const host = root.querySelector('.q-md-table-table-host') as HTMLElement | null;
    const hostWidth = host && (measuredSize(host.clientWidth) ?? measuredSize(host.getBoundingClientRect().width));
    if (hostWidth != null) return Math.floor(hostWidth);

    const scroll = root.querySelector('.q-md-table-scroll') as HTMLElement | null;
    if (!scroll) return null;
    const outer = measuredSize(scroll.clientWidth) ?? measuredSize(scroll.getBoundingClientRect().width);
    if (outer == null) return null;
    const corner = root.querySelector('.q-md-table-corner') as HTMLElement | null;
    const layout = root.querySelector('.q-md-table-layout') as HTMLElement | null;
    const cornerWidth = (corner && measuredSize(corner.getBoundingClientRect().width)) ?? 0;
    const gap = layout ? Number.parseFloat(getComputedStyle(layout).columnGap) : 0;
    const room = Math.floor(outer - cornerWidth - gap);
    return room > 0 ? room : null;
}

export function displayedColWidths(root: HTMLElement, model: TableModel): number[] {
    if (model.colSizing !== 'explicit') return model.colWidths.slice();
    return scaleColWidths(model.colWidths, tableAvailableWidth(root));
}

export function measureColWidths(root: HTMLElement, model: TableModel): number[] {
    const measured = new Array<number | null>(columnCount(model)).fill(null);
    const cells = root.querySelectorAll<HTMLTableCellElement>('.q-md-table-editor tbody .q-md-table-cell');
    for (const cell of cells) {
        if (cell.colSpan !== 1) continue;
        const col = Number(cell.dataset.col);
        if (!Number.isInteger(col) || col < 0 || col >= measured.length) continue;
        if (measured[col] != null) continue;
        measured[col] = measuredSize(cell.getBoundingClientRect().width);
    }
    return model.colWidths.map((requested, col) => measured[col] ?? requested);
}

export function measureRowHeights(root: HTMLElement, model: TableModel): number[] {
    const rows = [...root.querySelectorAll<HTMLTableRowElement>('.q-md-table-editor tbody > tr')];
    return model.rowHeights.map(
        (requested, row) => {
            const rect = rows[row]?.getBoundingClientRect();
            return (rect && measuredSize(rect.height)) ?? requested;
        },
    );
}

export function syncStripSizes(root: HTMLElement, model: TableModel): void {
    const widths = model.colSizing === 'explicit'
        ? displayedColWidths(root, model)
        : measureColWidths(root, model);
    const heights = measureRowHeights(root, model);

    for (const button of root.querySelectorAll<HTMLElement>('.q-md-table-col-strip-btn')) {
        const width = widths[Number(button.dataset.col)];
        if (width != null) button.style.width = `${width}px`;
    }
    for (const button of root.querySelectorAll<HTMLElement>('.q-md-table-row-strip-btn')) {
        const height = heights[Number(button.dataset.row)];
        if (height != null) button.style.height = `${height}px`;
    }
}
