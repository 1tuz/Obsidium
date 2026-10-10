import {
  BASE_RADIUS,
  DEGREE_RADIUS,
  DIMMED_STRENGTH,
  EDGE_WORLD_HALF_WIDTH,
  HIGHLIGHT_LEVEL_STEP,
  HIGHLIGHT_MAX_INTENSITY,
  MAX_WORLD_RADIUS,
  MIN_LAYOUT_SPACING,
  NODE_GAP_SHARE,
} from './nodeMetrics';

const UNPACK_HIGHLIGHT = `
float packedHighlight(sampler2D map, ivec2 texel) {
  return floor(texelFetch(map, texel, 0).x * 255.0 + 0.5);
}
float highlightMark(float packed) {
  return floor(packed / ${HIGHLIGHT_LEVEL_STEP.toFixed(1)});
}
float highlightIntensity(float packed) {
  return mod(packed, ${HIGHLIGHT_LEVEL_STEP.toFixed(1)}) / ${HIGHLIGHT_MAX_INTENSITY.toFixed(1)};
}`;

export const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const OFFSCREEN = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

export const NODE_VERTEX = `#version 300 es
in vec2 aCorner;
uniform sampler2D uNodes;
uniform sampler2D uFreshness;
uniform sampler2D uHighlight;
uniform sampler2D uReveal;
uniform sampler2D uClusters;
uniform sampler2D uCustomGroupPalette;
uniform vec2 uCenter;
uniform vec2 uHalfViewport;
uniform float uScale;
uniform float uSpread;
uniform float uImportantCount;
uniform vec2 uRadiusLimits;
uniform float uSizeScale;
uniform vec2 uFreshnessRange;
uniform float uHeatmap;
uniform float uHeatCreated;
out vec2 vCorner;
out float vRadius;
out float vCoverage;
out float vState;
out float vHeat;
out float vOrphan;
out float vIsland;
out float vImportant;
out float vShown;
out float vCommunity;
out float vCustomGroup;
${UNPACK_HIGHLIGHT}
void main() {
  int width = textureSize(uNodes, 0).x;
  ivec2 texel = ivec2(gl_InstanceID % width, gl_InstanceID / width);
  vShown = texelFetch(uReveal, texel, 0).x;
  if (vShown <= 0.0) {
    ${OFFSCREEN}
    return;
  }
  vec4 node = texelFetch(uNodes, texel, 0);
  vec4 nodeGroups = texelFetch(uClusters, texel, 0);
  vCommunity = nodeGroups.r;
  vIsland = nodeGroups.g;
  vCustomGroup = nodeGroups.b;
  vImportant = float(gl_InstanceID) < uImportantCount ? 1.0 : 0.0;
  vOrphan = node.z < 0.5 ? 1.0 : 0.0;
  float ceiling = min(
    ${MAX_WORLD_RADIUS.toFixed(4)},
    ${MIN_LAYOUT_SPACING.toFixed(4)} * uSpread * ${NODE_GAP_SHARE.toFixed(4)}
  );
  float world = min(
    (${BASE_RADIUS.toFixed(4)} + ${DEGREE_RADIUS.toFixed(4)} * sqrt(max(node.z, 1.0))) * uSizeScale,
    ceiling
  );
  float ideal = world * uScale;
  vCoverage = clamp(ideal / uRadiusLimits.x, 0.12, 1.0);
  vState = highlightIntensity(packedHighlight(uHighlight, texel));
  float freshness = uHeatCreated > 0.5 ? node.w : texelFetch(uFreshness, texel, 0).x;
  float heatSpan = uFreshnessRange.y - uFreshnessRange.x;
  vHeat = (uHeatmap > 0.5 && freshness > 0.0)
    ? (heatSpan > 1e-4 ? clamp((freshness - uFreshnessRange.x) / heatSpan, 0.0, 1.0) : 0.5)
    : -1.0;
  float radius = clamp(ideal, uRadiusLimits.x, uRadiusLimits.y);
  vec2 screen = (node.xy * uSpread - uCenter) * uScale + aCorner * radius;
  gl_Position = vec4(screen / uHalfViewport, 0.0, 1.0);
  vCorner = aCorner;
  vRadius = radius;
}`;

export const NODE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vCorner;
in float vRadius;
in float vCoverage;
in float vState;
in float vHeat;
in float vOrphan;
in float vIsland;
in float vImportant;
in float vShown;
in float vCommunity;
in float vCustomGroup;
uniform vec4 uFill;
uniform vec4 uOutline;
uniform vec4 uBackdrop;
uniform vec4 uCold;
uniform vec4 uHot;
uniform vec4 uEdgeActive;
uniform float uHeatmap;
uniform float uDimming;
uniform float uOrphanHighlight;
uniform float uIslandHighlight;
uniform float uImportantNodes;
uniform float uCommunityColors;
uniform float uCustomGroupColors;
out vec4 outColor;
vec4 communityColor(float id) {
  int slot = int(mod(id, 6.0));
  if (slot == 1) return mix(uFill, uCold, 0.55);
  if (slot == 2) return uCold;
  if (slot == 3) return mix(uFill, uHot, 0.55);
  if (slot == 4) return uHot;
  if (slot == 5) return mix(uFill, uEdgeActive, 0.55);
  return uFill;
}
vec4 customGroupColor(float id) {
  if (id < 0.5) return uFill;
  int width = textureSize(uCustomGroupPalette, 0).x;
  int slot = int(id + 0.5) - 1;
  return texelFetch(uCustomGroupPalette, ivec2(slot % width, slot / width), 0);
}
void main() {
  float radial = length(vCorner);
  float aa = clamp(1.4 / vRadius, 0.01, 0.7);
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, radial);
  if (alpha <= 0.0) discard;
  float rim = smoothstep(2.5, 5.0, vRadius) * clamp(1.8 / vRadius, 0.0, 0.35);
  float body = 1.0 - smoothstep(1.0 - rim - aa, 1.0 - rim, radial);
  vec4 clustered = mix(uFill, communityColor(vCommunity), uCommunityColors);
  clustered = mix(clustered, customGroupColor(vCustomGroup), uCustomGroupColors * float(vCustomGroup > 0.5));
  vec4 heatColor = vHeat >= 0.0 ? mix(uCold, uHot, vHeat) : clustered;
  vec4 base = mix(clustered, heatColor, uHeatmap);
  base = mix(base, uCold, vIsland * uIslandHighlight);
  base = mix(base, uEdgeActive, vImportant * uImportantNodes);
  base = mix(base, uHot, vOrphan * uOrphanHighlight);
  vec4 color = mix(uOutline, base, body);
  float dim = mix(1.0, mix(${DIMMED_STRENGTH.toFixed(2)}, 1.0, vState), uDimming);
  float tone = color.a * max(vCoverage, vState) * dim;
  outColor = vec4(mix(uBackdrop.rgb, color.rgb, tone), alpha * vShown);
}`;

export const EDGE_VERTEX = `#version 300 es
in vec2 aCorner;
in uvec2 aEdge;
in float aTransitionTarget;
uniform sampler2D uNodes;
uniform sampler2D uHighlight;
uniform sampler2D uReveal;
uniform vec2 uCenter;
uniform vec2 uHalfViewport;
uniform float uScale;
uniform float uSpread;
uniform vec2 uWidthLimits;
uniform float uArrowHead;
uniform float uTransitionProgress;
out float vAcross;
out float vHalfWidth;
out float vCoverage;
out float vActive;
out float vShown;
out float vAlong;
out float vLength;
out float vTransitionOpacity;
ivec2 slotOf(uint index, int width) {
  int slot = int(index);
  return ivec2(slot % width, slot / width);
}
${UNPACK_HIGHLIGHT}
void main() {
  int width = textureSize(uNodes, 0).x;
  float progress = uTransitionProgress * uTransitionProgress * (3.0 - 2.0 * uTransitionProgress);
  vTransitionOpacity = mix(1.0 - aTransitionTarget, aTransitionTarget, progress);
  ivec2 firstTexel = slotOf(aEdge.x, width);
  ivec2 secondTexel = slotOf(aEdge.y, width);
  vShown = min(
    texelFetch(uReveal, firstTexel, 0).x,
    texelFetch(uReveal, secondTexel, 0).x
  );
  if (vShown <= 0.0) {
    ${OFFSCREEN}
    return;
  }
  vec4 first = texelFetch(uNodes, firstTexel, 0);
  vec4 second = texelFetch(uNodes, secondTexel, 0);
  float ideal = ${EDGE_WORLD_HALF_WIDTH.toFixed(5)} * uScale;
  vHalfWidth = clamp(ideal, uWidthLimits.x, uWidthLimits.y);
  vCoverage = clamp(ideal / uWidthLimits.x, 0.15, 1.0);
  float firstPacked = packedHighlight(uHighlight, firstTexel);
  float secondPacked = packedHighlight(uHighlight, secondTexel);
  float firstMark = highlightMark(firstPacked);
  float secondMark = highlightMark(secondPacked);
  bool chained = min(firstMark, secondMark) > 0.5
    && abs(abs(firstMark - secondMark) - 1.0) < 0.5;
  vActive = chained
    ? min(highlightIntensity(firstPacked), highlightIntensity(secondPacked))
    : 0.0;
  vec2 from = (first.xy * uSpread - uCenter) * uScale;
  vec2 to = (second.xy * uSpread - uCenter) * uScale;
  vec2 along = to - from;
  float span = max(length(along), 1e-4);
  vec2 normal = vec2(-along.y, along.x) / span;
  float reach = mix(vHalfWidth + 1.0, 5.5, uArrowHead);
  vec2 screen = mix(from, to, aCorner.x * 0.5 + 0.5) + normal * aCorner.y * reach;
  gl_Position = vec4(screen / uHalfViewport, 0.0, 1.0);
  vAcross = aCorner.y * reach;
  vAlong = aCorner.x * 0.5 + 0.5;
  vLength = span;
}`;

export const LABEL_VERTEX = `#version 300 es
in vec2 aCorner;
in vec4 aRect;
in vec4 aUv;
in vec2 aStyle;
uniform vec2 uViewport;
out vec2 vUv;
out float vAlpha;
out float vFocused;
void main() {
  vec2 unit = aCorner * 0.5 + 0.5;
  vec2 pixel = aRect.xy + unit * aRect.zw;
  vec2 clip = pixel / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = mix(aUv.xy, aUv.zw, unit);
  vAlpha = aStyle.x;
  vFocused = aStyle.y;
}`;

export const LABEL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in float vAlpha;
in float vFocused;
uniform sampler2D uAtlas;
uniform vec2 uHaloStep;
uniform vec4 uFill;
uniform vec4 uFocus;
uniform vec4 uHalo;
out vec4 outColor;
float coverageAt(vec2 offset) {
  return texture(uAtlas, vUv + offset).r;
}
void main() {
  float fill = coverageAt(vec2(0.0));
  float outline = fill;
  outline = max(outline, coverageAt(vec2(uHaloStep.x, 0.0)));
  outline = max(outline, coverageAt(vec2(-uHaloStep.x, 0.0)));
  outline = max(outline, coverageAt(vec2(0.0, uHaloStep.y)));
  outline = max(outline, coverageAt(vec2(0.0, -uHaloStep.y)));
  outline = max(outline, coverageAt(vec2(uHaloStep.x, uHaloStep.y)));
  outline = max(outline, coverageAt(vec2(uHaloStep.x, -uHaloStep.y)));
  outline = max(outline, coverageAt(vec2(-uHaloStep.x, uHaloStep.y)));
  outline = max(outline, coverageAt(vec2(-uHaloStep.x, -uHaloStep.y)));
  float alpha = max(fill * uFill.a, outline * uHalo.a);
  if (alpha <= 0.0) discard;
  vec4 body = mix(uFill, uFocus, vFocused);
  vec3 rgb = mix(uHalo.rgb, body.rgb, fill);
  outColor = vec4(rgb, alpha * vAlpha);
}`;

export const EDGE_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
in float vHalfWidth;
in float vCoverage;
in float vActive;
in float vShown;
in float vAlong;
in float vLength;
in float vTransitionOpacity;
uniform vec4 uEdgeColor;
uniform vec4 uEdgeActive;
uniform float uDimming;
uniform float uOpacity;
uniform float uDashed;
uniform float uShowArrows;
uniform float uArrowHead;
out vec4 outColor;
void main() {
  if (uArrowHead < 0.5 && uDashed > 0.5 && mod(vAlong * vLength, 12.0) > 7.0) discard;
  if (uArrowHead < 0.5 && uShowArrows > 0.5 && vAlong > 0.78) discard;
  if (uArrowHead > 0.5) {
    if (vAlong < 0.78 || abs(vAcross) > (1.0 - vAlong) * 25.0) discard;
  }
  float alpha = uArrowHead > 0.5
    ? 1.0
    : 1.0 - smoothstep(vHalfWidth - 0.5, vHalfWidth + 0.5, abs(vAcross));
  if (alpha <= 0.0) discard;
  vec4 color = uArrowHead > 0.5 ? uEdgeActive : mix(uEdgeColor, uEdgeActive, vActive);
  float dim = mix(1.0, mix(${DIMMED_STRENGTH.toFixed(2)}, 1.0, vActive), uDimming);
  outColor = vec4(color.rgb, color.a * alpha * max(vCoverage, vActive) * dim * vShown * uOpacity * vTransitionOpacity);
}`;
