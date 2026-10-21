import type { IconNode } from 'lucide';
import type { IconId } from '../Common/iconCatalog';

export const rhombus: IconNode = [['path', { d: 'M12 2.5 21.5 12 12 21.5 2.5 12Z' }]];

export const CANVAS_GLYPHS = {
  diamond: 'diamond',
  bringToFront: 'bring-to-front',
  sendToBack: 'send-to-back',
  duplicate: 'duplicate',
  group: 'group',
  ungroup: 'ungroup',
} as const satisfies Record<string, IconId>;