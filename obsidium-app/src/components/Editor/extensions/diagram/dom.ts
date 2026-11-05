import { t } from '../../../../i18n';
import { DIAGRAM_CLASSES } from './constants';
import type { DiagramResult } from './store';

function message(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = DIAGRAM_CLASSES.message;
  element.textContent = text;
  return element;
}

function frame(className?: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className ? `${DIAGRAM_CLASSES.frame} ${className}` : DIAGRAM_CLASSES.frame;
  element.setAttribute('contenteditable', 'false');
  return element;
}

export function createDiagramDom(result: DiagramResult | undefined): HTMLElement {
  const root = document.createElement('div');
  root.className = DIAGRAM_CLASSES.root;

  if (!result) {
    const pending = frame(DIAGRAM_CLASSES.pending);
    pending.append(message(t('editor.diagramPending')));
    root.append(pending);
    return root;
  }

  if (result.status === 'failed') {
    const failed = frame(DIAGRAM_CLASSES.failed);
    failed.append(message(t('editor.diagramFailed', { reason: result.message })));
    root.append(failed);
    return root;
  }

  const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') {
    const failed = frame(DIAGRAM_CLASSES.failed);
    failed.append(message(t('editor.diagramFailed', { reason: 'invalid svg' })));
    root.append(failed);
    return root;
  }

  const imported = document.importNode(svg, true);
  imported.setAttribute('class', `${imported.getAttribute('class') ?? ''} ${DIAGRAM_CLASSES.svg}`.trim());
  const container = frame();
  container.append(imported);
  root.append(container);
  return root;
}
