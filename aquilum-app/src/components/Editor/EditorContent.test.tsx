// @vitest-environment happy-dom
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import type { CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { EditorContent } from './EditorContent';

function Harness({ readOnly }: { readOnly: boolean }) {
  const titleRef = useRef<CodeMirrorFieldRef>(null);
  const bodyRef = useRef<EditorView>(null);
  return (
    <EditorContent
      titleRef={titleRef}
      bodyRef={bodyRef}
      title="Note"
      onCommitTitle={() => {}}
      initialBody="**text**"
      selection={undefined}
      extensions={[]}
      autoLinkTitle={false}
      onCreateEditor={() => {}}
      onUpdate={() => {}}
      readOnly={readOnly}
    />
  );
}

describe('EditorContent reading mode', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('makes both title and body non-editable in reading mode', () => {
    act(() => { renderer = mountDom(<Harness readOnly />); });
    const editors = renderer!.container.querySelectorAll<HTMLElement>('.cm-content');
    expect(editors).toHaveLength(2);
    expect([...editors].every((editor) => editor.getAttribute('contenteditable') === 'false')).toBe(true);
  });

  it('keeps both title and body editable in editing mode', () => {
    act(() => { renderer = mountDom(<Harness readOnly={false} />); });
    const editors = renderer!.container.querySelectorAll<HTMLElement>('.cm-content');
    expect(editors).toHaveLength(2);
    expect([...editors].every((editor) => editor.getAttribute('contenteditable') === 'true')).toBe(true);
  });
});
