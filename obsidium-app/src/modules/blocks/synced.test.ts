import { describe, expect, it } from 'vitest';
import {
  newSyncedId,
  parseSyncRegions,
  removeSyncRegion,
  replaceSyncRegion,
  syncRegion,
  syncedRegionText,
  wrapInSyncRegion,
} from './synced';

describe('parseSyncRegions', () => {
  it('parses regions with exact offsets and content', () => {
    const source = [
      '# Title',
      '',
      '<!-- obsidium-sync:abc -->',
      'first line',
      '- item one',
      '  - nested item',
      '<!-- /obsidium-sync -->',
      '',
      'after',
    ].join('\n');
    const regions = parseSyncRegions(source);
    expect(regions).toHaveLength(1);
    const region = regions[0]!;
    expect(region.id).toBe('abc');
    expect(region.content).toBe('first line\n- item one\n  - nested item');
    expect(source.slice(region.from, region.to)).toBe(
      '<!-- obsidium-sync:abc -->\nfirst line\n- item one\n  - nested item\n<!-- /obsidium-sync -->',
    );
  });

  it('allows up to three leading spaces on markers', () => {
    const source = '   <!-- obsidium-sync:x -->\ncontent\n   <!-- /obsidium-sync -->';
    expect(parseSyncRegions(source)).toHaveLength(1);
  });

  it('rejects markers with text on the same line or wrong case', () => {
    const source = [
      'text <!-- obsidium-sync:a -->',
      '<!-- OBSIDIUM-SYNC:b -->',
      '<!-- obsidium-sync:c --> text',
      '<!--/obsidium-sync-->',
    ].join('\n');
    expect(parseSyncRegions(source)).toHaveLength(0);
  });

  it('returns both regions with duplicate ids', () => {
    const source = [
      '<!-- obsidium-sync:dup -->',
      'one',
      '<!-- /obsidium-sync -->',
      '<!-- obsidium-sync:dup -->',
      'two',
      '<!-- /obsidium-sync -->',
    ].join('\n');
    expect(parseSyncRegions(source)).toHaveLength(2);
  });

  it('ignores an unterminated region', () => {
    const source = '<!-- obsidium-sync:open -->\nnever closed';
    expect(parseSyncRegions(source)).toHaveLength(0);
  });
});

describe('syncRegion', () => {
  it('finds a single region by id', () => {
    const source = '<!-- obsidium-sync:one -->\nA\n<!-- /obsidium-sync -->';
    expect(syncRegion(source, 'one')?.content).toBe('A');
  });

  it('returns null for duplicate ids and missing ids', () => {
    const source = [
      '<!-- obsidium-sync:dup -->',
      'A',
      '<!-- /obsidium-sync -->',
      '<!-- obsidium-sync:dup -->',
      'B',
      '<!-- /obsidium-sync -->',
    ].join('\n');
    expect(syncRegion(source, 'dup')).toBeNull();
    expect(syncRegion(source, 'missing')).toBeNull();
  });
});

describe('replaceSyncRegion round-trip', () => {
  it('replaces content preserving surrounding blank lines', () => {
    const source = [
      'intro',
      '',
      '<!-- obsidium-sync:abc -->',
      'old',
      '<!-- /obsidium-sync -->',
      '',
      'outro',
    ].join('\n');
    const next = replaceSyncRegion(source, 'abc', 'new\ncontent');
    expect(next).toBe([
      'intro',
      '',
      '<!-- obsidium-sync:abc -->',
      'new',
      'content',
      '<!-- /obsidium-sync -->',
      '',
      'outro',
    ].join('\n'));
    expect(syncRegion(next!, 'abc')?.content).toBe('new\ncontent');
  });

  it('preserves nested list and multi-block content verbatim', () => {
    const content = [
      '- one',
      '  - two',
      '    - [ ] task',
      '',
      '> quote',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');
    const source = `before\n\n${syncedRegionText('nested', content)}\nafter`;
    const next = replaceSyncRegion(source, 'nested', content)!;
    expect(next).toBe(source);
    expect(syncRegion(next, 'nested')?.content).toBe(content);
  });

  it('returns null for duplicate ids or missing regions', () => {
    const source = [
      '<!-- obsidium-sync:dup -->',
      'A',
      '<!-- /obsidium-sync -->',
      '<!-- obsidium-sync:dup -->',
      'B',
      '<!-- /obsidium-sync -->',
    ].join('\n');
    expect(replaceSyncRegion(source, 'dup', 'x')).toBeNull();
    expect(replaceSyncRegion(source, 'missing', 'x')).toBeNull();
  });
});

describe('removeSyncRegion', () => {
  it('removes the markers and keeps the content', () => {
    const source = [
      'intro',
      '',
      '<!-- obsidium-sync:abc -->',
      'keep me',
      '<!-- /obsidium-sync -->',
      '',
      'outro',
    ].join('\n');
    expect(removeSyncRegion(source, 'abc')).toBe('intro\n\nkeep me\n\noutro');
  });

  it('returns null for duplicate or missing ids', () => {
    expect(removeSyncRegion('plain text', 'gone')).toBeNull();
  });
});

describe('wrapInSyncRegion', () => {
  it('wraps the selection keeping the trailing newline outside', () => {
    const source = 'before\n\nselected\n\nafter';
    const change = wrapInSyncRegion(source, [{ from: 8, to: 16 }], 'abc');
    expect(change).toEqual({
      from: 8,
      to: 16,
      insert: '<!-- obsidium-sync:abc -->\nselected\n<!-- /obsidium-sync -->',
    });
    const next = source.slice(0, 8) + change!.insert + source.slice(16);
    expect(syncRegion(next, 'abc')?.content).toBe('selected');
  });

  it('returns null for empty content', () => {
    expect(wrapInSyncRegion('   \n  ', [{ from: 0, to: 5 }], 'x')).toBeNull();
    expect(wrapInSyncRegion('a', [], 'x')).toBeNull();
  });
});

describe('newSyncedId', () => {
  it('produces unique ids in the allowed charset', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const id = newSyncedId();
      expect(id).toMatch(/^sync-[a-z0-9]+-[a-z0-9]+$/);
      seen.add(id);
    }
    expect(seen.size).toBe(200);
  });
});

describe('syncedRegionText', () => {
  it('trims trailing newlines from content', () => {
    expect(syncedRegionText('abc', 'line\n\n')).toBe('<!-- obsidium-sync:abc -->\nline\n<!-- /obsidium-sync -->');
  });
});
