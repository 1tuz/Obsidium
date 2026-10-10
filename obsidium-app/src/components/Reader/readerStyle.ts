import { BOLD_WEIGHT, fontFaceCss, fontStack } from '../../fonts/catalog';
import { readingColors, type ReadingMode } from '../../modules/theme/reading';
import type { ReaderSettings } from '../../modules/settings';

interface ReaderPalette {
  text: string;
  background: string;
  muted: string;
  accent?: string;
}

export function readerPalette(settings?: ReaderSettings, mode?: ReadingMode): ReaderPalette {
  const activeMode: ReadingMode = mode ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const paper = readingColors(settings?.paperTheme ?? 'inherit', activeMode);
  if (paper) return paper;
  const style = getComputedStyle(document.documentElement);
  const text = style.getPropertyValue('--q-text-primary').trim() || 'inherit';
  return {
    text,
    background: style.getPropertyValue('--q-bg-canvas').trim() || 'transparent',
    muted: style.getPropertyValue('--q-text-secondary').trim() || text,
  };
}

const BOLD_ELEMENTS = 'b, strong, h1, h2, h3, h4, h5, h6, th';
const OWN_FONT_ELEMENTS = 'pre, code, kbd, samp';

function readerFont(settings: ReaderSettings): { stack: string; weight: number } {
  return { stack: fontStack(settings.fontFamily), weight: settings.fontWeight };
}

const advanceCache = new Map<string, number>();

export async function readerColumnWidthPx(settings: ReaderSettings): Promise<number> {
  const { stack, weight } = readerFont(settings);
  const font = `${weight} ${settings.fontSizeBase}px ${stack}`;
  let advance = advanceCache.get(font);
  if (advance === undefined) {
    await document.fonts.load(font, '0');
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = font;
      advance = context.measureText('0').width;
    }
    advance ||= settings.fontSizeBase * 0.5;
    advanceCache.set(font, advance);
  }
  return Math.round(settings.maxWidthCh * advance);
}

export function readerStyleCss(settings: ReaderSettings, palette: ReaderPalette): string {
  const hyphens = settings.hyphenate ? 'auto' : 'manual';
  const { stack, weight } = readerFont(settings);
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${fontFaceCss()}
    html, body {
      background: ${palette.background} !important;
      color: ${palette.text} !important;
      font-size: ${settings.fontSizeBase}px !important;
    }
    *:not(${OWN_FONT_ELEMENTS}) {
      font-family: ${stack} !important;
    }
    *:not(${OWN_FONT_ELEMENTS}, ${BOLD_ELEMENTS}, :is(${BOLD_ELEMENTS}) *) {
      font-weight: ${weight};
    }
    :is(${BOLD_ELEMENTS}), :is(${BOLD_ELEMENTS}) * { font-weight: ${BOLD_WEIGHT}; }
    p, li, blockquote, dd, td, th {
      line-height: ${settings.lineHeight};
      text-align: ${settings.justify ? 'justify' : 'start'};
      -webkit-hyphens: ${hyphens};
      hyphens: ${hyphens};
      -webkit-hyphenate-limit-before: 3;
      -webkit-hyphenate-limit-after: 2;
      -webkit-hyphenate-limit-lines: 2;
      hanging-punctuation: allow-end last;
      widows: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    p, li, blockquote, dd { color: ${palette.text}; }
    a { color: ${palette.accent ?? palette.muted} !important; }
    blockquote { border-inline-start: 3px solid ${palette.muted}; padding-inline-start: 1rem; }
    pre { white-space: pre-wrap !important; background: color-mix(in srgb, ${palette.background} 90%, ${palette.text}); padding: .75rem; border-radius: .4rem; }
    code { color: ${palette.text}; }
    ::selection { background: color-mix(in srgb, ${palette.muted} 40%, transparent); }
    img, svg, video { max-width: 100%; height: auto; }
  `;
}
