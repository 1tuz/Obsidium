// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { codeBlockTheme } from './theme';

it('keeps the code controls within a narrow editor without wrapping the copy label', () => {
  const view = new EditorView({ extensions: [codeBlockTheme], parent: document.body });
  try {
    const toolbar = document.createElement('div');
    toolbar.className = 'q-md-code-controls';
    const language = document.createElement('select');
    language.className = 'q-md-code-controls__language';
    const copy = document.createElement('button');
    copy.className = 'q-md-code-controls__copy';
    toolbar.append(language, copy);
    view.dom.append(toolbar);

    const headerStyle = getComputedStyle(toolbar);
    expect(headerStyle.boxSizing).toBe('border-box');
    expect(headerStyle.maxWidth).toBe('100%');
    expect(headerStyle.flexWrap).toBe('wrap');
    const languageStyle = getComputedStyle(language);
    expect(['0', '0px']).toContain(languageStyle.minWidth);
    expect(languageStyle.flexShrink).toBe('1');
    const copyStyle = getComputedStyle(copy);
    expect(copyStyle.flexShrink).toBe('0');
    expect(copyStyle.whiteSpace).toBe('nowrap');
  } finally {
    view.destroy();
  }
});
