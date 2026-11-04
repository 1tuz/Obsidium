// @vitest-environment happy-dom
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import type { CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { DEFAULT_MARKDOWN_READING_SETTINGS } from '../../modules/settings';
import { EditorContent } from './EditorContent';
import { minimapExtension } from './extensions/blocks/minimapBridge';
import { slashMenuExtension } from './extensions/blocks/slash';

const BODY = '# One\n\n## Two\n\nbody text\n';

function Harness({
  bodyRef,
  body,
  extensions,
  readOnly,
  showMinimap,
}: {
  bodyRef: { current: EditorView | null };
  body: string;
  extensions: Extension[];
  readOnly: boolean;
  showMinimap?: boolean;
}) {
  const titleRef = useRef<CodeMirrorFieldRef>(null);
  return (
    <EditorContent
      titleRef={titleRef}
      bodyRef={bodyRef}
      title="Note"
      onCommitTitle={() => {}}
      initialBody={body}
      selection={undefined}
      extensions={extensions}
      autoLinkTitle={false}
      onCreateEditor={() => {}}
      onUpdate={() => {}}
      readOnly={readOnly}
      markdownReading={DEFAULT_MARKDOWN_READING_SETTINGS}
      showMinimap={showMinimap}
    />
  );
}

function typeSlash(view: EditorView, query: string): void {
  const at = view.state.doc.length;
  const insert = `/${query}`;
  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
  });
}

function typeText(view: EditorView, text: string): void {
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: EditorSelection.cursor(at + text.length),
  });
}

describe('EditorContent block features', () => {
  let renderer: MountedDom | null = null;
  const bodyRef: { current: EditorView | null } = { current: null };

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    bodyRef.current = null;
  });

  it('renders one minimap stroke per heading and resizes by level', () => {
    act(() => {
      renderer = mountDom(
        <Harness
          bodyRef={bodyRef}
          body={BODY}
          extensions={[minimapExtension()]}
          readOnly={false}
          showMinimap
        />,
      );
    });
    const strokes = renderer!.container.querySelectorAll<HTMLElement>('.q-block-minimap__stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes[0].dataset.level).toBe('1');
    expect(strokes[1].dataset.level).toBe('2');
    const widths = [...strokes].map((stroke) => parseFloat(stroke.style.width));
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it('keeps the minimap hidden when the setting is off', () => {
    act(() => {
      renderer = mountDom(
        <Harness bodyRef={bodyRef} body={BODY} extensions={[minimapExtension()]} readOnly={false} />,
      );
    });
    expect(renderer!.container.querySelector('.q-block-minimap')).toBeNull();
  });

  it('opens the slash menu on an empty line and filters by query', () => {
    act(() => {
      renderer = mountDom(
        <Harness
          bodyRef={bodyRef}
          body={BODY}
          extensions={[slashMenuExtension({ enabled: true, readOnly: false })]}
          readOnly={false}
        />,
      );
    });
    const view = bodyRef.current!;
    view.focus();
    act(() => { typeSlash(view, ''); });
    console.log('DBG', view.hasFocus, view.state.doc.toString().slice(-10), renderer!.container.innerHTML.includes('q-block-slash'), document.querySelectorAll('.q-block-slash').length);
    const panel = renderer!.container.querySelector<HTMLElement>('.q-block-slash');
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll('.q-block-slash__row').length).toBeGreaterThan(0);

    act(() => { typeText(view, 'head'); });
    const labels = [...panel!.querySelectorAll('.q-block-slash__row')].map((row) => row.textContent ?? '');
    expect(labels.some((label) => label.includes('Heading 1'))).toBe(true);
    expect(labels.some((label) => label.includes('Quote'))).toBe(false);
  });

  it('does not open the slash menu in reading mode', () => {
    act(() => {
      renderer = mountDom(
        <Harness bodyRef={bodyRef} body={BODY} extensions={[]} readOnly showMinimap />,
      );
    });
    expect(renderer!.container.querySelector('.q-block-slash')).toBeNull();
  });
});
