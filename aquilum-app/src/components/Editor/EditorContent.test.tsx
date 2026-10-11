// @vitest-environment happy-dom
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import type { CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { DEFAULT_MARKDOWN_READING_SETTINGS } from '../../modules/settings';
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
      markdownReading={{ ...DEFAULT_MARKDOWN_READING_SETTINGS, style: 'ivory' }}
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
    expect(renderer!.container.querySelector('.q-editor-content--reading')).not.toBeNull();
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

  it('keeps the paper style local to note content in both reading and Live Preview', () => {
    act(() => { renderer = mountDom(<Harness readOnly={false} />); });
    const content = renderer!.container.querySelector<HTMLElement>('.q-editor-content');
    expect(content?.dataset.readingStyle).toBe('ivory');
    expect(content?.dataset.readingTexture).toBe('off');
    expect(content?.dataset.readingFont).toBe('standard');
    expect(content?.style.getPropertyValue('--q-editor-font-size')).toBe('18px');
    expect(content?.style.getPropertyValue('--q-editor-line-height')).toBe('1.7');
    expect(content?.style.getPropertyValue('--q-editor-max-width')).toBe('65ch');
    expect(renderer!.container.querySelector('[data-palette]')).toBeNull();
  });
});
