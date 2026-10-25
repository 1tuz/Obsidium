// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import type { BaseDefinition, BaseEvaluation } from '../../../../modules/bases';
import { livePreviewConfigFacet } from '../livePreviewConfig';
import { editorMarkdownExtensions } from '../markdownConfig';
import { findBaseFences, parseBaseFenceBody } from './constructs';
import { collectBaseFenceDecorations } from './decorations';
import { renderBaseFenceDom } from './dom';
import { resolveBaseFencePath, resolveBaseFenceViewIndex } from './run';
import {
  baseFenceCacheNoteKey,
  baseFenceKey,
  baseFenceRevision,
  bumpBaseFenceRevision,
  cachedBaseFenceResult,
  forgetBaseFencesOutside,
  rememberBaseFenceResult,
  type BaseFenceResult,
} from './store';

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions }),
    ],
  });
}

const NOTE = [
  '# Заметка',
  '',
  '```base',
  'Projects/Roadmap.base План',
  '```',
  '',
  'хвост',
].join('\n');

function definition(names: string[]): BaseDefinition {
  return {
    raw: '',
    views: names.map((name) => ({ type: 'table', name, order: [] })),
    summaries: [],
    propertyLabels: {},
    relationProperties: [],
    formulas: {},
    unsupportedKeys: [],
    extra: {},
  };
}

function evaluation(rows: string[]): BaseEvaluation {
  return {
    rows: rows.map((path) => ({ path, fields: {} })),
    groups: [{ label: null, start: 0, end: rows.length }],
    columns: ['file.name'],
    unsupported: false,
    errors: [],
  };
}

function ready(rows: string[]): BaseFenceResult {
  return {
    status: 'ready',
    definition: definition(['План']),
    evaluation: evaluation(rows),
    viewIndex: 0,
  };
}

describe('parseBaseFenceBody', () => {
  it('reads the base path and the view name from the first line', () => {
    expect(parseBaseFenceBody('Projects/Roadmap.base План\n')).toEqual({
      path: 'Projects/Roadmap.base',
      view: 'План',
    });
  });

  it('treats a missing view as the first view', () => {
    expect(parseBaseFenceBody('Projects/Roadmap.base')).toEqual({
      path: 'Projects/Roadmap.base',
      view: null,
    });
  });

  it('supports quoted paths with spaces', () => {
    expect(parseBaseFenceBody('"Work/Road map.base" План')).toEqual({
      path: 'Work/Road map.base',
      view: 'План',
    });
  });

  it('ignores a blank body', () => {
    expect(parseBaseFenceBody('')).toBeNull();
    expect(parseBaseFenceBody('\n   \n\t')).toBeNull();
  });

  it('rejects a path that is not a .base file', () => {
    expect(parseBaseFenceBody('Projects/Roadmap.md План')).toBeNull();
    expect(parseBaseFenceBody('Projects/Roadmap')).toBeNull();
  });
});

describe('findBaseFences', () => {
  it('finds the fence and covers it completely', () => {
    const found = findBaseFences(stateOf(NOTE));
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe('Projects/Roadmap.base');
    expect(found[0]!.view).toBe('План');
    expect(found[0]!.from).toBe(NOTE.indexOf('```base'));
    expect(found[0]!.to).toBe(NOTE.lastIndexOf('```') + 3);
  });

  it('ignores fences of other languages', () => {
    expect(findBaseFences(stateOf('```js\nconst a = 1;\n```'))).toHaveLength(0);
    expect(findBaseFences(stateOf('```dataview\nLIST\n```'))).toHaveLength(0);
  });

  it('ignores an empty base fence', () => {
    expect(findBaseFences(stateOf('```base\n```'))).toHaveLength(0);
  });

  it('ignores a fence whose path is not a .base file', () => {
    expect(findBaseFences(stateOf('```base\nNotes/Plan.md\n```'))).toHaveLength(0);
  });
});

describe('resolveBaseFencePath', () => {
  const workspace = '/vault';

  it('resolves a path relative to the vault root', () => {
    expect(resolveBaseFencePath(workspace, 'Projects/Roadmap.base')).toBe('/vault/Projects/Roadmap.base');
  });

  it('resolves an absolute path inside the vault', () => {
    expect(resolveBaseFencePath(workspace, '/Projects/Roadmap.base')).toBe('/vault/Projects/Roadmap.base');
    expect(resolveBaseFencePath(workspace, '/vault/Projects/Roadmap.base'))
      .toBe('/vault/Projects/Roadmap.base');
  });

  it('rejects escaping the vault and non-base paths', () => {
    expect(resolveBaseFencePath(workspace, '../Roadmap.base')).toBeNull();
    expect(resolveBaseFencePath(workspace, 'Projects/Roadmap.md')).toBeNull();
  });
});

describe('resolveBaseFenceViewIndex', () => {
  const views = definition(['План', 'Risks']);

  it('defaults to the first view', () => {
    expect(resolveBaseFenceViewIndex(views, null)).toBe(0);
  });

  it('matches a view name case-insensitively', () => {
    expect(resolveBaseFenceViewIndex(views, 'risks')).toBe(1);
  });

  it('returns null for an unknown view or an empty base', () => {
    expect(resolveBaseFenceViewIndex(views, 'Missing')).toBeNull();
    expect(resolveBaseFenceViewIndex(definition([]), null)).toBeNull();
  });
});

describe('baseFence store', () => {
  const workspace = '/vault';
  const note = baseFenceCacheNoteKey(workspace, '/vault/Note.md');
  const key = baseFenceKey('/vault/Projects/Roadmap.base', 'План');

  it('separates caches of different notes', () => {
    const other = baseFenceCacheNoteKey(workspace, '/vault/Other.md');
    rememberBaseFenceResult(note, key, baseFenceRevision(workspace), ready(['/vault/A.md']));
    expect(cachedBaseFenceResult(other, key, baseFenceRevision(workspace))).toBeUndefined();
  });

  it('drops a cached result when the index revision moves on', () => {
    const revision = bumpBaseFenceRevision(workspace);
    rememberBaseFenceResult(note, key, revision, ready(['/vault/A.md']));
    expect(cachedBaseFenceResult(note, key, revision)).toBeDefined();

    const next = bumpBaseFenceRevision(workspace);
    expect(cachedBaseFenceResult(note, key, next)).toBeUndefined();

    rememberBaseFenceResult(note, key, next, ready(['/vault/A.md', '/vault/B.md']));
    expect(cachedBaseFenceResult(note, key, next)).toBeDefined();
  });

  it('reports a change when the stored result differs', () => {
    const revision = bumpBaseFenceRevision(workspace);
    expect(rememberBaseFenceResult(note, key, revision, ready(['/vault/A.md']))).toBe(true);
    expect(rememberBaseFenceResult(note, key, revision, ready(['/vault/A.md']))).toBe(false);
    expect(rememberBaseFenceResult(note, key, revision, ready(['/vault/B.md']))).toBe(true);
  });

  it('forgets fences that are no longer in the note', () => {
    const revision = baseFenceRevision(workspace);
    const otherKey = baseFenceKey('/vault/Projects/Other.base', null);
    rememberBaseFenceResult(note, key, revision, ready([]));
    rememberBaseFenceResult(note, otherKey, revision, ready([]));

    forgetBaseFencesOutside(note, new Set([key]));

    expect(cachedBaseFenceResult(note, key, revision)).toBeDefined();
    expect(cachedBaseFenceResult(note, otherKey, revision)).toBeUndefined();
  });
});

describe('collectBaseFenceDecorations', () => {
  const config = {
    resolveWikiLinks: async (targets: string[]) => ({ paths: targets.map(() => null), complete: true }),
    workspacePath: '/vault',
    notePath: () => '/vault/Note.md',
    onOpenWikiLink: () => undefined,
    onOpenExternalUrl: () => undefined,
    onReadBook: () => undefined,
  };

  function stateWithConfig(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions }),
        livePreviewConfigFacet.of(config),
      ],
    });
  }

  it('replaces a base fence with a widget and skips non-base paths', () => {
    const ranges = collectBaseFenceDecorations(stateWithConfig(NOTE), config);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(NOTE.indexOf('```base'));
    expect(collectBaseFenceDecorations(stateWithConfig('```base\nNotes/Plan.md\n```'), config))
      .toHaveLength(0);
  });

  it('does nothing without a workspace', () => {
    const ranges = collectBaseFenceDecorations(
      stateWithConfig(NOTE),
      { ...config, workspacePath: null },
    );
    expect(ranges).toHaveLength(0);
  });
});

describe('renderBaseFenceDom', () => {
  it('renders a table for a ready result', () => {
    const dom = renderBaseFenceDom(ready(['/vault/A.md']), '/vault/Projects/Roadmap.base', '/vault');
    expect(dom.querySelector('.q-base-table')).not.toBeNull();
    expect(dom.querySelectorAll('.q-base-table tbody tr')).toHaveLength(1);
  });

  it('renders a message row for a failure instead of throwing', () => {
    const dom = renderBaseFenceDom(
      { status: 'failed', message: 'нет файла' },
      '/vault/Projects/Roadmap.base',
      '/vault',
    );
    expect(dom.textContent).toContain('нет файла');
    expect(dom.querySelector('.q-base-table')).toBeNull();
  });

  it('renders a pending row without a cached result', () => {
    const dom = renderBaseFenceDom(undefined, '/vault/Projects/Roadmap.base', '/vault');
    expect(dom.textContent).not.toBe('');
    expect(dom.querySelector('.q-base-table')).toBeNull();
  });
});
