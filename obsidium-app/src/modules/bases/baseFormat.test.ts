import { describe, expect, it } from 'vitest';
import { parseBase, serializeBase, setRelationProperties } from './baseFormat';
import type { BaseDefinition } from './types';

function model(definition: BaseDefinition) {
  return {
    filters: definition.filters,
    views: definition.views,
    propertyLabels: definition.propertyLabels,
    relationProperties: definition.relationProperties,
    unsupportedKeys: definition.unsupportedKeys,
    extra: definition.extra,
  };
}

function expectRoundTrip(source: string): BaseDefinition {
  const parsed = parseBase(source);
  const serialized = serializeBase(parsed);
  expect(model(parseBase(serialized))).toEqual(model(parsed));
  expect(serializeBase(parseBase(serialized))).toBe(serialized);
  return parsed;
}

describe('parseBase', () => {
  it('reads a simple table view', () => {
    const parsed = expectRoundTrip('views:\n  - type: table\n    name: Table\n');

    expect(parsed.views).toHaveLength(1);
    expect(parsed.views[0]).toEqual({
      type: 'table',
      name: 'Table',
      order: [],
      limit: undefined,
      dateField: undefined,
      filters: undefined,
      groupBy: undefined,
      groupOrder: undefined,
      sort: undefined,
    });
    expect(serializeBase(parsed)).toBe('views:\n  - type: table\n    name: Table\n');
  });

  it('keeps limit, dateField, order, sort and groupBy of several views', () => {
    const source = [
      'views:',
      '  - type: table',
      '    name: "Все заметки"',
      '    limit: 25',
      '    order: [file.name, status]',
      '    sort:',
      '      - property: file.mtime',
      '        direction: DESC',
      '      - property: status',
      '    groupBy:',
      '      property: status',
      '      direction: DESC',
      '  - type: calendar',
      '    name: Календарь',
      '    dateField: date',
      '    groupOrder: [null, true, 3, "нет"]',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.views).toHaveLength(2);
    expect(parsed.views[0].limit).toBe(25);
    expect(parsed.views[0].order).toEqual(['file.name', 'status']);
    expect(parsed.views[0].sort).toEqual([
      { property: 'file.mtime', direction: 'DESC' },
      { property: 'status', direction: 'ASC' },
    ]);
    expect(parsed.views[0].groupBy).toEqual({ property: 'status', direction: 'DESC' });
    expect(parsed.views[1].dateField).toBe('date');
    expect(parsed.views[1].groupOrder).toEqual([null, true, 3, 'нет']);
  });

  it('round-trips per-column card order and WIP limits', () => {
    const parsed = expectRoundTrip([
      'views:',
      '  - type: kanban',
      '    name: Board',
      '    groupBy:',
      '      property: status',
      '    groupOrder: [todo, doing]',
      '    cardOrder:',
      '      todo: [Alpha.md, "Sub/Beta.md"]',
      '      "": [Loose.md]',
      '      doing: []',
      '    wipLimits:',
      '      doing: 3',
      '',
    ].join('\n'));

    expect(parsed.views[0].cardOrder).toEqual({
      todo: ['Alpha.md', 'Sub/Beta.md'],
      '': ['Loose.md'],
    });
    expect(parsed.views[0].wipLimits).toEqual({ doing: 3 });
    expect(serializeBase(parsed)).toContain('todo: [Alpha.md, Sub/Beta.md]');
    expect(serializeBase(parsed)).toContain('doing: 3');
  });

  it('keeps the timeline start and end properties as view fields', () => {
    const parsed = expectRoundTrip([
      'views:',
      '  - type: timeline',
      '    name: План',
      '    startField: begin',
      '    endField: finish',
      '',
    ].join('\n'));

    expect(parsed.views[0].startField).toBe('begin');
    expect(parsed.views[0].endField).toBe('finish');
    expect(parsed.views[0].extra).toBeUndefined();
  });

  it('reads nested and/or/not filters at the document and view level', () => {
    const source = [
      'filters:',
      '  and:',
      '    - \'status != "done"\'',
      '    - or:',
      '        - \'file.hasTag("project")\'',
      '        - not: \'priority == "low"\'',
      '    - not:',
      '        - \'archived == true\'',
      '        - \'draft == false\'',
      'views:',
      '  - type: table',
      '    name: Filtered',
      '    filters:',
      '      not: \'file.inFolder("archive")\'',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.filters).toEqual({
      and: [
        'status != "done"',
        { or: ['file.hasTag("project")', { not: 'priority == "low"' }] },
        { not: ['archived == true', 'draft == false'] },
      ],
    });
    expect(parsed.views[0].filters).toEqual({ not: 'file.inFolder("archive")' });
  });

  it('preserves unknown top-level and view keys', () => {
    const source = [
      'pluginField:',
      '  magic: true',
      'flag: on',
      'tags: [alpha, beta]',
      'views:',
      '  - type: cards',
      '    name: Cards',
      '    cardSize: 120',
      '    cover: "[[cover.png]]"',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.unsupportedKeys).toEqual(['flag', 'pluginField', 'tags']);
    expect(parsed.extra).toEqual({
      pluginField: { magic: true },
      flag: 'on',
      tags: ['alpha', 'beta'],
    });
    expect(parsed.views[0].extra).toEqual({ cardSize: 120, cover: '[[cover.png]]' });
  });

  it('keeps formulas, summaries and property fields other than displayName', () => {
    const source = [
      'properties:',
      '  status:',
      '    displayName: Статус',
      '    type: text',
      '    options: [todo, done]',
      'formulas:',
      '  total: "a + b"',
      'summaries:',
      '  count: values.length',
      'views:',
      '  - type: table',
      '    name: Table',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.propertyLabels).toEqual({ status: 'Статус' });
    expect(parsed.extra.formulas).toEqual({ total: 'a + b' });
    expect(parsed.extra.summaries).toEqual({ count: 'values.length' });
    expect(parsed.extra.properties).toEqual({
      status: { displayName: 'Статус', type: 'text', options: ['todo', 'done'] },
    });
  });

  it('quotes Cyrillic, punctuation, boolean-like and numeric scalars when needed', () => {
    const source = [
      'properties:',
      '  status:',
      '    displayName: "Статус: черновик, #1"',
      '  flag:',
      '    displayName: "true"',
      '  rank:',
      '    displayName: "42"',
      'views:',
      '  - type: table',
      '    name: "It\'s: a, #tag"',
      '    groupOrder: [null, true, false, 42, 3.5, "Статус: черновик, #1"]',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.propertyLabels).toEqual({
      status: 'Статус: черновик, #1',
      flag: 'true',
      rank: '42',
    });
    expect(parsed.views[0].name).toBe("It's: a, #tag");
    expect(parsed.views[0].groupOrder).toEqual([null, true, false, 42, 3.5, 'Статус: черновик, #1']);
  });

  it('round-trips a full definition and stays idempotent', () => {
    const source = [
      'filters:',
      '  and:',
      '    - \'status != "done"\'',
      '    - not: \'archived == true\'',
      'properties:',
      '  status:',
      '    displayName: Статус',
      '    type: text',
      'formulas:',
      '  total: "a + b"',
      'summaries:',
      '  count: values.length',
      'views:',
      '  - type: table',
      '    name: "Таблица: всё"',
      '    limit: 10',
      '    order: [file.name, status]',
      '    groupBy:',
      '      property: status',
      '    groupOrder: [null, "нет"]',
      '  - type: calendar',
      '    name: Календарь',
      '    dateField: date',
      'customKey:',
      '  nested: [1, 2]',
      '',
    ].join('\n');

    const parsed = parseBase(source);
    const serialized = serializeBase(parsed);
    const reparsed = parseBase(serialized);

    expect(model(reparsed)).toEqual(model(parsed));
    expect(serializeBase(reparsed)).toBe(serialized);
    expect(serialized.endsWith('\n')).toBe(true);
  });

  it('serializes the same definition identically on every call', () => {
    const parsed = parseBase([
      'properties:',
      '  b:',
      '    displayName: Bee',
      '  a:',
      '    displayName: Ay',
      'zzz: 1',
      'aaa: 2',
      'views:',
      '  - type: table',
      '    name: Table',
      '',
    ].join('\n'));

    expect(serializeBase(parsed)).toBe(serializeBase(parsed));
  });

  it('reads exponent numbers and empty flow maps', () => {
    const parsed = expectRoundTrip([
      'weird: {}',
      'views:',
      '  - type: table',
      '    name: Table',
      '    limit: 1e2',
      '',
    ].join('\n'));

    expect(parsed.extra.weird).toEqual({});
    expect(parsed.views[0].limit).toBe(100);
    expect(serializeBase(parsed)).toContain('weird: {}');
  });

  it('marks an unknown filter operator unsupported and keeps its raw value', () => {
    const parsed = expectRoundTrip('filters:\n  file.hasLink: Note\nviews:\n  - type: table\n    name: Table\n');

    expect(parsed.filters).toEqual({ unsupported: true, raw: { 'file.hasLink': 'Note' } });
    expect(parseBase(serializeBase(parsed)).filters).toEqual({
      unsupported: true,
      raw: { 'file.hasLink': 'Note' },
    });
  });

  it('reads formula expressions and drops empty ones', () => {
    const source = [
      'formulas:',
      '  risk: \'if(priority == "high", 1, 0)\'',
      '  empty: ""',
      'views:',
      '  - type: table',
      '    order:',
      '      - formula.risk',
      '',
    ].join('\n');

    const base = parseBase(source);

    expect(base.formulas).toEqual({ risk: 'if(priority == "high", 1, 0)' });
    expect(base.unsupportedKeys).not.toContain('formulas');
  });

  it('parses summaries and keeps unknown formulas lowercased', () => {
    const source = [
      'summaries:',
      '  - name: total',
      '    source: file.links',
      '    property: price',
      '    formula: SUM',
      '    filter: \'genre == "sci"\'',
      '  - name: spread',
      '    source: file.links',
      '    formula: MEDIAN',
      '  - name: nameless',
      '    formula: sum',
      '',
    ].join('\n');

    const base = parseBase(source);

    expect(base.summaries).toEqual([
      {
        name: 'total',
        source: 'file.links',
        property: 'price',
        formula: 'sum',
        filter: 'genre == "sci"',
      },
      {
        name: 'spread',
        source: 'file.links',
        property: '',
        formula: 'median',
        filter: undefined,
      },
    ]);
  });

  it('defaults summaries to an empty list when the key is absent or not a sequence', () => {
    expect(parseBase('views:\n  - type: table\n').summaries).toEqual([]);
    expect(parseBase('summaries: nope\n').summaries).toEqual([]);
  });

  it('reads relation properties and keeps their displayName and unknown keys', () => {
    const source = [
      'properties:',
      '  mentor:',
      '    type: relation',
      '    displayName: Наставник',
      '    options: [Ada, Grace]',
      '  status:',
      '    type: text',
      '  reviewer:',
      '    type: "RELATION"',
      'views:',
      '  - type: table',
      '    name: Table',
      '',
    ].join('\n');

    const parsed = expectRoundTrip(source);

    expect(parsed.relationProperties).toEqual(['mentor', 'reviewer']);
    expect(parsed.propertyLabels).toEqual({ mentor: 'Наставник' });
    expect(parsed.extra.properties).toEqual({
      mentor: { type: 'relation', displayName: 'Наставник', options: ['Ada', 'Grace'] },
      status: { type: 'text' },
      reviewer: { type: 'RELATION' },
    });

    const serialized = serializeBase(parsed);
    expect(serialized).toContain('type: relation');
    expect(serialized).toContain('displayName: Наставник');
    expect(serialized).toContain('options: [Ada, Grace]');
    expect(serializeBase(parseBase(serialized))).toBe(serialized);
  });

  it('marks and unmarks a relation property without losing the rest of the entry', () => {
    const parsed = parseBase([
      'properties:',
      '  mentor:',
      '    displayName: Наставник',
      '    options: [Ada]',
      '  status:',
      '    type: text',
      'views:',
      '  - type: table',
      '    name: Table',
      '',
    ].join('\n'));

    setRelationProperties(parsed, ['mentor', 'status']);
    expect(parsed.relationProperties).toEqual(['mentor', 'status']);
    expect(parsed.extra.properties).toEqual({
      mentor: { displayName: 'Наставник', options: ['Ada'], type: 'relation' },
      status: { type: 'relation' },
    });

    setRelationProperties(parsed, []);
    expect(parsed.relationProperties).toEqual([]);
    expect(parsed.extra.properties).toEqual({
      mentor: { displayName: 'Наставник', options: ['Ada'] },
    });
    expect(serializeBase(parsed)).toContain('displayName: Наставник');
    expect(serializeBase(parsed)).not.toContain('status');
  });
});
