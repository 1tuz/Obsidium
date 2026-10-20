import type { IconId } from '../Common/iconCatalog';

export const CANVAS_GLYPHS = {
  diamond: 'diamond',
  bringToFront: 'bring-to-front',
  sendToBack: 'send-to-back',
  duplicate: 'duplicate',
  group: 'group',
  ungroup: 'ungroup',
} as const satisfies Record<string, IconId>;
