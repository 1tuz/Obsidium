import { describe, expect, it } from 'vitest';
import { readCanvasAppearance } from './nodeProps';
import { canvasSvg, type CanvasSvgContext } from './svgExport';
import type { CanvasDocument } from './model';

const context = (overrides: Partial<CanvasSvgContext> = {}): CanvasSvgContext => ({
  palette: {
    paper: '#faf9f6',
    ink: '#292824',
    card: '#f4f2ed',
    border: '#d8d5cd',
    edge: '#6f6b62',
    presets: {},
  },
  media: () => null,
  imageHref: (src) => src,
  markdown: (node) => node.type === 'text' ? node.text : '',
  resolveImage: (_node, target) => target,
  shapeStroke: () => '#6f6b62',
  shapeFill: () => '#e6e2da',
  appearance: (node) => readCanvasAppearance(node),
  ...overrides,
});

const doc = (nodes: CanvasDocument['nodes']): CanvasDocument => ({ nodes, edges: [] });

describe('canvasSvg raster mode', () => {
  it('uses plain SVG text instead of foreignObject so the canvas stays untainted', () => {
    const svg = canvasSvg(doc([
      { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 120, text: 'A **bold** sentence that wraps.' },
    ]), context({ textMode: 'svg' }));

    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('<text');
    expect(svg).toContain('<tspan');
    expect(svg).not.toContain('**');
  });

  it('wraps long lines on word boundaries and truncates overflow with an ellipsis', () => {
    const svg = canvasSvg(doc([
      { id: 'a', type: 'text', x: 0, y: 0, width: 120, height: 100, text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu' },
    ]), context({ textMode: 'svg' }));

    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
    expect(lines.some((line) => line.startsWith('alpha beta'))).toBe(true);
  });

  it('centers a single-line number marker inside its ellipse', () => {
    const svg = canvasSvg(doc([
      { id: 'n', type: 'text', x: 0, y: 0, width: 64, height: 64, text: '7', obsidium: { shape: 'number' } },
    ]), context({ textMode: 'svg' }));

    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('<ellipse');
  });

  it('drops the frontmatter before drawing a note in raster mode', () => {
    const note = '---\ntitle: Packet access\ntype: note\npermalink: appfarm/access\n---\n\n# Packet access\n\nBody text.';
    const svg = canvasSvg(doc([
      { id: 'f', type: 'file', x: 0, y: 0, width: 240, height: 160, file: 'Access.md' },
    ]), context({ textMode: 'svg', markdown: () => note }));

    expect(svg).not.toContain('permalink');
    expect(svg).not.toContain('---');
    expect(svg).toContain('Packet access');
    expect(svg).toContain('Body text.');
  });

  it('keeps rich HTML text for the SVG file export', () => {
    const svg = canvasSvg(doc([
      { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 120, text: 'A **bold** sentence.' },
    ]), context());

    expect(svg).toContain('foreignObject');
    expect(svg).toContain('<strong>');
  });
});
