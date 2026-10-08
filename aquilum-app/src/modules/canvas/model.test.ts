import { describe, expect, it } from 'vitest';
import { addDrawing, addEdge, parseCanvas, removeNode, serializeCanvas, updateNode } from './model';

describe('JSON Canvas model', () => {
  it('round-trips standard and unknown JSON Canvas fields', () => {
    const source = JSON.stringify({
      nodes: [{ id: 'n1', type: 'text', x: 1, y: 2, width: 300, height: 120, text: 'Hello', pluginKey: 7 }],
      edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n1', toEnd: 'arrow' }],
      pluginTopLevel: { keep: true },
    });
    const parsed = parseCanvas(source);
    const stored = JSON.parse(serializeCanvas(parsed));
    expect(stored.pluginTopLevel).toEqual({ keep: true });
    expect(stored.nodes[0].pluginKey).toBe(7);
    expect(stored.edges[0].toEnd).toBe('arrow');
  });

  it('adds a connector only when both endpoints exist', () => {
    const parsed = parseCanvas(JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 100, text: 'B' },
      ],
      edges: [],
    }));
    const connected = addEdge(parsed, { id: 'ab', fromNode: 'a', toNode: 'b', toEnd: 'arrow' });
    expect(connected.edges).toHaveLength(1);
    expect(addEdge(parsed, { id: 'missing', fromNode: 'a', toNode: 'x' }).edges).toHaveLength(0);
  });

  it('removes edges connected to a deleted node', () => {
    const parsed = parseCanvas(JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'A' },
        { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 100, text: 'B' },
      ],
      edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
    }));
    const next = removeNode(parsed, 'a');
    expect(next.nodes.map((node) => node.id)).toEqual(['b']);
    expect(next.edges).toEqual([]);
  });

  it('keeps drawing data in an extension without changing standard node types', () => {
    const parsed = parseCanvas('{"nodes":[],"edges":[]}');
    const next = addDrawing(parsed, {
      id: 'stroke', kind: 'freehand', points: [0, 0, 10, 20], strokeWidth: 3,
    });
    const stored = JSON.parse(serializeCanvas(next));
    expect(stored.nodes).toEqual([]);
    expect(stored.obsidium.drawings[0].kind).toBe('freehand');
  });

  it('moves a node without rewriting its unknown metadata', () => {
    const parsed = parseCanvas(JSON.stringify({
      nodes: [{ id: 'n1', type: 'file', x: 0, y: 0, width: 200, height: 100, file: 'Note.md', custom: 'keep' }],
      edges: [],
    }));
    const moved = updateNode(parsed, 'n1', { x: 50, y: 75 });
    expect(moved.nodes[0].x).toBe(50);
    expect(moved.nodes[0].y).toBe(75);
    expect(moved.nodes[0].custom).toBe('keep');
  });
});
