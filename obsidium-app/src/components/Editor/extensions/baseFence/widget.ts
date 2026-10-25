import { EditorSelection } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { relativePath } from '../../../../modules/paths';
import { livePreviewConfigFacet } from '../livePreviewConfig';
import { BASE_FENCE_SELECTOR } from './constants';
import { renderBaseFenceDom } from './dom';
import {
  baseFenceBlockHeight,
  baseFenceResultSignature,
  cachedBaseFenceResult,
  rememberBaseFenceBlockHeight,
} from './store';

type Options = {
  basePath: string;
  view: string | null;
  cacheNotePath: string;
  cacheKey: string;
  revision: number;
  workspacePath: string;
};

export class BaseFenceWidget extends WidgetType {
  private readonly signature: string;

  constructor(private readonly options: Options) {
    super();
    this.signature = baseFenceResultSignature(options.cacheNotePath, options.cacheKey, options.revision);
  }

  eq(other: WidgetType): boolean {
    return other instanceof BaseFenceWidget
      && this.options.basePath === other.options.basePath
      && this.options.view === other.options.view
      && this.options.cacheNotePath === other.options.cacheNotePath
      && this.options.revision === other.options.revision
      && this.signature === other.signature;
  }

  get estimatedHeight(): number {
    return baseFenceBlockHeight(this.options.cacheNotePath, this.options.cacheKey);
  }

  toDOM(view: EditorView): HTMLElement {
    const { basePath, cacheKey, cacheNotePath, revision, workspacePath } = this.options;
    const root = renderBaseFenceDom(
      cachedBaseFenceResult(cacheNotePath, cacheKey, revision),
      basePath,
      workspacePath,
    );

    view.requestMeasure({
      read: () => root.getBoundingClientRect().height,
      write: (height) => rememberBaseFenceBlockHeight(cacheNotePath, cacheKey, Math.round(height)),
    });

    root.addEventListener('mousedown', (event) => {
      if (!(event.target as HTMLElement | null)?.closest?.(BASE_FENCE_SELECTOR)) return;
      event.preventDefault();
      const link = (event.target as HTMLElement | null)?.closest?.('.q-base-link');
      const rowPath = link instanceof HTMLElement ? link.dataset.baseRowPath : undefined;
      const config = view.state.facet(livePreviewConfigFacet);
      if (rowPath && config) {
        event.stopPropagation();
        config.onOpenWikiLink(
          vaultRelativeLink(workspacePath, rowPath),
          event.ctrlKey || event.metaKey ? 'new-tab' : 'current',
        );
        return;
      }
      event.stopPropagation();
      view.dispatch({
        selection: EditorSelection.cursor(view.posAtDOM(root)),
        scrollIntoView: true,
      });
      view.focus();
    });

    return root;
  }

  ignoreEvent(event: Event): boolean {
    if (!(event.target as HTMLElement | null)?.closest?.(BASE_FENCE_SELECTOR)) return false;
    return event.type === 'mousedown' || event.type === 'click';
  }
}

function vaultRelativeLink(workspacePath: string, rowPath: string): string {
  try {
    return `/${relativePath(workspacePath, rowPath).replace(/\\/g, '/')}`;
  } catch {
    return rowPath;
  }
}
