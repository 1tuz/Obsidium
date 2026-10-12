// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { editorMarkdownSupport } from '../markdownConfig';
import { codeBlockExtension } from './index';

describe('code block extension', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('mounts fenced code controls without throwing a block decoration error', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: '```js\nconst count = 1;\n```',
        extensions: [editorMarkdownSupport, codeBlockExtension],
      }),
      parent,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(parent.querySelector('.q-md-code-controls')).not.toBeNull();
    parent.remove();
  });
});
