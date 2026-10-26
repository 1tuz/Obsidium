import { describe, expect, it } from 'vitest';
import { ICON_IDS } from './iconCatalog';
import type { IconId } from './iconCatalog';
import { LUCIDE_ICONS } from './lucideIconCatalog';
import { TABLER_ICONS } from './tablerIcons';
import { PHOSPHOR_ICONS } from './phosphorIcons';

const CATALOGS = {
  lucide: LUCIDE_ICONS,
  tabler: TABLER_ICONS,
  phosphor: PHOSPHOR_ICONS,
} as const;

type SetName = keyof typeof CATALOGS;

const SET_NAMES = Object.keys(CATALOGS) as SetName[];

const ALLOWED_SHARED_MARKUP: ReadonlyArray<readonly [IconId, IconId]> = [];

const markup = (setName: SetName, id: IconId): string => {
  const glyph = CATALOGS[setName][id];
  return typeof glyph === 'string' ? glyph : JSON.stringify(glyph);
};

const expectDistinctPair = (left: IconId, right: IconId) => {
  for (const setName of SET_NAMES) {
    expect(markup(setName, left), `${setName}: '${left}' must not reuse the '${right}' glyph`)
      .not.toBe(markup(setName, right));
  }
};

describe('icon catalog', () => {
  it('maps every semantic id to a glyph in all three sets', () => {
    for (const setName of SET_NAMES) {
      expect(Object.keys(CATALOGS[setName]).sort(), setName).toEqual([...ICON_IDS].sort());
    }
  });

  it('exposes the ids other slices depend on', () => {
    expect(ICON_IDS).toEqual(expect.arrayContaining([
      'analytics', 'file-plus', 'folder-plus', 'split-horizontal', 'split-vertical',
      'canvas', 'calendar', 'kanban', 'files', 'graph', 'history', 'settings',
      'house', 'link2', 'search', 'timeline', 'x',
    ]));
  });

  it('keeps one glyph per meaning inside every set', () => {
    for (const setName of SET_NAMES) {
      const owners = new Map<string, IconId>();
      for (const id of ICON_IDS) {
        const glyph = markup(setName, id);
        const owner = owners.get(glyph);
        if (!owner) {
          owners.set(glyph, id);
          continue;
        }
        const allowed = ALLOWED_SHARED_MARKUP.some(([left, right]) =>
          (left === owner && right === id) || (left === id && right === owner));
        expect(allowed, `${setName}: '${owner}' and '${id}' render the same glyph`).toBe(true);
      }
    }
  });

  it('separates creating a note from the canvas section', () => {
    expectDistinctPair('canvas', 'file-plus');
    expectDistinctPair('file-plus', 'file');
    expectDistinctPair('folder-plus', 'folder');
  });

  it('separates analytics from the timeline view', () => {
    expectDistinctPair('analytics', 'timeline');
    expectDistinctPair('analytics', 'graph');
  });

  it('separates the left panel from the right panel family', () => {
    expectDistinctPair('panel-left', 'panel-right');
    expectDistinctPair('panel-right', 'panel-right-close');
    expectDistinctPair('panel-right', 'panel-right-open');
    expectDistinctPair('panel-right-close', 'panel-right-open');
  });

  it('separates splitting a panel sideways from splitting it downwards', () => {
    expectDistinctPair('split-horizontal', 'split-vertical');
    expectDistinctPair('split-horizontal', 'kanban');
  });

  it('separates the three code flavours', () => {
    expectDistinctPair('code', 'code2');
    expectDistinctPair('code', 'code-xml');
    expectDistinctPair('code2', 'code-xml');
  });

  it('separates the table cell operations from the table itself', () => {
    expectDistinctPair('table', 'table-cells-merge');
    expectDistinctPair('table', 'table-cells-split');
    expectDistinctPair('table-cells-merge', 'table-cells-split');
  });

  it('separates the remaining formerly shared glyphs', () => {
    expectDistinctPair('indent-decrease', 'indent-increase');
    expectDistinctPair('tag', 'tags');
    expectDistinctPair('text-select', 'type');
    expectDistinctPair('template', 'file');
  });
});
