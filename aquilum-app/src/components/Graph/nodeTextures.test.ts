import { describe, expect, it, vi } from 'vitest';
import { NodeTextures } from './nodeTextures';
import { NODE_TEXTURE_WIDTH } from './nodeMetrics';

describe('NodeTextures', () => {
  it('packs Louvain IDs, islands, and custom color slots into one texture', () => {
    const texImage2D = vi.fn((..._args: unknown[]) => {});
    const gl = {
      createTexture: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D,
      TEXTURE_2D: 1,
      TEXTURE_MIN_FILTER: 2,
      TEXTURE_MAG_FILTER: 3,
      TEXTURE_WRAP_S: 4,
      TEXTURE_WRAP_T: 5,
      NEAREST: 6,
      CLAMP_TO_EDGE: 7,
      RGBA32F: 8,
      RGBA: 9,
      FLOAT: 10,
    } as unknown as WebGL2RenderingContext;
    const textures = new NodeTextures(gl);

    textures.uploadClusters(new Uint32Array([4, 9]), new Uint8Array([0, 1]), 1, new Uint32Array([259, 256]));

    expect(texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      NODE_TEXTURE_WIDTH,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      expect.any(Float32Array),
    );
    const values = texImage2D.mock.calls[0][8] as Float32Array;
    expect([...values.slice(0, 8)]).toEqual([4, 0, 259, 0, 9, 1, 256, 0]);
    expect(values).toHaveLength(NODE_TEXTURE_WIDTH * 4);
  });

  it('uploads the ordered custom group palette into a compact float texture', () => {
    const texImage2D = vi.fn((..._args: unknown[]) => {});
    const gl = {
      createTexture: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D,
      TEXTURE_2D: 1,
      TEXTURE_MIN_FILTER: 2,
      TEXTURE_MAG_FILTER: 3,
      TEXTURE_WRAP_S: 4,
      TEXTURE_WRAP_T: 5,
      NEAREST: 6,
      CLAMP_TO_EDGE: 7,
      RGBA32F: 8,
      RGBA: 9,
      FLOAT: 10,
    } as unknown as WebGL2RenderingContext;
    const textures = new NodeTextures(gl);
    const colors = new Float32Array([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1]);

    textures.uploadCustomGroupColors(colors);

    expect(texImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, gl.RGBA32F, 2, 1, 0, gl.RGBA, gl.FLOAT, colors);
  });

  it('uploads one freshness texel with a one-pixel R32F subimage', () => {
    const texSubImage2D = vi.fn();
    const gl = {
      createTexture: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      texSubImage2D,
      TEXTURE_2D: 1,
      TEXTURE_MIN_FILTER: 2,
      TEXTURE_MAG_FILTER: 3,
      TEXTURE_WRAP_S: 4,
      TEXTURE_WRAP_T: 5,
      NEAREST: 6,
      CLAMP_TO_EDGE: 7,
      R32F: 8,
      RGBA: 9,
      RED: 10,
      FLOAT: 11,
    } as unknown as WebGL2RenderingContext;
    const textures = new NodeTextures(gl);
    const days = new Float32Array([10, 20, 30]);

    textures.uploadFreshnessNode(days, 2);

    expect(texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      2,
      0,
      1,
      1,
      gl.RED,
      gl.FLOAT,
      new Float32Array([30]),
    );
  });
});
