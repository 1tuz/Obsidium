import { describe, expect, it, vi } from 'vitest';
import { GpuScene } from './gpuScene';

function scene(edgeBufferBytes: number, arrowBufferBytes = edgeBufferBytes) {
  const gl = {
    ARRAY_BUFFER: 1,
    DYNAMIC_DRAW: 2,
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
  };
  const instance = Object.create(GpuScene.prototype) as GpuScene;
  Object.assign(instance, {
    gl,
    edgeBuffer: {},
    arrowBuffer: {},
    edgeBufferBytes,
    arrowBufferBytes,
  });
  return { instance, gl };
}

describe('GpuScene partial edge uploads', () => {
  it('merges adjacent dirty instances into one bufferSubData upload', () => {
    const { instance, gl } = scene(32);
    const edges = new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4]);

    instance.uploadEdgeUpdates(edges, [2, 1]);

    expect(gl.bufferData).not.toHaveBeenCalled();
    expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledWith(1, 8, new Uint32Array([1, 2, 2, 3]));
  });

  it('grows a GPU buffer only when the active edge view exceeds capacity', () => {
    const { instance, gl } = scene(8);
    const edges = new Uint32Array([0, 1, 1, 2]);

    instance.uploadEdgeUpdates(edges, [1]);

    expect(gl.bufferData).toHaveBeenCalledWith(1, 32, 2);
    expect(gl.bufferSubData).toHaveBeenCalledWith(1, 0, edges);
  });
});
