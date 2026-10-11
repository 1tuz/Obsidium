import type { GraphGroupRule } from './graphDisplay';
import { customEdgeColor, type Palette } from './palette';

const tokenColors: Record<GraphGroupRule['color'], keyof Pick<Palette, 'cold' | 'hot' | 'edgeActive'>> = {
  cold: 'cold',
  hot: 'hot',
  accent: 'edgeActive',
};

export function customGroupIds(
  nodeCount: number,
  matches: number[][],
): Uint32Array {
  const ids = new Uint32Array(nodeCount);
  matches.forEach((nodes, index) => {
    for (const node of nodes) {
      if (Number.isInteger(node) && node >= 0 && node < nodeCount && ids[node] === 0) {
        ids[node] = index + 1;
      }
    }
  });
  return ids;
}

export function groupRuleColors(rules: GraphGroupRule[], palette: Palette): Float32Array {
  const colors = new Float32Array(rules.length * 4);
  rules.forEach((rule, index) => {
    const fallback = palette[tokenColors[rule.color]] ?? palette.cold;
    colors.set(customEdgeColor(rule.customColor, fallback), index * 4);
  });
  return colors;
}
