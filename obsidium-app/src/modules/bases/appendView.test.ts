import { describe, expect, it } from 'vitest';
import { appendBaseView, parseBase } from './baseFormat';

describe('appendBaseView', () => {
  it('adds a view to the existing list and keeps the other views readable', () => {
    const source = [
      'filters: "file.hasTag(\\"board\\")"',
      'views:',
      '  - type: kanban',
      '    name: "Доска"',
      '    groupBy:',
      '      property: "status"',
      'pluginField:',
      '  keep: true',
      '',
    ].join('\n');

    const updated = appendBaseView(source, { type: 'calendar', name: 'Календарь', dateField: 'date' });
    const parsed = parseBase(updated);

    expect(parsed.views.map((view) => view.type)).toEqual(['kanban', 'calendar']);
    expect(parsed.views[1].name).toBe('Календарь');
    expect(parsed.views[1].dateField).toBe('date');
    expect(parsed.unsupportedKeys).toContain('pluginField');
    expect(updated).toContain('pluginField:');
  });

  it('creates the views block when the file has none', () => {
    const updated = appendBaseView('filters:\n  and: []\n', { type: 'table', name: 'Таблица' });

    expect(parseBase(updated).views[0].type).toBe('table');
    expect(parseBase(updated).views[0].name).toBe('Таблица');
  });

  it('keeps the line endings of the original file', () => {
    const updated = appendBaseView('views:\r\n  - type: table\r\n    name: A\r\n', {
      type: 'calendar',
      name: 'B',
    });

    expect(updated).toContain('\r\n');
    expect(updated.split('\n').some((line) => line.endsWith('\r'))).toBe(true);
    expect(parseBase(updated).views).toHaveLength(2);
  });
});
