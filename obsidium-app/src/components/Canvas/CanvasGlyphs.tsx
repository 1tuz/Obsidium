import type { IconNode } from 'lucide';
import type { IconId } from '../Common/iconCatalog';

export const rhombus: IconNode = [['path', { d: 'M12 2.5 21.5 12 12 21.5 2.5 12Z' }]];

export const stickerGlyph: IconNode = [
  ['path', { d: 'M4 4h16v10l-6 6H4z' }],
  ['path', { d: 'M20 14h-6v6' }],
];

export const copyGlyph: IconNode = [
  ['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
  ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }],
];

export const pasteGlyph: IconNode = [
  ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1 }],
  ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
];

export const CANVAS_GLYPHS = {
  diamond: 'diamond',
  bringToFront: 'bring-to-front',
  sendToBack: 'send-to-back',
  duplicate: 'duplicate',
  group: 'group',
  ungroup: 'ungroup',
} as const satisfies Record<string, IconId>;