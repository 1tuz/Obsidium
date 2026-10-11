import { describe, expect, it, vi } from 'vitest';
import { LabelLayer } from './labelLayer';
import type { LabelSprites } from './labelSprites';
import type { NoteLabels } from './noteLabels';
import type { LabelScene } from './labelCandidates';

function layerFixture() {
  const place = vi.fn();
  const sprites = {
    atlas: {
      capacity: 140,
      configure: vi.fn(),
      reserve: vi.fn(),
      fit: (title: string) => title,
      slot: () => ({ u0: 0, v0: 0, u1: 1, v1: 1, cssWidth: 20, cssHeight: 12 }),
    },
    begin: vi.fn(),
    place,
  } as unknown as LabelSprites;
  const labels = {
    get: () => ({ path: 'note.md', title: 'note' }),
    request: vi.fn(),
  } as unknown as NoteLabels;
  const layer = new LabelLayer(sprites, labels);
  layer.resize(200, 100);
  const scene: LabelScene = {
    nodes: {
      nodeCount: 1,
      x: () => 0,
      y: () => 0,
      degree: () => 1,
      createdDay: () => 0,
      modifiedDay: () => 0,
    } as LabelScene['nodes'],
    grid: {
      cell: 2,
      columns: 1,
      rows: 1,
      minX: -1,
      minY: -1,
      offsets: new Uint32Array([0, 1]),
      nodes: new Uint32Array([0]),
    },
    centerX: 0,
    centerY: 0,
    scale: 100,
    sizeScale: 1,
    spread: 1,
    createdFrom: 0,
    modifiedFrom: 0,
    hovered: -1,
  };
  return { layer, place, scene };
}

describe('LabelLayer motion', () => {
  it('shows labels at full opacity immediately when animation is disabled', () => {
    const { layer, place, scene } = layerFixture();

    expect(layer.draw(scene, 0, () => 1, false)).toBe(false);
    expect(place).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.any(Number),
      1,
      1,
      false,
    );
  });

  it('removes a fading label in the same draw when animation is disabled', () => {
    const { layer, place, scene } = layerFixture();
    layer.draw(scene, 0, () => 1, true);
    place.mockClear();

    expect(layer.draw({ ...scene, includedNodes: new Uint8Array([0]) }, 0, () => 1, false)).toBe(false);
    expect(place).not.toHaveBeenCalled();
  });
});
