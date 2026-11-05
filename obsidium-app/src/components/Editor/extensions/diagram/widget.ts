import { EditorSelection } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { DIAGRAM_SELECTOR } from './constants';
import { createDiagramDom } from './dom';
import { diagramHeight, rememberDiagramHeight, type DiagramResult } from './store';

type Options = {
  from: number;
  cacheKey: string;
  result: DiagramResult | undefined;
};

export class DiagramWidget extends WidgetType {
  constructor(private readonly options: Options) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof DiagramWidget
      && this.options.cacheKey === other.options.cacheKey
      && this.options.result === other.options.result;
  }

  get estimatedHeight(): number {
    return diagramHeight(this.options.cacheKey);
  }

  toDOM(view: EditorView): HTMLElement {
    const root = createDiagramDom(this.options.result);

    view.requestMeasure({
      read: () => root.getBoundingClientRect().height,
      write: (height) => rememberDiagramHeight(this.options.cacheKey, Math.round(height)),
    });

    root.addEventListener('mousedown', (event) => {
      if (!(event.target as HTMLElement | null)?.closest?.(DIAGRAM_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;
      view.dispatch({
        selection: EditorSelection.cursor(this.options.from),
        scrollIntoView: true,
      });
      view.focus();
    });

    return root;
  }
}
