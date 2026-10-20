import type { IconNode } from 'lucide';

export const CANVAS_GLYPHS: Record<string, IconNode> = {
  diamond: [
    ['path', { d: 'M12 3 21 12l-9 9-9-9 9-9Z' }],
  ],
  bringToFront: [
    ['rect', { x: '3', y: '3', width: '12', height: '12', rx: '2' }],
    ['path', { d: 'M9 21h10a2 2 0 0 0 2-2V9' }],
  ],
  sendToBack: [
    ['rect', { x: '9', y: '9', width: '12', height: '12', rx: '2' }],
    ['path', { d: 'M15 3H5a2 2 0 0 0-2 2v10' }],
  ],
  duplicate: [
    ['rect', { x: '8', y: '8', width: '13', height: '13', rx: '2' }],
    ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }],
  ],
  group: [
    ['rect', { x: '3', y: '3', width: '7', height: '7', rx: '1' }],
    ['rect', { x: '14', y: '14', width: '7', height: '7', rx: '1' }],
    ['path', { d: 'M14 6h3a2 2 0 0 1 2 2v3M10 18H7a2 2 0 0 1-2-2v-3' }],
  ],
  ungroup: [
    ['rect', { x: '3', y: '3', width: '7', height: '7', rx: '1' }],
    ['rect', { x: '14', y: '14', width: '7', height: '7', rx: '1' }],
    ['path', { d: 'm14 10 3-3M10 14l-3 3' }],
  ],
};
