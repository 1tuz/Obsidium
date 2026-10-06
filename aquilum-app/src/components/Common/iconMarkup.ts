import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LucideIcon } from 'lucide-react';

export function renderIconMarkup(Icon: LucideIcon, strokeWidth = 1.2): string {
  return renderToStaticMarkup(createElement(Icon, { strokeWidth }));
}
