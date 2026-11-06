import { EditorView } from '@codemirror/view';
import { DIAGRAM_CLASSES } from './constants';

const COLOR_TOKENS = {
  mainBkg: '--q-bg-accent-subtle',
  primaryColor: '--q-bg-accent-subtle',
  primaryTextColor: '--q-text-primary',
  primaryBorderColor: '--q-border-accent-subtle',
  nodeBorder: '--q-border-accent-subtle',
  secondaryColor: '--q-bg-surface-raised',
  tertiaryColor: '--q-bg-surface-subtle',
  lineColor: '--q-text-secondary',
  textColor: '--q-text-primary',
  nodeTextColor: '--q-text-primary',
  titleColor: '--q-text-primary',
  clusterBkg: '--q-bg-surface-subtle',
  clusterBorder: '--q-border-default',
  edgeLabelBackground: '--q-bg-surface',
} as const;

const COLOR_SENTINEL = 'rgb(18, 52, 86)';

const COLOR_LITERAL = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|rgba?\(|hsla?\()/iu;

const FALLBACK_COLOR = COLOR_SENTINEL;

let probe: HTMLElement | null = null;
let colorSink: CanvasRenderingContext2D | null | undefined;
let cachedThemeKey = '';
let cachedVariables: Record<string, string> = {};

function rasterSink(): CanvasRenderingContext2D | null {
  if (colorSink !== undefined) return colorSink;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    colorSink = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    colorSink = null;
  }
  return colorSink;
}

function mermaidColor(value: string): string {
  const context = rasterSink();
  if (!context) return COLOR_LITERAL.test(value) ? value : FALLBACK_COLOR;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = COLOR_SENTINEL;
  context.fillStyle = value;
  if (context.fillStyle === COLOR_SENTINEL && value !== COLOR_SENTINEL) {
    return COLOR_LITERAL.test(value) ? value : FALLBACK_COLOR;
  }
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 255) return `rgb(${red}, ${green}, ${blue})`;
  return `rgba(${red}, ${green}, ${blue}, ${Number((alpha / 255).toFixed(3))})`;
}

function colorProbe(): HTMLElement {
  if (probe?.isConnected) return probe;
  const element = document.createElement('span');
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.visibility = 'hidden';
  element.style.pointerEvents = 'none';
  document.body.append(element);
  probe = element;
  return element;
}

export function diagramThemeKey(): string {
  const root = document.documentElement;
  return `${root.dataset.theme ?? ''}|${root.dataset.palette ?? ''}|${root.dataset.accentMode ?? ''}`;
}

export function diagramThemeVariables(): Record<string, string> {
  const themeKey = diagramThemeKey();
  if (themeKey === cachedThemeKey && Object.keys(cachedVariables).length > 0) return cachedVariables;

  const element = colorProbe();
  const styles = getComputedStyle(element);
  const variables: Record<string, string> = {};
  for (const [name, token] of Object.entries(COLOR_TOKENS)) {
    element.style.color = `var(${token}, ${FALLBACK_COLOR})`;
    variables[name] = mermaidColor(getComputedStyle(element).color || FALLBACK_COLOR);
  }
  element.style.color = '';
  element.style.fontFamily = 'var(--q-editor-font-family, sans-serif)';
  variables.fontFamily = getComputedStyle(element).fontFamily || 'sans-serif';
  element.style.fontFamily = '';
  element.style.fontSize = 'var(--q-editor-font-size, 14px)';
  variables.fontSize = styles.fontSize || '14px';
  element.style.fontSize = '';

  cachedThemeKey = themeKey;
  cachedVariables = variables;
  return variables;
}

export const diagramTheme = EditorView.baseTheme({
  [`.${DIAGRAM_CLASSES.root}`]: {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
  },
  [`.${DIAGRAM_CLASSES.frame}`]: {
    boxSizing: 'border-box',
    minWidth: '0',
    overflowX: 'auto',
    padding: 'var(--q-block-padding)',
    borderRadius: 'var(--q-block-radius)',
    border: 'var(--q-border-1) solid var(--q-block-border)',
    backgroundColor: 'var(--q-block-bg)',
  },
  [`.${DIAGRAM_CLASSES.pending}`]: {
    minHeight: '96px',
  },
  [`.${DIAGRAM_CLASSES.svg}`]: {
    display: 'block',
    margin: '0 auto',
    maxWidth: '100%',
  },
  [`.${DIAGRAM_CLASSES.message}`]: {
    color: 'var(--q-text-secondary)',
    fontFamily: 'var(--q-font-family-ui)',
    fontSize: 'var(--q-font-size-12)',
    lineHeight: 'var(--q-font-line-height-snug)',
    wordBreak: 'break-word',
  },
  [`.${DIAGRAM_CLASSES.failed} .${DIAGRAM_CLASSES.message}`]: {
    color: 'var(--q-text-danger)',
  },
});
