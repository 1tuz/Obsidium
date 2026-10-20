import { renderMarkdownToHtml } from '../export/markdownToHtml';
import { canvasFreehandPath } from './freehand';
import { getCanvasEdgeGeometry, getCanvasEdgePath } from './interaction';
import { canvasFreehandPoints } from './model';
import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasTypedNode } from './model';
import type { CanvasEdgeRoute } from './interaction';

export type CanvasSvgPalette = {
  paper: string;
  ink: string;
  card: string;
  border: string;
  edge: string;
  presets: Record<string, string>;
};

export type CanvasSvgMedia = { kind: 'image' | 'video'; src: string; label: string };

export interface CanvasSvgContext {
  palette: CanvasSvgPalette;
  media: (node: CanvasTypedNode) => CanvasSvgMedia | null;
  imageHref: (src: string) => string;
  markdown: (node: CanvasTypedNode) => string;
  resolveImage: (node: CanvasTypedNode, target: string) => string;
  shapeStroke: (node: CanvasTypedNode) => string;
  shapeFill: (node: CanvasTypedNode) => string;
  textMode?: 'html' | 'svg';
}

const PADDING = 24;
const SHAPE_STROKE_WIDTH = 2;
const MARKER_SIZE = 10;
const MARKER_ID_PREFIX = 'canvas-arrow';

const VOID_TAGS = 'br|hr|img|input|meta|link';

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  shy: '\u00ad',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  harr: '\u2194',
  lArr: '\u21d0',
  rArr: '\u21d2',
  hArr: '\u21d4',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',
  asymp: '\u2248',
  infin: '\u221e',
  minus: '\u2212',
  sum: '\u2211',
  prod: '\u220f',
  radic: '\u221a',
  part: '\u2202',
  int: '\u222b',
  there4: '\u2234',
  equiv: '\u2261',
  alpha: '\u03b1',
  beta: '\u03b2',
  gamma: '\u03b3',
  delta: '\u03b4',
  epsilon: '\u03b5',
  zeta: '\u03b6',
  eta: '\u03b7',
  theta: '\u03b8',
  iota: '\u03b9',
  kappa: '\u03ba',
  lambda: '\u03bb',
  mu: '\u03bc',
  nu: '\u03bd',
  xi: '\u03be',
  omicron: '\u03bf',
  pi: '\u03c0',
  rho: '\u03c1',
  sigma: '\u03c3',
  tau: '\u03c4',
  upsilon: '\u03c5',
  phi: '\u03c6',
  chi: '\u03c7',
  psi: '\u03c8',
  omega: '\u03c9',
  Alpha: '\u0391',
  Beta: '\u0392',
  Gamma: '\u0393',
  Delta: '\u0394',
  Epsilon: '\u0395',
  Zeta: '\u0396',
  Eta: '\u0397',
  Theta: '\u0398',
  Iota: '\u0399',
  Kappa: '\u039a',
  Lambda: '\u039b',
  Mu: '\u039c',
  Nu: '\u039d',
  Xi: '\u039e',
  Omicron: '\u039f',
  Pi: '\u03a0',
  Rho: '\u03a1',
  Sigma: '\u03a3',
  Tau: '\u03a4',
  Upsilon: '\u03a5',
  Phi: '\u03a6',
  Chi: '\u03a7',
  Psi: '\u03a8',
  Omega: '\u03a9',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  sup2: '\u00b2',
  sup3: '\u00b3',
  micro: '\u00b5',
  para: '\u00b6',
  sect: '\u00a7',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  szlig: '\u00df',
  aelig: '\u00e6',
  oslash: '\u00f8',
  aring: '\u00e5',
  ccedil: '\u00e7',
  ntilde: '\u00f1',
};

const PRESERVED_ENTITIES: Record<string, true> = { amp: true, lt: true, gt: true, quot: true, apos: true };

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function numericEntity(codePoint: number): string {
  return codePoint > 0 && codePoint <= 0x10ffff ? `&#${codePoint};` : '';
}

export function xmlSafeHtml(html: string): string {
  return html
    .replace(/&([a-zA-Z][a-zA-Z\d]*)(;)/g, (entity, name: string, closing: string) => {
      if (PRESERVED_ENTITIES[name]) return entity;
      const character = NAMED_ENTITIES[name];
      return character ? numericEntity(character.codePointAt(0) ?? 0) : `&amp;${name}${closing}`;
    })
    .replace(new RegExp(`<(${VOID_TAGS})(\\s[^<>]*?)?\\s*/?>`, 'g'), (_match, tag: string, attributes: string | undefined) =>
      `<${tag}${attributes ?? ''} />`);
}

function number(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

function nodeColor(palette: CanvasSvgPalette, node: CanvasTypedNode, fallback: string): string {
  const value = node.color;
  if (typeof value !== 'string') return fallback;
  if (/^[1-6]$/.test(value)) return palette.presets[value] ?? fallback;
  return /^#[\da-f]{3,8}$/i.test(value) ? value : fallback;
}

function edgeColor(palette: CanvasSvgPalette, edge: CanvasEdge): string {
  const value = edge.color;
  if (typeof value !== 'string') return palette.edge;
  if (/^[1-6]$/.test(value)) return palette.presets[value] ?? palette.edge;
  return /^#[\da-f]{3,8}$/i.test(value) ? value : palette.edge;
}

function edgeBend(edge: CanvasEdge): { x: number; y: number } {
  const obsidium = edge.obsidium;
  if (!obsidium || typeof obsidium !== 'object' || !('bend' in obsidium) || !obsidium.bend) return { x: 0, y: 0 };
  const bend = obsidium.bend;
  if (typeof bend !== 'object') return { x: 0, y: 0 };
  return {
    x: 'x' in bend && typeof bend.x === 'number' && Number.isFinite(bend.x) ? bend.x : 0,
    y: 'y' in bend && typeof bend.y === 'number' && Number.isFinite(bend.y) ? bend.y : 0,
  };
}

function edgeRoute(edge: CanvasEdge): CanvasEdgeRoute {
  const obsidium = edge.obsidium;
  if (!obsidium || typeof obsidium !== 'object' || !('route' in obsidium)) return 'straight';
  return obsidium.route === 'elbow' || obsidium.route === 'curved' ? obsidium.route : 'straight';
}

function nodeShape(node: CanvasTypedNode): string | null {
  const obsidium = node.obsidium;
  if (!obsidium || typeof obsidium !== 'object' || !('shape' in obsidium) || typeof obsidium.shape !== 'string') return null;
  return obsidium.shape;
}

function isTransparentFill(node: CanvasTypedNode): boolean {
  const obsidium = node.obsidium;
  return Boolean(obsidium && typeof obsidium === 'object' && 'fill' in obsidium && obsidium.fill === 'transparent');
}

function fileTitle(node: CanvasTypedNode): string {
  if (node.type !== 'file') return '';
  return node.file.split(/[\\/]/).pop() ?? node.file;
}

function groupLabel(node: CanvasTypedNode): string {
  if (node.type !== 'group' || typeof node.label !== 'string') return '';
  return node.label;
}

function linkTarget(node: CanvasTypedNode): string {
  return node.type === 'link' ? node.url : '';
}

const PLAIN_TEXT_SIZE = 14;
const PLAIN_TEXT_LINE_HEIGHT = 20;
const PLAIN_TEXT_CHAR_WIDTH = 7.6;

function plainTextLines(markdown: string, box: ForeignObjectBox): string[] {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const limit = Math.max(1, Math.floor(box.width / PLAIN_TEXT_CHAR_WIDTH));
  const lines: string[] = [];
  for (const paragraph of plain) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > limit) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
      while (line.length > limit) {
        lines.push(line.slice(0, limit));
        line = line.slice(limit);
      }
    }
    if (line) lines.push(line);
  }
  const maxLines = Math.max(1, Math.floor(box.height / PLAIN_TEXT_LINE_HEIGHT));
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length > 0) {
    visible[visible.length - 1] = `${visible[visible.length - 1].slice(0, Math.max(1, limit - 1))}…`;
  }
  return visible;
}

function plainTextBody(box: ForeignObjectBox, markdown: string, context: CanvasSvgContext, centered = false): string {
  const lines = plainTextLines(markdown, box);
  const x = centered ? box.x + box.width / 2 : box.x;
  const top = centered && lines.length === 1
    ? box.y + box.height / 2 + PLAIN_TEXT_SIZE * 0.35
    : box.y + PLAIN_TEXT_SIZE;
  const spans = lines.map((line, index) => (
    `<tspan x="${number(x)}" y="${number(top + index * PLAIN_TEXT_LINE_HEIGHT)}">${escapeXml(line)}</tspan>`
  )).join('');
  const anchor = centered ? ' text-anchor="middle"' : '';
  return `<text font-family="sans-serif" font-size="${PLAIN_TEXT_SIZE}" fill="${escapeXml(context.palette.ink)}"${anchor}>${spans}</text>`;
}

function markdownBody(markdown: string, context: CanvasSvgContext): string {
  const style = [
    'font:14px sans-serif',
    `color:${context.palette.ink}`,
    'white-space:normal',
    'word-break:break-word',
    'overflow:hidden',
    'line-height:1.4',
  ].join(';');
  return `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(style)}">${xmlSafeHtml(renderMarkdownToHtml(markdown))}</div>`;
}

interface ForeignObjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function foreignObject(box: ForeignObjectBox, markdown: string, context: CanvasSvgContext, centered = false): string {
  const clipped = {
    x: box.x,
    y: box.y,
    width: Math.max(1, box.width),
    height: Math.max(1, box.height),
  };
  if (context.textMode === 'svg') return plainTextBody(clipped, markdown, context, centered);
  return `<foreignObject x="${number(clipped.x)}" y="${number(clipped.y)}" width="${number(clipped.width)}" height="${number(clipped.height)}">${markdownBody(markdown, context)}</foreignObject>`;
}

function insetBox(node: CanvasTypedNode, inset: number): ForeignObjectBox {
  return {
    x: node.x + inset,
    y: node.y + inset,
    width: node.width - inset * 2,
    height: node.height - inset * 2,
  };
}

function shapeBox(node: CanvasTypedNode, shape: string): ForeignObjectBox {
  if (shape === 'number') return insetBox(node, 4);
  if (shape === 'diamond') {
    return {
      x: node.x + node.width * 0.18,
      y: node.y + node.height * 0.22,
      width: node.width * 0.64,
      height: node.height * 0.56,
    };
  }
  if (shape === 'ellipse') {
    return {
      x: node.x + node.width * 0.16,
      y: node.y + node.height * 0.14,
      width: node.width * 0.68,
      height: node.height * 0.72,
    };
  }
  return insetBox(node, 12);
}

function textElement(x: number, y: number, label: string, fill: string, extra = ''): string {
  return `<text x="${number(x)}" y="${number(y)}" font-family="sans-serif" font-size="12" fill="${escapeXml(fill)}"${extra}>${escapeXml(label)}</text>`;
}

function groupNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  const label = groupLabel(node);
  const rect = `<rect x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" fill="none" stroke="${escapeXml(context.palette.border)}" stroke-width="1" stroke-dasharray="6 4" />`;
  return `<g>${rect}${label ? textElement(node.x + 8, node.y + 18, label, context.palette.ink) : ''}</g>`;
}

function freehandNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  return `<g transform="translate(${number(node.x)} ${number(node.y)})"><path d="${escapeXml(canvasFreehandPath(canvasFreehandPoints(node)))}" fill="none" stroke="${escapeXml(context.shapeStroke(node))}" stroke-width="${SHAPE_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" /></g>`;
}

function shapedTextNode(node: CanvasTypedNode, shape: string, context: CanvasSvgContext): string {
  const fill = isTransparentFill(node) ? 'none' : context.shapeFill(node);
  const outline = `fill="${escapeXml(fill)}" stroke="${escapeXml(context.shapeStroke(node))}" stroke-width="${SHAPE_STROKE_WIDTH}" />`;
  const geometry = shape === 'diamond'
    ? `<polygon points="${[
      [node.x + node.width / 2, node.y],
      [node.x + node.width, node.y + node.height / 2],
      [node.x + node.width / 2, node.y + node.height],
      [node.x, node.y + node.height / 2],
    ].map(([x, y]) => `${number(x)},${number(y)}`).join(' ')}" ${outline}`
    : shape === 'ellipse' || shape === 'number'
      ? `<ellipse cx="${number(node.x + node.width / 2)}" cy="${number(node.y + node.height / 2)}" rx="${number(node.width / 2)}" ry="${number(node.height / 2)}" ${outline}`
      : `<rect x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" rx="10" ${outline}`;
  const markdown = context.markdown(node);
  return `<g>${geometry}${markdown ? foreignObject(shapeBox(node, shape), markdown, context, shape === 'number') : ''}</g>`;
}

function mediaNode(node: CanvasTypedNode, media: CanvasSvgMedia, context: CanvasSvgContext): string {
  if (media.kind === 'image') {
    return `<image href="${escapeXml(context.imageHref(media.src))}" x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid meet" />`;
  }
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const size = Math.min(40, node.width * 0.25, node.height * 0.25);
  const label = media.label
    ? `<text x="${number(centerX)}" y="${number(centerY + size * 0.5 + 18)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${escapeXml(context.palette.ink)}">${escapeXml(media.label)}</text>`
    : '';
  return `<g><rect x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" rx="10" fill="${escapeXml(context.palette.card)}" stroke="${escapeXml(context.palette.border)}" stroke-width="1" /><polygon points="${number(centerX - size * 0.35)},${number(centerY - size * 0.5)} ${number(centerX + size * 0.65)},${number(centerY)} ${number(centerX - size * 0.35)},${number(centerY + size * 0.5)}" fill="${escapeXml(context.palette.ink)}" />${label}</g>`;
}

function fileNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  const media = context.media(node);
  if (media) return mediaNode(node, media, context);
  const frame = `<rect x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" rx="10" fill="${escapeXml(nodeColor(context.palette, node, context.palette.card))}" stroke="${escapeXml(context.palette.border)}" stroke-width="1" />`;
  const markdown = context.markdown(node);
  return `<g>${frame}${textElement(node.x + 12, node.y + 22, fileTitle(node), context.palette.ink, ' font-weight="600"')}${markdown ? foreignObject({ x: node.x + 12, y: node.y + 32, width: node.width - 24, height: node.height - 44 }, markdown, context) : ''}</g>`;
}

function linkNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  const media = context.media(node);
  if (media && media.kind === 'image') return mediaNode(node, media, context);
  const frame = `<rect x="${number(node.x)}" y="${number(node.y)}" width="${number(node.width)}" height="${number(node.height)}" rx="10" fill="${escapeXml(nodeColor(context.palette, node, context.palette.card))}" stroke="${escapeXml(context.palette.border)}" stroke-width="1" />`;
  return `<g>${frame}${textElement(node.x + 12, node.y + 22, linkTarget(node), context.palette.ink)}</g>`;
}

function textNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  const shape = nodeShape(node);
  if (shape === 'freehand') return freehandNode(node, context);
  if (shape === 'rectangle' || shape === 'diamond' || shape === 'ellipse' || shape === 'number') {
    return shapedTextNode(node, shape, context);
  }
  const markdown = context.markdown(node);
  return markdown ? foreignObject(insetBox(node, 12), markdown, context) : '';
}

function renderNode(node: CanvasTypedNode, context: CanvasSvgContext): string {
  if (node.type === 'group') return groupNode(node, context);
  if (node.type === 'text') return textNode(node, context);
  if (node.type === 'file') return fileNode(node, context);
  if (node.type === 'link') return linkNode(node, context);
  return '';
}

function renderEdgeLabel(edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>, context: CanvasSvgContext): string {
  if (typeof edge.label !== 'string' || !edge.label) return '';
  const geometry = getCanvasEdgeGeometry(edge, nodes);
  if (!geometry) return '';
  const bend = edgeBend(edge);
  const { palette } = context;
  return `<text x="${number((geometry.from.x + geometry.to.x) / 2 + bend.x)}" y="${number((geometry.from.y + geometry.to.y) / 2 + bend.y - 8)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${escapeXml(palette.ink)}" stroke="${escapeXml(palette.paper)}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${escapeXml(edge.label)}</text>`;
}

export function canvasSvg(document: CanvasDocument, context: CanvasSvgContext): string {
  const { palette } = context;
  const nodes = document.nodes;
  const nodeIndex = new Map<string, CanvasNode>(nodes.map(node => [node.id, node]));

  const markerColors: string[] = [];
  const edges = document.edges.map(edge => {
    const geometry = getCanvasEdgeGeometry(edge, nodeIndex);
    if (!geometry) return '';
    const stroke = edgeColor(palette, edge);
    let markerIndex = markerColors.indexOf(stroke);
    if (markerIndex < 0) {
      markerIndex = markerColors.length;
      markerColors.push(stroke);
    }
    const start = edge.fromEnd === 'arrow' ? ` marker-start="url(#${MARKER_ID_PREFIX}-start-${markerIndex})"` : '';
    const end = edge.toEnd === 'none' ? '' : ` marker-end="url(#${MARKER_ID_PREFIX}-end-${markerIndex})"`;
    const path = `<path d="${escapeXml(getCanvasEdgePath(geometry, edgeRoute(edge), edgeBend(edge)))}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="2"${start}${end} />`;
    return `${path}${renderEdgeLabel(edge, nodeIndex, context)}`;
  }).filter(Boolean);

  const left = nodes.length ? Math.min(...nodes.map(node => node.x)) - PADDING : 0;
  const top = nodes.length ? Math.min(...nodes.map(node => node.y)) - PADDING : 0;
  const right = nodes.length ? Math.max(...nodes.map(node => node.x + node.width)) + PADDING : 1;
  const bottom = nodes.length ? Math.max(...nodes.map(node => node.y + node.height)) + PADDING : 1;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const defs = markerColors.length
    ? `<defs>${markerColors.map((color, index) => `<marker id="${MARKER_ID_PREFIX}-end-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXml(color)}" /></marker><marker id="${MARKER_ID_PREFIX}-start-${index}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="userSpaceOnUse" orient="auto"><path d="M 10 0 L 0 5 L 10 10 z" fill="${escapeXml(color)}" /></marker>`).join('')}</defs>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${number(width)}" height="${number(height)}" viewBox="${number(left)} ${number(top)} ${number(width)} ${number(height)}">`,
    defs,
    `<rect x="${number(left)}" y="${number(top)}" width="${number(width)}" height="${number(height)}" fill="${escapeXml(palette.paper)}" />`,
    edges.join(''),
    nodes.map(node => renderNode(node, context)).filter(Boolean).join(''),
    '</svg>',
  ].join('');
}

export function canvasSvgAssetSources(
  document: CanvasDocument,
  media: (node: CanvasTypedNode) => CanvasSvgMedia | null,
): string[] {
  const sources: string[] = [];
  for (const node of document.nodes) {
    const resolved = media(node);
    if (resolved && resolved.kind === 'image' && resolved.src && !sources.includes(resolved.src)) {
      sources.push(resolved.src);
    }
  }
  return sources;
}
