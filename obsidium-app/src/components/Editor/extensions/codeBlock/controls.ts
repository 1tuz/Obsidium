import { languages } from '@codemirror/language-data';
import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import { t } from '../../../../i18n';
import { codeLanguageChange, type CodeBlockShape } from './blocks';
import { fenceLanguage } from './languages';

const languageOptions = languages
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name));

class CodeBlockControlWidget extends WidgetType {
  constructor(private readonly block: CodeBlockShape) {
    super();
  }

  eq(other: CodeBlockControlWidget): boolean {
    return this.block.from === other.block.from
      && this.block.info === other.block.info
      && this.block.contentFrom === other.block.contentFrom
      && this.block.contentTo === other.block.contentTo;
  }

  toDOM(view: EditorView): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'q-md-code-controls';

    const select = document.createElement('select');
    select.className = 'q-md-code-controls__language';
    select.setAttribute('aria-label', t('editor.codeLanguage'));
    select.disabled = view.state.readOnly;
    const plain = document.createElement('option');
    plain.value = '';
    plain.textContent = t('editor.plainText');
    select.append(plain);
    for (const language of languageOptions) {
      const option = document.createElement('option');
      option.value = language.name;
      option.textContent = language.name;
      select.append(option);
    }
    const current = fenceLanguage(this.block.info);
    select.value = current ? languageOptions.find((language) => language.name === current.name)?.name ?? '' : '';
    select.addEventListener('change', () => {
      view.dispatch({ changes: codeLanguageChange(this.block, select.value) });
    });
    controls.append(select);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'q-md-code-controls__copy';
    copy.textContent = t('editor.copyCode');
    copy.addEventListener('click', () => {
      const text = view.state.sliceDoc(this.block.contentFrom, this.block.contentTo);
      void navigator.clipboard.writeText(text).then(() => {
        copy.textContent = t('editor.codeCopied');
      }).catch((error) => {
        console.error('Failed to copy code block', error);
      });
    });
    controls.append(copy);
    return controls;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function codeBlockControlDecoration(block: CodeBlockShape): Decoration | null {
  if (!block.fenced) return null;
  return Decoration.widget({
    widget: new CodeBlockControlWidget(block),
    side: -1,
    block: true,
  });
}
