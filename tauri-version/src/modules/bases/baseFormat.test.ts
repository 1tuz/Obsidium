import { describe, expect, it } from 'vitest';
import { parseBase, renameFirstKanbanView, serializeBase } from './baseFormat';

describe('parseBase', () => {
  it('reads Obsidian-style filters, grouping and view order while preserving source', () => {
    const source = [
      'filters:',
      '  and:',
      '    - \'status != "done"\'',
      '    - or:',
      '        - \'file.hasTag("project")\'',
      '        - \'priority == "high"\'',
      'properties:',
      '  status:',
      '    displayName: Status',
      'views:',
      '  - type: table',
      '    name: Active',
      '    groupBy:',
      '      property: status',
      '      direction: ASC',
      '    order:',
      '      - file.name',
      '      - status',
      '',
    ].join('\n');

    const base = parseBase(source);
    expect(base.views[0].name).toBe('Active');
    expect(base.views[0].order).toEqual(['file.name', 'status']);
    expect(base.views[0].groupBy?.property).toBe('status');
    expect(base.propertyLabels.status).toBe('Status');
    expect(serializeBase(base)).toBe(source);
  });

  it('retains unsupported top-level keys instead of rewriting the file', () => {
    const source = 'pluginField:\n  magic: true\nviews:\n  - type: cards\n';
    const base = parseBase(source);
    expect(base.unsupportedKeys).toContain('pluginField');
    expect(serializeBase(base)).toBe(source);
  });
});

describe('renameFirstKanbanView', () => {
  it('renames the first Kanban tab while preserving other views and source formatting', () => {
    const source = 'views:\r\n  - type: kanban\r\n    name: Open # primary\r\n  - type: kanban\r\n    name: Review\r\n';

    expect(renameFirstKanbanView(source, 'Roadmap')).toBe(
      'views:\r\n  - type: kanban\r\n    name: "Roadmap" # primary\r\n  - type: kanban\r\n    name: Review\r\n',
    );
  });

  it('leaves Bases without a Kanban view unchanged', () => {
    const source = 'views:\n  - type: table\n    name: Active\n';

    expect(renameFirstKanbanView(source, 'Roadmap')).toBe(source);
  });

  it('adds a name to an unnamed first Kanban view without renaming other views', () => {
    const source = 'views:\n  - type: kanban\n    groupBy:\n      property: status\n  - type: kanban\n    name: Review\n';

    expect(renameFirstKanbanView(source, 'Roadmap')).toBe(
      'views:\n  - type: kanban\n    name: "Roadmap"\n    groupBy:\n      property: status\n  - type: kanban\n    name: Review\n',
    );
  });
});
