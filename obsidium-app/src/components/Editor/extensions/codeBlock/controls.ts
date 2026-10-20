import { languages } from '@codemirror/language-data';
import type { Text } from '@codemirror/state';
import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import { t } from '../../../../i18n';
import { copyText } from '../../../../modules/clipboard';
import { codeLanguageChange, type CodeBlockShape } from './blocks';
import { fenceLanguage } from './languages';

const COPY_COPIED = 'q-md-code-controls__copy--copied';
const COPY_FAILED = 'q-md-code-controls__copy--failed';
const COPIED_REVERT_MS = 1600;
const FAILED_REVERT_MS = 2400;

const languageOptions = languages
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name));

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function scanFence(doc: Text, number: number): CodeBlockShape | null {
  const opener = doc.line(number);
  const match = FENCE.exec(opener.text);
  if (!match) return null;
  const marker = match[1][0];
  const width = match[1].length;
  for (let cursor = number + 1; cursor <= doc.lines; cursor += 1) {
    const line = doc.line(cursor);
    const closing = FENCE.exec(line.text);
    if (closing && closing[1][0] === marker && closing[1].length >= width && closing[2].trim() === '') {
      const contentFrom = opener.to < doc.length ? opener.to + 1 : opener.to;
      return {
        from: opener.from,
        end: line.to,
        info: match[2].trim(),
        infoFrom: opener.from + match[0].length - match[2].length,
        contentFrom,
        contentTo: line.from > contentFrom ? line.from - 1 : contentFrom,
        fenced: true,
      };
    }
  }
  const last = doc.line(doc.lines);
  const contentFrom = opener.to < doc.length ? opener.to + 1 : opener.to;
  return {
    from: opener.from,
    end: last.to,
    info: match[2].trim(),
    infoFrom: opener.from + match[0].length - match[2].length,
    contentFrom,
    contentTo: last.to,
    fenced: true,
  };
}

const destroyedWidgets = new WeakSet<CodeBlockControlWidget>();

class CodeBlockControlWidget extends WidgetType {
  private info: string;

  constructor(private block: CodeBlockShape) {
    super();
    this.info = block.info;
  }

  eq(other: CodeBlockControlWidget): boolean {
    return this.block.from === other.block.from
      && this.block.info === other.block.info
      && this.block.contentFrom === other.block.contentFrom
      && this.block.contentTo === other.block.contentTo;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const doc = view.state.doc;
    const block = scanFence(doc, doc.lineAt(Math.min(this.block.from, doc.length)).number);
    if (!block) return false;
    this.block = block;
    const [select, button] = dom.children;
    if (this.info !== block.info && select instanceof HTMLSelectElement) {
      const current = fenceLanguage(block.info);
      select.value = current ? languageOptions.find((language) => language.name === current.name)?.name ?? '' : '';
      this.info = block.info;
    }
    if (button instanceof HTMLButtonElement) button.disabled = view.state.readOnly;
    if (select instanceof HTMLSelectElement) select.disabled = view.state.readOnly;
    return true;
  }

  destroy(): void {
    destroyedWidgets.add(this);
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
    let revertTimer: number | null = null;
    const reset = (): void => {
      copy.textContent = t('editor.copyCode');
      copy.classList.remove(COPY_COPIED, COPY_FAILED);
      revertTimer = null;
    };
    const settle = (label: string, stateClass: string, delay: number): void => {
      if (revertTimer !== null) window.clearTimeout(revertTimer);
      copy.textContent = label;
      copy.classList.remove(COPY_COPIED, COPY_FAILED);
      copy.classList.add(stateClass);
      revertTimer = window.setTimeout(() => {
        if (!destroyedWidgets.has(this) && copy.isConnected) reset();
      }, delay);
    };
    copy.addEventListener('click', () => {
      const doc = view.state.doc;
      const bounds = scanFence(doc, doc.lineAt(Math.min(this.block.from, doc.length)).number) ?? this.block;
      const text = doc.sliceString(bounds.contentFrom, bounds.contentTo);
      void copyText(text).then((copied) => {
        settle(
          copied ? t('editor.codeCopied') : t('editor.codeCopyFailed'),
          copied ? COPY_COPIED : COPY_FAILED,
          copied ? COPIED_REVERT_MS : FAILED_REVERT_MS,
        );
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
