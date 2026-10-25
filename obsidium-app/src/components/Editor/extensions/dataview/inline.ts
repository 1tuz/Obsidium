import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { t } from '../../../../i18n';
import {
  dataviewErrorMessage,
  evaluateInlineExpressions,
  type DataviewInlineValue,
} from '../../../../modules/docs/dataview';
import { ensureEditorTree, visibleTreeRanges } from '../ensureEditorTree';
import { stateFrontmatterRange } from '../frontmatterUi';
import { livePreviewConfigFacet } from '../livePreviewConfig';
import { PrefetchScheduler } from '../prefetchScheduler';
import { DATAVIEW_PREFETCH_DELAYS, MAX_CACHED_NOTES } from './constants';
import { dataviewCacheNoteKey } from './store';

const INLINE_CLASSES = {
  root: 'q-md-dataview-inline',
  failed: 'q-md-dataview-inline--failed',
} as const;

const INLINE_EXPRESSION = /(^|[\s(—–])(=[ \t]+)/;

const inlineDataReady = StateEffect.define<null>();

const PROTECTED_NODES: Record<string, true> = {
  InlineCode: true,
  FencedCode: true,
  CodeBlock: true,
  CodeText: true,
  Link: true,
  URL: true,
  Autolink: true,
  WikiLink: true,
  HTMLBlock: true,
  HTMLTag: true,
};

export interface InlineExpression {
  from: number;
  to: number;
  expr: string;
}

function insideProtectedNode(tree: Tree, position: number): boolean {
  let node: SyntaxNode | null = tree.resolveInner(position, 1);
  while (node) {
    if (PROTECTED_NODES[node.name]) return true;
    node = node.parent;
  }
  return false;
}

export function findInlineExpressions(
  state: EditorState,
  tree: Tree = syntaxTree(state),
  ranges?: readonly { from: number; to: number }[],
): InlineExpression[] {
  const frontmatter = stateFrontmatterRange(state);
  const numbers = new Set<number>();

  if (ranges && ranges.length > 0) {
    for (const range of ranges) {
      const first = state.doc.lineAt(Math.min(range.from, state.doc.length)).number;
      const last = state.doc.lineAt(Math.min(range.to, state.doc.length)).number;
      for (let number = first; number <= last; number += 1) numbers.add(number);
    }
  } else {
    for (let number = 1; number <= state.doc.lines; number += 1) numbers.add(number);
  }

  const found: InlineExpression[] = [];
  for (const number of [...numbers].sort((left, right) => left - right)) {
    const line = state.doc.line(number);
    if (frontmatter && line.from < frontmatter.to) continue;

    const match = INLINE_EXPRESSION.exec(line.text);
    if (!match) continue;

    const from = line.from + match.index + match[1]!.length;
    const to = line.from + line.text.trimEnd().length;
    const expr = state.sliceDoc(from + match[2]!.length, to).trim();
    if (!expr) continue;
    if (!syntaxTreeAvailable(state, from)) continue;
    if (insideProtectedNode(tree, from)) continue;

    found.push({ from, to, expr });
  }

  return found;
}

type NoteValues = Map<string, DataviewInlineValue>;

const valuesByNote = new Map<string, NoteValues>();
const flights = new Map<string, Promise<boolean>>();

function noteValues(cacheNotePath: string): NoteValues {
  const known = valuesByNote.get(cacheNotePath);
  if (known) {
    valuesByNote.delete(cacheNotePath);
    valuesByNote.set(cacheNotePath, known);
    return known;
  }
  const created: NoteValues = new Map();
  valuesByNote.set(cacheNotePath, created);
  for (const oldest of valuesByNote.keys()) {
    if (valuesByNote.size <= MAX_CACHED_NOTES) break;
    valuesByNote.delete(oldest);
  }
  return created;
}

async function loadValues(
  cacheNotePath: string,
  workspacePath: string,
  notePath: string,
  expressions: readonly string[],
  refresh: boolean,
): Promise<boolean> {
  const values = noteValues(cacheNotePath);
  const wanted = [...new Set(expressions)].filter((expr) => refresh || !values.has(expr));
  if (wanted.length === 0) return false;

  try {
    const results = await evaluateInlineExpressions(
      workspacePath,
      notePath,
      wanted.map((expr, index) => ({ id: String(index), expr })),
    );
    const byId = new Map(results.map((result) => [result.id, result]));
    let changed = false;
    wanted.forEach((expr, index) => {
      const result = byId.get(String(index));
      if (!result) return;
      const known = values.get(expr);
      if (known?.value !== result.value || known?.error !== result.error) changed = true;
      values.set(expr, result);
    });
    return changed;
  } catch (error) {
    console.error('Failed to evaluate inline expressions', dataviewErrorMessage(error));
    return false;
  }
}

function evaluateNote(
  cacheNotePath: string,
  workspacePath: string,
  notePath: string,
  expressions: readonly string[],
  refresh: boolean,
): Promise<boolean> {
  const previous = flights.get(cacheNotePath) ?? Promise.resolve(false);
  const next = previous
    .then(() => loadValues(cacheNotePath, workspacePath, notePath, expressions, refresh))
    .finally(() => {
      if (flights.get(cacheNotePath) === next) flights.delete(cacheNotePath);
    });
  flights.set(cacheNotePath, next);
  return next;
}

class InlineValueWidget extends WidgetType {
  constructor(
    private readonly value: string,
    private readonly error: string | null,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof InlineValueWidget
      && other.value === this.value
      && other.error === this.error;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.error
      ? `${INLINE_CLASSES.root} ${INLINE_CLASSES.failed}`
      : INLINE_CLASSES.root;
    span.textContent = this.error
      ? t('dataview.inlineFailed')
      : this.value === '' ? t('dataview.inlineEmpty') : this.value;
    if (this.error) span.title = this.error;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function selectionTouches(state: EditorState, expression: InlineExpression): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= expression.to && range.to >= expression.from,
  );
}

function buildInlineDecorations(view: EditorView, notePath: string): DecorationSet {
  const config = view.state.facet(livePreviewConfigFacet);
  const workspacePath = config?.workspacePath;
  if (!workspacePath) return Decoration.none;
  const values = valuesByNote.get(dataviewCacheNoteKey(workspacePath, notePath));
  if (!values) return Decoration.none;

  const tree = ensureEditorTree(view);
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = visibleTreeRanges(view, view.state.doc.length);
  for (const expression of findInlineExpressions(view.state, tree, ranges)) {
    const value = values.get(expression.expr);
    if (!value || selectionTouches(view.state, expression)) continue;
    builder.add(
      expression.from,
      expression.to,
      Decoration.replace({ widget: new InlineValueWidget(value.value, value.error) }),
    );
  }
  return builder.finish();
}

class InlineDataviewPlugin {
  decorations: DecorationSet;
  private readonly scheduler: PrefetchScheduler;
  private workspacePath: string | null;

  constructor(private readonly view: EditorView) {
    const config = view.state.facet(livePreviewConfigFacet);
    this.workspacePath = config?.workspacePath ?? null;
    this.decorations = buildInlineDecorations(view, config?.notePath() ?? '');
    this.scheduler = new PrefetchScheduler(
      view,
      DATAVIEW_PREFETCH_DELAYS,
      (refresh) => this.refresh(refresh),
    );
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
    const config = update.state.facet(livePreviewConfigFacet);
    const workspacePath = config?.workspacePath ?? null;
    const workspaceChanged = workspacePath !== this.workspacePath;
    const dataReady = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(inlineDataReady)));
    this.workspacePath = workspacePath;

    if (
      update.docChanged
      || update.selectionSet
      || update.viewportChanged
      || treeChanged
      || dataReady
      || workspaceChanged
    ) {
      this.decorations = buildInlineDecorations(update.view, config?.notePath() ?? '');
    }
    if (update.docChanged || treeChanged || workspaceChanged) this.scheduler.schedule(workspaceChanged);
  }

  destroy(): void {
    this.scheduler.destroy();
  }

  private async refresh(refresh: boolean): Promise<void> {
    const config = this.view.state.facet(livePreviewConfigFacet);
    const workspacePath = config?.workspacePath;
    if (this.scheduler.destroyed || !config || !workspacePath) return;
    const notePath = config.notePath();
    if (!notePath) return;

    const expressions = [
      ...new Set(findInlineExpressions(this.view.state, ensureEditorTree(this.view))
        .map((found) => found.expr)),
    ];
    if (expressions.length === 0) return;

    const changed = await evaluateNote(
      dataviewCacheNoteKey(workspacePath, notePath),
      workspacePath,
      notePath,
      expressions,
      refresh,
    );
    if (this.scheduler.destroyed || !changed) return;
    this.view.dispatch({ effects: inlineDataReady.of(null) });
  }
}

const inlineTheme = EditorView.baseTheme({
  '.q-md-dataview-inline': {
    color: 'var(--q-text-accent)',
    whiteSpace: 'pre-wrap',
  },
  '.q-md-dataview-inline--failed': {
    color: 'var(--q-text-danger)',
    textDecoration: 'underline dotted',
  },
});

export function dataviewInlineExtension(): Extension {
  return [
    ViewPlugin.fromClass(InlineDataviewPlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
    inlineTheme,
  ];
}
