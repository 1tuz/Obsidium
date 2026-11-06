import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const base = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');

const componentSheets = [
    'src/components/Stats/ActivityHeatmap.css',
    'src/components/Stats/RecentChangesPanel.css',
    'src/components/Editor/EditingToolbar.css',
];

describe('scrollbar theme', () => {
    it('paints global scrollbars with theme tokens', () => {
        expect(base).toMatch(/scrollbar-color:\s*var\(--q-scrollbar-thumb\)\s*var\(--q-scrollbar-track\)/u);
        expect(base).toMatch(/scrollbar-width:\s*thin/u);
    });

    it('keeps the global rule the single source of truth', () => {
        for (const sheet of componentSheets) {
            const css = readFileSync(resolve(process.cwd(), sheet), 'utf8');
            expect(css, `${sheet} must not override scrollbar-width`).not.toContain('scrollbar-width: thin');
        }
    });
});
