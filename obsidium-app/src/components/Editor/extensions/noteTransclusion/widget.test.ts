// @vitest-environment happy-dom
import { undo } from '@codemirror/commands';
import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../../../i18n';
import type * as DocumentGateway from '../../../../modules/documents/documentGateway';
import type * as FileGateway from '../../../../modules/documents/fileGateway';
import { livePreviewConfigFacet, type LivePreviewConfig } from '../livePreviewConfig';
import { NoteTransclusionWidget } from './widget';

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  text: '',
  log: [] as { client: string; changes: unknown }[],
  handlers: [] as (() => void)[],
}));

vi.mock('../../../../modules/documents/fileGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof FileGateway>();
  return {
    ...actual,
    readFileSnapshot: async (path: string) => ({
      content: fake.files.get(path) ?? '',
      hash: '',
      textHash: '',
    }),
  };
});

vi.mock('../../../../modules/documents/documentGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentGateway>();
  const apply = (changes: unknown) => {
    fake.text = ChangeSet.fromJSON(changes).apply(Text.of(fake.text.split('\n'))).toString();
  };
  return {
    ...actual,
    openDocument: async () => ({ text: fake.text, version: fake.log.length }),
    readDocument: async () => ({ text: fake.text, version: fake.log.length }),
    releaseDocument: async () => {},
    pushChanges: async (_path: string, version: number, client: string, changes: unknown[]) => {
      if (version !== fake.log.length) return false;
      fake.log.push({ client, changes: changes[0] });
      apply(changes[0]);
      return true;
    },
    pullChanges: async (_path: string, version: number) => (version > fake.log.length
      ? { kind: 'resync' as const, text: fake.text, version: fake.log.length }
      : { kind: 'changes' as const, changes: fake.log.slice(version) }),
    onDocumentChanged: (_path: () => string, handler: () => void) => {
      fake.handlers.push(handler);
      return () => {
        const index = fake.handlers.indexOf(handler);
        if (index >= 0) fake.handlers.splice(index, 1);
      };
    },
  };
});

const TARGET = '/vault/A.md';
const NOTE = '# Intro\nintro\n\n## Plan\n- one\n\n## Next\nend';

function livePreview(): LivePreviewConfig {
  return {
    resolveWikiLinks: async (targets) => ({ paths: targets.map(() => TARGET), complete: true }),
    workspacePath: '/vault',
    notePath: () => '/vault/root.md',
    onOpenWikiLink: () => {},
    onOpenExternalUrl: () => {},
    onReadBook: () => {},
  };
}

let host: EditorView | null = null;
let widget: NoteTransclusionWidget | null = null;
let root: HTMLElement | null = null;

function mount(ancestry: string[]): { root: HTMLElement; body: HTMLElement; status: HTMLElement } {
  const config = livePreview();
  host = new EditorView({
    state: EditorState.create({
      doc: '![[A#Plan]]',
      extensions: [livePreviewConfigFacet.of(config)],
    }),
    parent: document.body,
  });
  widget = new NoteTransclusionWidget(
    { target: 'A', heading: 'Plan', blockId: null },
    config,
    'A',
    0,
    ancestry,
    () => [],
    () => () => {},
  );
  root = widget.toDOM(host);
  document.body.append(root);
  const body = root.querySelector('.q-note-transclusion__body') as HTMLElement;
  const status = root.querySelector('.q-note-transclusion__status') as HTMLElement;
  return { root, body, status };
}

async function flush(): Promise<void> {
  for (let tick = 0; tick < 60; tick += 1) await Promise.resolve();
}

function nestedView(body: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(body);
  if (!view) throw new Error('nested editor missing');
  return view;
}

function clickBody(body: HTMLElement): void {
  body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  fake.files.clear();
  fake.text = '';
  fake.log.length = 0;
  fake.handlers.length = 0;
  vi.stubGlobal('IntersectionObserver', undefined);
});

afterEach(() => {
  if (root && widget) widget.destroy(root);
  root?.remove();
  host?.destroy();
  root = null;
  widget = null;
  host = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('note transclusion widget', () => {
  it('renders the cycle message without nesting an editor', async () => {
    fake.files.set(TARGET, NOTE);
    const mounted = mount(['/vault/root.md', TARGET]);
    await flush();

    expect(mounted.body.textContent).toBe(t('editor.embeddedNoteCycle'));
    expect(mounted.root.querySelector('.cm-editor')).toBeNull();
    expect(() => widget?.destroy(mounted.root)).not.toThrow();
  });

  it('applies an edit from the embed to the section range only', async () => {
    fake.files.set(TARGET, NOTE);
    fake.text = NOTE;
    const { root, body } = mount([]);
    await flush();
    const nested = nestedView(body);

    clickBody(body);
    await flush();
    expect(root.classList.contains('q-note-transclusion--editing')).toBe(true);

    nested.dispatch({ changes: { from: 0, to: 0, insert: '- zero\n' } });
    await flush();

    expect(fake.text).toBe('# Intro\nintro\n\n## Plan\n- zero\n- one\n\n## Next\nend');
  });

  it('undoes the embed edit through the replica', async () => {
    fake.files.set(TARGET, NOTE);
    fake.text = NOTE;
    const { body } = mount([]);
    await flush();
    const nested = nestedView(body);

    clickBody(body);
    await flush();
    nested.dispatch({ changes: { from: 0, to: 0, insert: '- zero\n' } });
    await flush();
    expect(fake.text).not.toBe(NOTE);

    undo(nested);
    await flush();

    expect(fake.text).toBe(NOTE);
  });

  it('leaves editing on Escape and stops pushing', async () => {
    fake.files.set(TARGET, NOTE);
    fake.text = NOTE;
    const { root, body } = mount([]);
    await flush();
    const nested = nestedView(body);

    clickBody(body);
    await flush();
    expect(root.classList.contains('q-note-transclusion--editing')).toBe(true);

    nested.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
    await flush();
    expect(root.classList.contains('q-note-transclusion--editing')).toBe(false);

    nested.dispatch({ changes: { from: 0, to: 0, insert: 'x' } });
    await flush();

    expect(fake.log.length).toBe(0);
    expect(fake.text).toBe(NOTE);
  });

  it('blocks editing when the heading is missing in the replica', async () => {
    fake.files.set(TARGET, NOTE);
    fake.text = '# Other\ntext';
    const { root, body, status } = mount([]);
    await flush();
    expect(body.querySelector('.cm-editor')).not.toBeNull();

    clickBody(body);
    await flush();

    expect(status.textContent).toBe(t('editor.embeddedHeadingUnavailable', { heading: 'Plan' }));
    expect(root.classList.contains('q-note-transclusion--editing')).toBe(false);
    expect(fake.log.length).toBe(0);
  });

  it('stops editing when another client removes the heading', async () => {
    fake.files.set(TARGET, NOTE);
    fake.text = NOTE;
    const { root, body, status } = mount([]);
    await flush();
    const nested = nestedView(body);

    clickBody(body);
    await flush();
    expect(root.classList.contains('q-note-transclusion--editing')).toBe(true);

    const from = NOTE.indexOf('## Plan\n');
    const changeSet = ChangeSet.of({ from, to: from + '## Plan\n'.length, insert: '' }, NOTE.length);
    fake.log.push({ client: 'disk', changes: changeSet.toJSON() });
    fake.text = changeSet.apply(Text.of(NOTE.split('\n'))).toString();
    for (const handler of [...fake.handlers]) handler();
    await flush();

    expect(status.textContent).toBe(t('editor.embeddedHeadingUnavailable', { heading: 'Plan' }));
    expect(nested.state.readOnly).toBe(true);
  });
});
