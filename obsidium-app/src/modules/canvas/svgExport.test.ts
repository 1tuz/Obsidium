import { describe, expect, it } from 'vitest';
import type { CanvasDocument, CanvasTextNode, CanvasTypedNode } from './model';
import { canvasSvg, canvasSvgAssetSources, xmlSafeHtml } from './svgExport';
import type { CanvasSvgContext, CanvasSvgMedia, CanvasSvgPalette } from './svgExport';

const PALETTE: CanvasSvgPalette = {
  paper: '#fafafa',
  ink: '#101010',
  card: '#ffffff',
  border: '#cccccc',
  edge: '#888888',
  presets: {
    '1': '#d32f2f',
    '2': '#f57c00',
    '3': '#fbc02d',
    '4': '#388e3c',
    '5': '#0288d1',
    '6': '#7b1fa2',
  },
};

const document = (nodes: CanvasTypedNode[], edges: CanvasDocument['edges'] = []): CanvasDocument => ({ nodes, edges });

const context = (overrides: Partial<CanvasSvgContext> = {}): CanvasSvgContext => ({
  palette: PALETTE,
  media: () => null,
  imageHref: (src) => src,
  markdown: (node) => (node.type === 'text' ? node.text : ''),
  resolveImage: (_node, target) => `asset://${target}`,
  shapeStroke: (node) => (typeof node.color === 'string' && /^[1-6]$/.test(node.color)
    ? PALETTE.presets[node.color] ?? PALETTE.edge
    : PALETTE.edge),
  shapeFill: () => PALETTE.card,
  ...overrides,
});

const textNode = (fields: Partial<CanvasTextNode> = {}): CanvasTextNode => ({
  id: 'text-1',
  type: 'text',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  text: 'hello',
  ...fields,
});

describe('canvasSvg', () => {
  it('translates freehand geometry into the node origin', () => {
    const node = textNode({
      id: 'freehand',
      x: 300,
      y: 200,
      obsidium: { shape: 'freehand', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 30 }] },
    });
    const svg = canvasSvg(document([node]), context());

    expect(svg).toContain('<g transform="translate(300 200)">');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('M 0 0');
  });

  it('exports an image file node with the injected data url and no file name text', () => {
    const node: CanvasTypedNode = {
      id: 'image',
      type: 'file',
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      file: 'assets/cover.png',
    };
    const media = (): CanvasSvgMedia | null => ({ kind: 'image', src: 'data:image/png;base64,AAAA', label: 'cover.png' });
    const svg = canvasSvg(document([node]), context({ media, imageHref: (src) => src }));

    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).not.toContain('cover.png');
  });

  it('resolves preset colors to palette hex instead of css variables', () => {
    const node = textNode({ id: 'colored', color: '4', obsidium: { shape: 'rectangle' } });
    const svg = canvasSvg(document([node]), context());

    expect(svg).toContain(PALETTE.presets['4']);
    expect(svg).not.toContain('var(');
  });

  it('paints the paper background before any content', () => {
    const svg = canvasSvg(document([textNode()]), context());
    const background = svg.indexOf(`fill="${PALETTE.paper}"`);

    expect(background).toBeGreaterThan(svg.indexOf('<svg'));
    expect(background).toBeLessThan(svg.indexOf('<foreignObject'));
  });

  it('renders diamonds as polygons without clipping', () => {
    const node = textNode({ id: 'diamond', obsidium: { shape: 'diamond' } });
    const svg = canvasSvg(document([node]), context());

    expect(svg).toContain('<polygon points=');
    expect(svg).not.toContain('clip-path');
  });

  it('exports every node regardless of viewport', () => {
    const nodes = [
      textNode({ id: 'near', x: 10, y: 10, width: 20, height: 20, text: 'near' }),
      textNode({ id: 'far', x: 4000, y: 3000, width: 20, height: 20, text: 'far-away' }),
    ];
    const svg = canvasSvg(document(nodes), context());

    expect(svg).toContain('near');
    expect(svg).toContain('far-away');
    expect(svg).toContain('viewBox="-14 -14 4058 3058"');
  });

  it('applies the edge bend to label placement and emits routed paths', () => {
    const doc = document(
      [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'a' },
        { id: 'b', type: 'text', x: 300, y: 0, width: 100, height: 60, text: 'b' },
      ],
      [{
        id: 'e1',
        fromNode: 'a',
        toNode: 'b',
        label: 'names the link',
        color: '2',
        obsidium: { route: 'curved', bend: { x: 0, y: -40 } },
      }],
    );
    const svg = canvasSvg(doc, context());

    expect(svg).toContain('markerUnits="userSpaceOnUse"');
    expect(svg).toContain(`fill="${PALETTE.presets['2']}"`);
    expect(svg).toContain('names the link');
    expect(svg).toMatch(/<text x="200" y="-18"/);
    expect(svg).toContain('paint-order="stroke"');
    expect(svg).toContain(' Q ');
  });

  it('emits one marker per distinct edge color', () => {
    const doc = document(
      [
        { id: 'a', type: 'text', x: 0, y: 0, width: 60, height: 60, text: 'a' },
        { id: 'b', type: 'text', x: 220, y: 0, width: 60, height: 60, text: 'b' },
        { id: 'c', type: 'text', x: 440, y: 0, width: 60, height: 60, text: 'c' },
      ],
      [
        { id: 'e1', fromNode: 'a', toNode: 'b', color: '1' },
        { id: 'e2', fromNode: 'b', toNode: 'c', color: '1' },
        { id: 'e3', fromNode: 'a', toNode: 'c' },
      ],
    );
    const svg = canvasSvg(doc, context());

    expect(svg.match(/<marker /g)?.length).toBe(4);
    expect(svg).toContain('marker-end="url(#canvas-arrow-end-0)"');
    expect(svg).toContain('marker-end="url(#canvas-arrow-end-1)"');
    expect(svg).toContain('<marker id="canvas-arrow-start-0"');
  });

  it('makes markdown xhtml xml-safe', () => {
    const node = textNode({ id: 'md', text: 'line one\nline two &copy; &amp; <b>' });
    const svg = canvasSvg(document([node]), context());
    const html = xmlSafeHtml('a<br>b<hr><img src="x">&copy; &amp; &unknown;');

    expect(html).toBe('a<br />b<hr /><img src="x" />&#169; &amp; &amp;unknown;');
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).not.toContain('&copy;');
  });

  it('renders a video placeholder with a play triangle', () => {
    const node: CanvasTypedNode = { id: 'video', type: 'file', x: 0, y: 0, width: 320, height: 200, file: 'clip.mp4' };
    const svg = canvasSvg(document([node]), context({
      media: () => ({ kind: 'video', src: 'clip.mp4', label: 'clip.mp4' }),
    }));

    expect(svg).toContain('<polygon');
    expect(svg).toContain('clip.mp4');
    expect(svg).not.toContain('<image');
  });
});

describe('canvasSvgAssetSources', () => {
  it('collects image sources and deduplicates them', () => {
    const nodes: CanvasTypedNode[] = [
      { id: 'f1', type: 'file', x: 0, y: 0, width: 10, height: 10, file: 'a.png' },
      { id: 'f2', type: 'file', x: 0, y: 0, width: 10, height: 10, file: 'a.png' },
      { id: 'f3', type: 'file', x: 0, y: 0, width: 10, height: 10, file: 'b.mp4' },
      { id: 'f4', type: 'file', x: 0, y: 0, width: 10, height: 10, file: 'notes.md' },
    ];
    const sources = canvasSvgAssetSources(document(nodes), (node) => {
      if (node.type !== 'file') return null;
      if (node.file === 'a.png') return { kind: 'image', src: 'assets/a.png', label: 'a.png' };
      if (node.file === 'b.mp4') return { kind: 'video', src: 'assets/b.mp4', label: 'b.mp4' };
      return null;
    });

    expect(sources).toEqual(['assets/a.png']);
  });
});
