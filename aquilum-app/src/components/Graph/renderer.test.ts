// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphSnapshot } from '../../modules/graph';
import type { NoteLabels } from './noteLabels';
import { DEFAULT_DISPLAY } from './graphDisplay';
import { GraphRenderer } from './renderer';

vi.mock('./gpuScene', () => ({
  GpuScene: class {
    labels = {};
    textures = {
      uploadNodes: vi.fn(),
      uploadNode: vi.fn(),
      uploadFreshness: vi.fn(),
      uploadFreshnessNode: vi.fn(),
      allocateHighlight: vi.fn(),
      allocateReveal: vi.fn(),
      uploadHighlightRows: vi.fn(),
      uploadRevealRows: vi.fn(),
      uploadClusters: vi.fn(),
      uploadCustomGroupColors: vi.fn(),
    };
    beginFrame = vi.fn();
    uploadEdges = vi.fn();
    uploadArrows = vi.fn();
    uploadEdgeUpdates = vi.fn();
    uploadArrowUpdates = vi.fn();
    uploadTransitionEdges = vi.fn();
    uploadSuggestions = vi.fn();
    setViewport = vi.fn();
    drawEdges = vi.fn();
    drawTransitionEdges = vi.fn();
    drawSuggestedEdges = vi.fn();
    drawNodes = vi.fn();
    drawLabels = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('./labelLayer', () => ({
  LabelLayer: class {
    restyle = vi.fn();
    resize = vi.fn();
    forget = vi.fn();
    clear = vi.fn();
    setDensity = vi.fn();
    draw = vi.fn(() => false);
  },
}));

function snapshot(epoch: number, x: number): GraphSnapshot {
  return {
    nodeCount: 1,
    edgeCount: 0,
    epoch: { low: epoch, high: 0 },
    positions: new Float32Array([x, 0]),
    createdDays: new Float32Array([1]),
    modifiedDays: new Float32Array([1]),
    degrees: new Uint32Array([0]),
    nodeIds: new Uint32Array([1, 0]),
    clusterIds: new Uint32Array([0]),
    edges: new Uint32Array(),
    edgeDirections: new Uint32Array(),
    edgeTypes: new Uint32Array(),
  };
}

describe('GraphRenderer motion settling', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adopts the queued snapshot when motion turns off during a camera transition', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const handle = ++nextFrame;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => frames.delete(handle));
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    document.documentElement.dataset.motion = 'on';
    const canvas = document.createElement('canvas');
    const renderer = new GraphRenderer(canvas, {} as NoteLabels);
    renderer.setSnapshot(snapshot(1, 0));
    renderer.setSnapshot(snapshot(2, 10), true);
    renderer.setSnapshot(snapshot(3, 20), true);
    renderer.fit();

    document.documentElement.dataset.motion = 'off';
    document.documentElement.dispatchEvent(new Event('aquilum-motion-change'));

    expect((renderer as unknown as { store: { snapshot: GraphSnapshot | null } }).store.snapshot?.epoch.low)
      .toBe(3);
    expect(frames.size).toBe(0);
    renderer.dispose();
  });

  it('does not reupload graph edge buffers for node-only topology updates', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const internals = renderer as unknown as {
      scene: {
        uploadEdges: ReturnType<typeof vi.fn>;
        uploadTransitionEdges: ReturnType<typeof vi.fn>;
        textures: { uploadClusters: ReturnType<typeof vi.fn> };
      };
    };
    renderer.setSnapshot(snapshot(1, 0));
    internals.scene.uploadEdges.mockClear();
    internals.scene.uploadTransitionEdges.mockClear();
    internals.scene.textures.uploadClusters.mockClear();

    expect(renderer.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 0,
      edgeCount: 0,
      metricsStale: false,
      nodeUpdates: [{ index: 0, degree: 0, modifiedDay: 2 }],
      edgeUpdates: [],
    }, { low: 1, high: 0 }, 1)).toBe(true);

    expect(internals.scene.uploadEdges).not.toHaveBeenCalled();
    expect(internals.scene.uploadTransitionEdges).not.toHaveBeenCalled();
    expect(internals.scene.textures.uploadClusters).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('uploads only changed arrow ranges when live edge direction metadata changes', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const internals = renderer as unknown as {
      scene: {
        uploadEdges: ReturnType<typeof vi.fn>;
        uploadArrows: ReturnType<typeof vi.fn>;
        uploadEdgeUpdates: ReturnType<typeof vi.fn>;
        uploadArrowUpdates: ReturnType<typeof vi.fn>;
      };
    };
    const graph: GraphSnapshot = {
      ...snapshot(1, 0),
      nodeCount: 2,
      edgeCount: 1,
      positions: new Float32Array([0, 0, 1, 1]),
      createdDays: new Float32Array([1, 1]),
      modifiedDays: new Float32Array([1, 1]),
      degrees: new Uint32Array([1, 1]),
      nodeIds: new Uint32Array([1, 0, 2, 0]),
      clusterIds: new Uint32Array([0, 0]),
      edges: new Uint32Array([0, 1]),
      edgeDirections: new Uint32Array([65]),
      edgeTypes: new Uint32Array([1]),
    };
    renderer.setSnapshot(graph);
    internals.scene.uploadEdges.mockClear();
    internals.scene.uploadArrows.mockClear();

    expect(renderer.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 1,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 0, source: 0, target: 1, directionMask: 1, typeMask: 1 }],
    }, { low: 1, high: 0 }, 1)).toBe(true);

    expect(internals.scene.uploadEdges).not.toHaveBeenCalled();
    expect(internals.scene.uploadArrows).not.toHaveBeenCalled();
    expect(internals.scene.uploadEdgeUpdates).toHaveBeenCalledWith(expect.any(Uint32Array), []);
    expect(internals.scene.uploadArrowUpdates).toHaveBeenCalledTimes(1);
    expect(internals.scene.uploadArrowUpdates).toHaveBeenCalledWith(expect.any(Uint32Array), [1]);
    renderer.dispose();
  });

  it('sends dense add and swap-delete indices to partial GPU uploads', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const internals = renderer as unknown as {
      scene: {
        uploadEdges: ReturnType<typeof vi.fn>;
        uploadArrows: ReturnType<typeof vi.fn>;
        uploadEdgeUpdates: ReturnType<typeof vi.fn>;
        uploadArrowUpdates: ReturnType<typeof vi.fn>;
      };
    };
    const graph: GraphSnapshot = {
      ...snapshot(1, 0),
      nodeCount: 3,
      positions: new Float32Array([0, 0, 1, 1, 2, 2]),
      createdDays: new Float32Array([1, 1, 1]),
      modifiedDays: new Float32Array([1, 1, 1]),
      degrees: new Uint32Array([1, 1, 0]),
      nodeIds: new Uint32Array([1, 0, 2, 0, 3, 0]),
      clusterIds: new Uint32Array([0, 0, 0]),
      edgeCount: 1,
      edges: new Uint32Array([0, 1]),
      edgeDirections: new Uint32Array([1]),
      edgeTypes: new Uint32Array([1]),
    };
    renderer.setSnapshot(graph);
    internals.scene.uploadEdges.mockClear();
    internals.scene.uploadArrows.mockClear();

    expect(renderer.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 2,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 1, source: 0, target: 2, directionMask: 1, typeMask: 1 }],
    }, { low: 1, high: 0 }, 0)).toBe(true);

    expect(internals.scene.uploadEdgeUpdates).toHaveBeenLastCalledWith(expect.any(Uint32Array), [1]);
    expect(internals.scene.uploadArrowUpdates).toHaveBeenLastCalledWith(expect.any(Uint32Array), [1]);
    expect(internals.scene.uploadEdges).not.toHaveBeenCalled();
    expect(internals.scene.uploadArrows).not.toHaveBeenCalled();

    expect(renderer.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 2,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 0, source: 0, target: 1, directionMask: 0, typeMask: 0 }],
    }, { low: 1, high: 0 }, 1)).toBe(true);

    expect(internals.scene.uploadEdgeUpdates).toHaveBeenLastCalledWith(expect.any(Uint32Array), [0]);
    expect(internals.scene.uploadArrowUpdates).toHaveBeenLastCalledWith(expect.any(Uint32Array), [0]);
    renderer.dispose();
  });

  it('settles queued snapshots when the system reduce-motion preference changes', () => {
    const frames = new Map<number, FrameRequestCallback>();
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const handle = ++nextFrame;
      frames.set(handle, callback);
      return handle;
    });
    const cancelAnimationFrame = vi.fn((handle: number) => frames.delete(handle));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const preference = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      }),
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference as unknown as MediaQueryList);
    document.documentElement.dataset.motion = 'system';
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    renderer.setSnapshot(snapshot(1, 0));
    renderer.setSnapshot(snapshot(2, 10), true);
    renderer.setSnapshot(snapshot(3, 20), true);

    preference.matches = true;
    listeners.forEach((listener) => listener.call(
      preference as unknown as MediaQueryList,
      { matches: true, media: '(prefers-reduced-motion: reduce)' } as MediaQueryListEvent,
    ));

    expect((renderer as unknown as { store: { snapshot: GraphSnapshot | null } }).store.snapshot?.epoch.low)
      .toBe(3);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(frames.size).toBe(0);
    renderer.dispose();
  });

  it('passes the persisted custom edge color to WebGL', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const scene = (renderer as unknown as {
      scene: { drawEdges: ReturnType<typeof vi.fn> };
    }).scene;
    renderer.setSnapshot(snapshot(1, 0));
    renderer.applyDisplay({
      ...DEFAULT_DISPLAY,
      edgeColor: 'custom',
      edgeCustomColor: '#1471eb',
    });
    (renderer as unknown as { draw(seconds: number): void }).draw(0);

    const edgePass = scene.drawEdges.mock.calls[scene.drawEdges.mock.calls.length - 1]?.[1];
    expect(edgePass).toMatchObject({
      color: 'custom',
      customColor: '#1471eb',
    });
    renderer.dispose();
  });

  it('uploads per-rule custom colors to the node palette texture', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const textures = (renderer as unknown as {
      scene: { textures: { uploadCustomGroupColors: ReturnType<typeof vi.fn> } };
    }).scene.textures;
    renderer.setSnapshot(snapshot(1, 0));
    renderer.setCustomGroupRules([
      { id: 'tag', field: 'tag', key: '', value: 'research', color: 'cold', customColor: '#1471eb' },
    ]);
    renderer.setCustomGroupIds(new Uint32Array([1]));

    const colors = textures.uploadCustomGroupColors.mock.calls[0][0] as Float32Array;
    [20 / 255, 113 / 255, 235 / 255, 1]
      .forEach((color, index) => expect(colors[index]).toBeCloseTo(color, 6));
    renderer.dispose();
  });

  it('applies sparse modified dates through partial freshness uploads', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    const textures = (renderer as unknown as {
      scene: { textures: { uploadFreshnessNode: ReturnType<typeof vi.fn> } };
    }).scene.textures;
    renderer.setSnapshot(snapshot(1, 0));

    expect(renderer.applyModifiedDateUpdates([{ index: 0, modifiedDay: 42 }], { low: 1, high: 0 }))
      .toMatchObject({ modifiedOldest: 42, modifiedNewest: 42 });
    expect(textures.uploadFreshnessNode).toHaveBeenCalledTimes(1);
    expect(textures.uploadFreshnessNode).toHaveBeenCalledWith(expect.any(Float32Array), 0);
    expect(renderer.applyModifiedDateUpdates([{ index: 1, modifiedDay: 50 }], { low: 1, high: 0 })).toBeNull();
    expect(renderer.applyModifiedDateUpdates([{ index: 0, modifiedDay: 50 }], { low: 2, high: 0 })).toBeNull();
    expect(textures.uploadFreshnessNode).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('uploads only changed node texels and suppresses stale graph metrics', () => {
    document.documentElement.dataset.motion = 'off';
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const renderer = new GraphRenderer(document.createElement('canvas'), {} as NoteLabels);
    renderer.applyDisplay({
      ...DEFAULT_DISPLAY,
      orphanHighlight: true,
      islandHighlight: true,
      importantNodes: true,
      communityColors: true,
    });
    const initial = snapshot(1, 0);
    const graph: GraphSnapshot = {
      ...initial,
      nodeCount: 2,
      edgeCount: 0,
      edgeSlotCount: 0,
      positions: new Float32Array([0, 0, 1, 0]),
      createdDays: new Float32Array([1, 1]),
      modifiedDays: new Float32Array([1, 1]),
      degrees: new Uint32Array([0, 0]),
      nodeIds: new Uint32Array([1, 0, 2, 0]),
      clusterIds: new Uint32Array([0, 0]),
      edges: new Uint32Array(),
      edgeDirections: new Uint32Array(),
      edgeTypes: new Uint32Array(),
    };
    const internals = renderer as unknown as {
      store: { snapshot: GraphSnapshot | null };
      scene: {
        textures: {
          uploadNode: ReturnType<typeof vi.fn>;
          uploadFreshnessNode: ReturnType<typeof vi.fn>;
        };
        uploadEdges: ReturnType<typeof vi.fn>;
        uploadTransitionEdges: ReturnType<typeof vi.fn>;
        drawNodes: ReturnType<typeof vi.fn>;
      };
      draw: (seconds: number, animate?: boolean) => void;
    };
    renderer.setSnapshot(graph);
    internals.scene.uploadTransitionEdges.mockClear();

    expect(renderer.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 1,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [{ index: 0, degree: 2, modifiedDay: 42 }, { index: 1, degree: 2 }],
      edgeUpdates: [{ slot: 0, source: 0, target: 1, directionMask: 1, typeMask: 1 }],
    }, { low: 1, high: 0 }, 1)).toBe(true);

    renderer.setCommunityIds(new Uint32Array([99, 99]));
    renderer.setCollapsedCommunities([99]);
    internals.draw(0, false);

    expect(internals.scene.textures.uploadNode).toHaveBeenCalledTimes(2);
    expect(internals.scene.textures.uploadNode).toHaveBeenCalledWith(expect.any(Float32Array), 0);
    expect(internals.scene.textures.uploadNode.mock.calls.map(([texels, node]) => texels[node * 4 + 2]))
      .toEqual([2, 2]);
    expect(internals.scene.textures.uploadFreshnessNode).toHaveBeenCalledWith(expect.any(Float32Array), 0);
    expect(internals.scene.uploadEdges).toHaveBeenLastCalledWith(expect.any(Uint32Array));
    expect(internals.scene.uploadTransitionEdges).not.toHaveBeenCalled();
    expect(internals.store.snapshot?.clusterIds[0]).toBe(0);
    const drawOptions = internals.scene.drawNodes.mock.calls[
      internals.scene.drawNodes.mock.calls.length - 1
    ]?.[1];
    expect(drawOptions).toMatchObject({
      orphanHighlight: false,
      islandHighlight: false,
      importantNodes: false,
      communityColors: false,
    });
    renderer.dispose();
  });
});
