// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { ICON_IDS, ICON_SETS } from './iconCatalog';
import { Icon } from './Icon';
import { setIconSet } from '../../modules/iconSet';
import { createIconElement } from './iconElement';
import type { IconNode } from 'lucide';
import { Search } from 'lucide';

describe('icon catalog', () => {
  let renderer: MountedDom | null = null;

  afterEach(async () => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    await act(async () => setIconSet('lucide'));
    delete document.documentElement.dataset.iconSet;
  });

  it('provides all three styles for every semantic icon and future section', async () => {
    expect(ICON_SETS).toEqual(['lucide', 'tabler', 'phosphor']);
    expect(ICON_IDS).toEqual(expect.arrayContaining([
      'graph', 'kanban', 'file', 'canvas', 'book', 'search', 'settings', 'calendar',
      'task', 'table', 'database', 'bookmark', 'template', 'history', 'attachment',
      'plugin', 'sync',
    ]));
    const [tabler, phosphor] = await Promise.all([
      import('./tablerIcons').then(({ TABLER_ICONS }) => TABLER_ICONS),
      import('./phosphorIcons').then(({ PHOSPHOR_ICONS }) => PHOSPHOR_ICONS),
    ]);
    expect(Object.keys(tabler)).toEqual([...ICON_IDS]);
    expect(Object.keys(phosphor)).toEqual([...ICON_IDS]);
    const { LEGACY_ICON_IDS, LUCIDE_ICONS } = await import('./lucideIconCatalog');
    expect(Object.keys(LUCIDE_ICONS)).toEqual([...ICON_IDS]);
    const names = new Set<string>();
    for (const file of readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(path.join('src', file), 'utf8');
      for (const block of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide['"]/gs)) {
        for (const raw of block[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0];
          if (name && !name.startsWith('type ') && name !== 'createElement') names.add(name);
        }
      }
    }
    for (const name of names) {
      const icon = await import('lucide').then((library) => library[name as keyof typeof library]);
      expect(LEGACY_ICON_IDS.has(icon as IconNode), name).toBe(true);
    }
  });

  it('renders semantic icons created before the lazy Lucide catalog loads', async () => {
    const svg = createIconElement('search');
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(svg.childElementCount).toBe(2);
  });

  it('renders the selected style immediately with shared size and class', async () => {
    act(() => { renderer = mountDom(<Icon icon="search" size={18} className="probe" />); });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    await act(async () => setIconSet('phosphor'));
    const svg = renderer!.container.querySelector('svg');
    expect(svg?.getAttribute('data-icon-set')).toBe('phosphor');
    expect(svg?.getAttribute('width')).toBe('18');
    expect(svg?.classList.contains('probe')).toBe(true);
    await act(async () => setIconSet('tabler'));
    expect(svg?.getAttribute('data-icon-set')).toBe('tabler');
  });

  it('updates icons created by native editor extensions when the set changes', async () => {
    const button = document.createElement('button');
    const svg = createIconElement(Search);
    button.append(svg);
    document.body.append(button);
    await act(async () => setIconSet('phosphor'));
    expect(svg.dataset.iconSet).toBe('phosphor');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    button.remove();
  });
});
