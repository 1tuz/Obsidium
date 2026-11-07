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
        expect(base).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--q-scrollbar-track\)/u);
        expect(base).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--q-scrollbar-thumb\)/u);
    });

    it('keeps the standard scrollbar properties off so WebKit honours the themed rules', () => {
        expect(base).not.toContain('scrollbar-color:');
        expect(base).not.toContain('scrollbar-width:');
    });

    it('keeps the global rule the single source of truth', () => {
        for (const sheet of componentSheets) {
            const css = readFileSync(resolve(process.cwd(), sheet), 'utf8');
            expect(css, `${sheet} must not override scrollbar-width`).not.toContain('scrollbar-width: thin');
        }
    });
});
