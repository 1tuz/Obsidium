import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addCanvasEdge,
  canvasFreehandPoints,
  createCanvasFreehandNode,
  duplicateCanvasNode,
  parseCanvasDocument,
  removeCanvasEdge,
  removeCanvasNode,
  serializeCanvasDocument,
  updateCanvasEdge,
  updateCanvasNode,
} from './model';

const obsidianCanvas = JSON.stringify({
  nodes: [
    { id: 'text-1', type: 'text', x: 40, y: 80, width: 320, height: 180, text: '# Heading\nBody', obsidium: { shape: 'ellipse' }, customNodeField: { keep: true } },
    { id: 'file-1', type: 'file', x: 420, y: 80, width: 260, height: 180, file: 'Notes/Idea.md', color: '4' },
    { id: 'link-1', type: 'link', x: 40, y: 320, width: 260, height: 100, url: 'https://example.com' },
    { id: 'group-1', type: 'group', x: 380, y: 300, width: 400, height: 260, label: 'Research', background: 'var(--canvas)' },
  ],
  edges: [{ id: 'edge-1', fromNode: 'text-1', toNode: 'file-1', fromSide: 'right', toSide: 'left', label: 'supports', color: '5', customEdgeField: 42 }],
  customRootField: 'preserve me',
  obsidium: { camera: { x: 12, y: 34, zoom: 1.2 }, paper: 'ivory' },
});

describe('Canvas JSON model', () => {
  it('parses and serializes JSON Canvas nodes, edges, extensions, and unknown fields', () => {
    const parsed = parseCanvasDocument(obsidianCanvas);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const roundTrip = parseCanvasDocument(serializeCanvasDocument(parsed.value));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.value).toMatchObject({
      customRootField: 'preserve me',
      nodes: [{ id: 'text-1', obsidium: { shape: 'ellipse' }, customNodeField: { keep: true } }, {}, {}, {}],
      edges: [{ customEdgeField: 42, label: 'supports', fromSide: 'right' }],
      obsidium: { camera: { x: 12, y: 34, zoom: 1.2 }, paper: 'ivory' },
    });
  });

  it('returns explicit errors for malformed JSON and invalid document structure', () => {
    expect(parseCanvasDocument('{')).toEqual({ ok: false, error: 'Invalid JSON' });
    expect(parseCanvasDocument('{"nodes":[]}')).toMatchObject({ ok: true, value: { nodes: [], edges: [] } });
    expect(parseCanvasDocument('{}')).toMatchObject({ ok: true, value: { nodes: [], edges: [] } });
    expect(parseCanvasDocument('{"nodes":[{"id":"n","type":"text"}],"edges":[]}')).toEqual({
      ok: false,
      error: 'nodes[0].x must be a finite number',
    });
  });

  it('accepts fractional coordinates and dimensions without altering them', () => {
    expect(parseCanvasDocument('{"nodes":[{"id":"n","type":"text","x":214.4296875,"y":254.7265625,"width":554.5,"height":365.25,"text":""}],"edges":[]}'))
      .toMatchObject({ ok: true, value: { nodes: [{ x: 214.4296875, y: 254.7265625, width: 554.5, height: 365.25 }] } });
  });

  it('rejects duplicate IDs, dangling edges, non-positive geometry, and invalid endpoints', () => {
    expect(parseCanvasDocument('{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":2,"height":2,"text":""},{"id":"n","type":"text","x":0,"y":0,"width":2,"height":2,"text":""}],"edges":[]}').ok).toBe(false);
    expect(parseCanvasDocument('{"nodes":[],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}').ok).toBe(false);
    expect(parseCanvasDocument('{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":0,"height":2,"text":""}],"edges":[]}').ok).toBe(false);
    expect(parseCanvasDocument('{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":2,"height":2,"text":""}],"edges":[{"id":"e","fromNode":"n","toNode":"n","fromEnd":"circle"}]}').ok).toBe(false);
  });

  it('updates and removes nodes immutably while retaining extensions and removing attached edges', () => {
    const parsed = parseCanvasDocument(obsidianCanvas);
    if (!parsed.ok) throw new Error(parsed.error);
    const updated = updateCanvasNode(parsed.value, 'text-1', { x: 90 });
    expect(parsed.value.nodes[0].x).toBe(40);
    expect(updated.nodes[0]).toMatchObject({ x: 90, customNodeField: { keep: true } });
    const duplicated = duplicateCanvasNode(updated, 'text-1', 'text-2');
    expect(duplicated.nodes[duplicated.nodes.length - 1]).toMatchObject({ id: 'text-2', x: 110, y: 100, customNodeField: { keep: true } });
    const removed = removeCanvasNode(duplicated, 'file-1');
    expect(removed.nodes.some(node => node.id === 'file-1')).toBe(false);
    expect(removed.edges).toEqual([]);
    expect(removed.obsidium).toEqual(parsed.value.obsidium);
  });

  it('adds, updates, and removes edges immutably', () => {
    const parsed = parseCanvasDocument('{"nodes":[],"edges":[],"layout":"freeform"}');
    if (!parsed.ok) throw new Error(parsed.error);
    const added = addCanvasEdge(parsed.value, { id: 'e', fromNode: 'a', toNode: 'b', color: '1', privateField: true });
    const updated = updateCanvasEdge(added, 'e', { label: 'next' });
    expect(parsed.value.edges).toEqual([]);
    expect(updated.edges[0]).toMatchObject({ label: 'next', color: '1', privateField: true });
    expect(removeCanvasEdge(updated, 'e').edges).toEqual([]);
  });

  it('stores freehand strokes in a portable text node extension', () => {
    const stroke = createCanvasFreehandNode('stroke-1', [{ x: 20.4, y: 30.2 }, { x: 80.1, y: 42.8 }]);
    const parsed = parseCanvasDocument(serializeCanvasDocument({ nodes: [stroke], edges: [] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes[0]).toMatchObject({ type: 'text', text: '', obsidium: { shape: 'freehand' } });
    expect(canvasFreehandPoints(parsed.value.nodes[0])).toEqual([{ x: 8, y: 8 }, { x: 68, y: 21 }]);
    expect(canvasFreehandPoints({ ...stroke, obsidium: { shape: 'freehand', points: [{ x: 'bad', y: 1 }] } })).toEqual([]);
    expect(createCanvasFreehandNode('empty-stroke', []).width).toBe(16);
  });

  it('parses the 1,000-node performance board fixture', () => {
    const source = readFileSync(new URL('./fixtures/large-canvas.canvas', import.meta.url), 'utf8');
    const parsed = parseCanvasDocument(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes).toHaveLength(1000);
    expect(parsed.value.edges).toHaveLength(999);
  });
});
