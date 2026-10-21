import { describe, expect, it } from 'vitest';
import { MIN_COL_WIDTH } from './model';
import { scaleColWidths } from './geometry';

describe('scaleColWidths', () => {
    it('stretches stored widths proportionally to fill a wider container', () => {
        expect(scaleColWidths([60, 60, 60, 60], 900)).toEqual([225, 225, 225, 225]);
    });

    it('shrinks stored widths proportionally inside a narrower container', () => {
        expect(scaleColWidths([400, 400], 300)).toEqual([150, 150]);
    });

    it('falls back to the stored widths when the container is unknown', () => {
        expect(scaleColWidths([400, 400], null)).toEqual([400, 400]);
        expect(scaleColWidths([400, 400], undefined)).toEqual([400, 400]);
        expect(scaleColWidths([400, 400], 0)).toEqual([400, 400]);
    });

    it('never drops a column below the minimum width', () => {
        const scaled = scaleColWidths([60, 600], 300);
        expect(scaled[0]).toBe(MIN_COL_WIDTH);
        expect(scaled.reduce((sum, width) => sum + width, 0)).toBe(300);

        const cramped = scaleColWidths([400, 400], 20);
        expect(cramped).toEqual([MIN_COL_WIDTH, MIN_COL_WIDTH]);
    });

    it('keeps the available width exact after rounding', () => {
        const scaled = scaleColWidths([100, 100, 100], 1000);
        expect(scaled.reduce((sum, width) => sum + width, 0)).toBe(1000);
    });
});
