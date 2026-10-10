import { t } from '../../i18n';
import {
  bindCorner,
  bindEdgeTransitionTarget,
  bindEdgeEndpoints,
  createBuffer,
  createProgram,
  createVao,
  UniformCache,
} from './glResources';
import {
  EDGE_MAX_HALF_PIXELS,
  EDGE_MIN_HALF_PIXELS,
  MAX_NODE_PIXELS,
  pageRankHighlightCount,
  SUB_PIXEL_RADIUS,
} from './nodeMetrics';
import { LabelSprites } from './labelSprites';
import {
  FRESHNESS_UNIT,
  HIGHLIGHT_UNIT,
  NODE_UNIT,
  NodeTextures,
  REVEAL_UNIT,
  CLUSTER_UNIT,
  CUSTOM_GROUP_UNIT,
} from './nodeTextures';
import { customEdgeColor, fadeEdges, type Palette } from './palette';
import type { EdgeColor, EdgeStyle } from './graphDisplay';
import { EDGE_FRAGMENT, EDGE_VERTEX, NODE_FRAGMENT, NODE_VERTEX, QUAD } from './shaders';

interface CameraView {
  centerX: number;
  centerY: number;
  deviceScale: number;
  spread: number;
}

interface NodePass {
  nodeCount: number;
  sourceNodeCount: number;
  sizeScale: number;
  dimming: number;
  orphanHighlight: boolean;
  islandHighlight: boolean;
  importantNodes: boolean;
  communityColors: boolean;
  customGroupColors: boolean;
  heatmap: boolean;
  heatCreated: boolean;
  oldest: number;
  newest: number;
}

interface EdgePass {
  drawnEdges: number;
  drawnArrows: number;
  edgeCount: number;
  dimming: number;
  width: number;
  opacity: number;
  style: EdgeStyle;
  color: EdgeColor;
  customColor: string | null;
  arrows: boolean;
}

export class GpuScene {
  readonly textures: NodeTextures;
  readonly labels: LabelSprites;
  private readonly gl: WebGL2RenderingContext;
  private readonly uniforms: UniformCache;
  private readonly nodeProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly quadBuffer: WebGLBuffer;
  private readonly edgeBuffer: WebGLBuffer;
  private readonly arrowBuffer: WebGLBuffer;
  private readonly suggestedBuffer: WebGLBuffer;
  private readonly transitionBuffer: WebGLBuffer;
  private readonly transitionTargetBuffer: WebGLBuffer;
  private readonly transitionArrowBuffer: WebGLBuffer;
  private readonly transitionArrowTargetBuffer: WebGLBuffer;
  private readonly nodeVao: WebGLVertexArrayObject;
  private readonly edgeVao: WebGLVertexArrayObject;
  private readonly arrowVao: WebGLVertexArrayObject;
  private readonly suggestedVao: WebGLVertexArrayObject;
  private readonly transitionVao: WebGLVertexArrayObject;
  private readonly transitionArrowVao: WebGLVertexArrayObject;
  private ratio = 1;
  private halfWidth = 0.5;
  private halfHeight = 0.5;
  private deviceWidth = 1;
  private deviceHeight = 1;
  private edgeBufferBytes = 0;
  private arrowBufferBytes = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error(t('graph.errors.webgl2Unavailable'));
    this.gl = gl;
    this.uniforms = new UniformCache(gl);
    this.textures = new NodeTextures(gl);
    this.labels = new LabelSprites(gl);
    this.nodeProgram = createProgram(gl, NODE_VERTEX, NODE_FRAGMENT);
    this.edgeProgram = createProgram(gl, EDGE_VERTEX, EDGE_FRAGMENT);
    this.quadBuffer = createBuffer(gl);
    this.edgeBuffer = createBuffer(gl);
    this.arrowBuffer = createBuffer(gl);
    this.suggestedBuffer = createBuffer(gl);
    this.transitionBuffer = createBuffer(gl);
    this.transitionTargetBuffer = createBuffer(gl);
    this.transitionArrowBuffer = createBuffer(gl);
    this.transitionArrowTargetBuffer = createBuffer(gl);
    this.nodeVao = createVao(gl);
    this.edgeVao = createVao(gl);
    this.arrowVao = createVao(gl);
    this.suggestedVao = createVao(gl);
    this.transitionVao = createVao(gl);
    this.transitionArrowVao = createVao(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.bindAttributes();
  }

  setViewport(width: number, height: number, ratio: number): void {
    this.ratio = ratio;
    this.deviceWidth = width;
    this.deviceHeight = height;
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.gl.viewport(0, 0, width, height);
  }

  drawLabels(palette: Palette): void {
    this.labels.draw(this.deviceWidth, this.deviceHeight, this.ratio, palette);
  }

  uploadEdges(edges: Uint32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edges, gl.DYNAMIC_DRAW);
    this.edgeBufferBytes = edges.byteLength;
  }

  uploadArrows(edges: Uint32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edges, gl.DYNAMIC_DRAW);
    this.arrowBufferBytes = edges.byteLength;
  }

  uploadEdgeUpdates(edges: Uint32Array, changedEdges: number[]): void {
    this.uploadChangedRanges(this.edgeBuffer, edges, changedEdges, 2, 'edgeBufferBytes');
  }

  uploadArrowUpdates(edges: Uint32Array, changedArrows: number[]): void {
    this.uploadChangedRanges(this.arrowBuffer, edges, changedArrows, 2, 'arrowBufferBytes');
  }

  uploadSuggestions(edges: Uint32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.suggestedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edges, gl.DYNAMIC_DRAW);
  }

  uploadTransitionEdges(edges: Uint32Array, arrows: Uint32Array, targets: Float32Array, arrowTargets: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edges, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionTargetBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, targets, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionArrowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arrows, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionArrowTargetBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arrowTargets, gl.STATIC_DRAW);
  }

  beginFrame(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.textures.bindUnits();
  }

  drawEdges(view: CameraView, pass: EdgePass, palette: Palette): void {
    this.paintEdges(view, pass, palette, false);
  }

  drawTransitionEdges(view: CameraView, pass: EdgePass, palette: Palette, progress: number): void {
    this.paintEdges(view, pass, palette, false, true, progress);
  }

  drawSuggestedEdges(view: CameraView, edgeCount: number, palette: Palette): void {
    this.paintEdges(view, {
      drawnEdges: edgeCount,
      drawnArrows: 0,
      edgeCount,
      dimming: 0,
      width: 1.35,
      opacity: 0.95,
      style: 'dashed',
      color: 'heat',
      customColor: null,
      arrows: false,
    }, palette, true);
  }

  private paintEdges(
    view: CameraView,
    pass: EdgePass,
    palette: Palette,
    suggested: boolean,
    transition = false,
    transitionProgress = 1,
  ): void {
    if (pass.drawnEdges <= 0) return;
    const gl = this.gl;
    const program = this.edgeProgram;
    gl.useProgram(program);
    this.setCamera(program, view);
    gl.uniform2f(
      this.location(program, 'uWidthLimits'),
      EDGE_MIN_HALF_PIXELS * pass.width * this.ratio,
      EDGE_MAX_HALF_PIXELS * pass.width * this.ratio,
    );
    gl.uniform1f(this.location(program, 'uDimming'), pass.dimming);
    gl.uniform1f(this.location(program, 'uOpacity'), pass.opacity);
    gl.uniform1f(this.location(program, 'uDashed'), pass.style === 'dashed' ? 1 : 0);
    gl.uniform1f(this.location(program, 'uShowArrows'), pass.arrows ? 1 : 0);
    gl.uniform1f(this.location(program, 'uTransitionProgress'), transitionProgress);
    gl.uniform1f(this.location(program, 'uArrowHead'), 0);
    const color = pass.color === 'custom'
      ? customEdgeColor(pass.customColor, palette.edge)
      : pass.color === 'nodes'
      ? palette.fill
      : pass.color === 'heat'
        ? palette.hot
        : palette.edge;
    gl.uniform4fv(
      this.location(program, 'uEdgeColor'),
      fadeEdges(color, pass.edgeCount),
    );
    gl.uniform4fv(this.location(program, 'uEdgeActive'), palette.edgeActive);
    const opacityLocation = gl.getAttribLocation(program, 'aTransitionTarget');
    if (!transition && opacityLocation >= 0) {
      gl.disableVertexAttribArray(opacityLocation);
      gl.vertexAttrib1f(opacityLocation, 1);
    }
    gl.bindVertexArray(transition ? this.transitionVao : suggested ? this.suggestedVao : this.edgeVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pass.drawnEdges);
    if (pass.arrows && pass.drawnArrows > 0) {
      gl.uniform1f(this.location(program, 'uArrowHead'), 1);
      gl.uniform4fv(
        this.location(program, 'uEdgeColor'),
        pass.color === 'custom' ? color : palette.edgeActive,
      );
      gl.bindVertexArray(transition ? this.transitionArrowVao : this.arrowVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pass.drawnArrows);
    }
    gl.bindVertexArray(null);
  }

  drawNodes(view: CameraView, pass: NodePass, palette: Palette): void {
    if (pass.nodeCount <= 0) return;
    const gl = this.gl;
    const program = this.nodeProgram;
    gl.useProgram(program);
    this.setCamera(program, view);
    gl.uniform1i(this.location(program, 'uFreshness'), FRESHNESS_UNIT);
    gl.uniform1i(this.location(program, 'uClusters'), CLUSTER_UNIT);
    gl.uniform1i(this.location(program, 'uCustomGroupPalette'), CUSTOM_GROUP_UNIT);
    gl.uniform1f(
      this.location(program, 'uImportantCount'),
      pass.importantNodes ? pageRankHighlightCount(pass.sourceNodeCount) : 0,
    );
    gl.uniform2f(
      this.location(program, 'uRadiusLimits'),
      SUB_PIXEL_RADIUS * this.ratio,
      MAX_NODE_PIXELS * this.ratio,
    );
    gl.uniform1f(this.location(program, 'uSizeScale'), pass.sizeScale);
    gl.uniform1f(this.location(program, 'uDimming'), pass.dimming);
    gl.uniform1f(this.location(program, 'uOrphanHighlight'), pass.orphanHighlight ? 1 : 0);
    gl.uniform1f(this.location(program, 'uIslandHighlight'), pass.islandHighlight ? 1 : 0);
    gl.uniform1f(this.location(program, 'uImportantNodes'), pass.importantNodes ? 1 : 0);
    gl.uniform1f(this.location(program, 'uCommunityColors'), pass.communityColors ? 1 : 0);
    gl.uniform1f(this.location(program, 'uCustomGroupColors'), pass.customGroupColors ? 1 : 0);
    gl.uniform2f(this.location(program, 'uFreshnessRange'), pass.oldest, pass.newest);
    gl.uniform1f(this.location(program, 'uHeatmap'), pass.heatmap ? 1 : 0);
    gl.uniform1f(this.location(program, 'uHeatCreated'), pass.heatCreated ? 1 : 0);
    gl.uniform4fv(this.location(program, 'uFill'), palette.fill);
    gl.uniform4fv(this.location(program, 'uOutline'), palette.outline);
    gl.uniform4fv(this.location(program, 'uBackdrop'), palette.backdrop);
    gl.uniform4fv(this.location(program, 'uCold'), palette.cold);
    gl.uniform4fv(this.location(program, 'uHot'), palette.hot);
    gl.uniform4fv(this.location(program, 'uEdgeActive'), palette.edgeActive);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pass.nodeCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.edgeBuffer);
    gl.deleteBuffer(this.arrowBuffer);
    gl.deleteBuffer(this.suggestedBuffer);
    gl.deleteBuffer(this.transitionBuffer);
    gl.deleteBuffer(this.transitionTargetBuffer);
    gl.deleteBuffer(this.transitionArrowBuffer);
    gl.deleteBuffer(this.transitionArrowTargetBuffer);
    this.labels.dispose();
    this.textures.dispose();
    gl.deleteVertexArray(this.nodeVao);
    gl.deleteVertexArray(this.edgeVao);
    gl.deleteVertexArray(this.arrowVao);
    gl.deleteVertexArray(this.suggestedVao);
    gl.deleteVertexArray(this.transitionVao);
    gl.deleteVertexArray(this.transitionArrowVao);
    gl.deleteProgram(this.nodeProgram);
    gl.deleteProgram(this.edgeProgram);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private setCamera(program: WebGLProgram, view: CameraView): void {
    const gl = this.gl;
    gl.uniform2f(this.location(program, 'uCenter'), view.centerX, view.centerY);
    gl.uniform2f(this.location(program, 'uHalfViewport'), this.halfWidth, this.halfHeight);
    gl.uniform1f(this.location(program, 'uScale'), view.deviceScale);
    gl.uniform1f(this.location(program, 'uSpread'), view.spread);
    gl.uniform1i(this.location(program, 'uNodes'), NODE_UNIT);
    gl.uniform1i(this.location(program, 'uHighlight'), HIGHLIGHT_UNIT);
    gl.uniform1i(this.location(program, 'uReveal'), REVEAL_UNIT);
  }

  private location(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.uniforms.location(program, name);
  }

  private uploadChangedRanges(
    buffer: WebGLBuffer,
    data: Uint32Array,
    changedIndices: number[],
    valuesPerIndex: number,
    capacityKey: 'edgeBufferBytes' | 'arrowBufferBytes',
  ): void {
    if (changedIndices.length === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const requiredBytes = data.byteLength;
    const currentBytes = this[capacityKey];
    if (requiredBytes > currentBytes) {
      let capacityBytes = Math.max(currentBytes, 32);
      while (capacityBytes < requiredBytes) capacityBytes *= 2;
      gl.bufferData(gl.ARRAY_BUFFER, capacityBytes, gl.DYNAMIC_DRAW);
      if (requiredBytes > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      this[capacityKey] = capacityBytes;
      return;
    }
    changedIndices.sort((left, right) => left - right);
    let start = changedIndices[0];
    let end = start + 1;
    for (let index = 1; index <= changedIndices.length; index += 1) {
      const current = changedIndices[index];
      if (index < changedIndices.length && (current === end || current === end - 1)) {
        if (current === end) end += 1;
        continue;
      }
      if (start * valuesPerIndex < data.length) {
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          start * valuesPerIndex * Uint32Array.BYTES_PER_ELEMENT,
          data.subarray(start * valuesPerIndex, end * valuesPerIndex),
        );
      }
      if (index < changedIndices.length) {
        start = current;
        end = current + 1;
      }
    }
  }

  private bindAttributes(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.nodeProgram);

    gl.bindVertexArray(this.edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    bindEdgeEndpoints(gl, this.edgeProgram);
    gl.bindVertexArray(this.arrowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowBuffer);
    bindEdgeEndpoints(gl, this.edgeProgram);
    gl.bindVertexArray(this.suggestedVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.suggestedBuffer);
    bindEdgeEndpoints(gl, this.edgeProgram);
    gl.bindVertexArray(this.transitionVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionBuffer);
    bindEdgeEndpoints(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionTargetBuffer);
    bindEdgeTransitionTarget(gl, this.edgeProgram);
    gl.bindVertexArray(this.transitionArrowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    bindCorner(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionArrowBuffer);
    bindEdgeEndpoints(gl, this.edgeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.transitionArrowTargetBuffer);
    bindEdgeTransitionTarget(gl, this.edgeProgram);
    gl.bindVertexArray(null);
  }
}
