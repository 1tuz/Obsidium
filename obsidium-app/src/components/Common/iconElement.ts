import type { IconNode } from 'lucide';
import type { IconId } from './iconCatalog';
import { ensureLucideCatalog, getIconId, getIconMarkup, getIconSet, getLucideIcon, getMappedIconId } from '../../modules/iconSet';

const legacyIcons = new WeakMap<SVGSVGElement, IconNode>();

export function createIconElement(icon: IconNode | IconId, strokeWidth = 1.2): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.iconDom = 'true';
  const iconId = getIconId(icon);
  svg.dataset.iconName = iconId;
  svg.dataset.strokeWidth = String(strokeWidth);
  if (typeof icon !== 'string') legacyIcons.set(svg, icon);
  updateIconElement(svg, strokeWidth, getIconSet());
  if (typeof icon === 'string') {
    void ensureLucideCatalog().then(() => updateIconElement(svg, strokeWidth, getIconSet()));
  }
  return svg;
}

function updateIconElement(svg: SVGSVGElement, strokeWidth: number, iconSet: ReturnType<typeof getIconSet>) {
  const iconId = legacyIcons.has(svg) ? getIconId(legacyIcons.get(svg)!) : svg.dataset.iconName as IconId;
  const iconData = legacyIcons.get(svg) ?? getLucideIcon(iconId);
  const mappedId = legacyIcons.has(svg) ? getMappedIconId(legacyIcons.get(svg)!) : iconId;
  const markup = mappedId && iconSet !== 'lucide' ? getIconMarkup(iconSet, mappedId) : null;
  const renderedSet = markup ? iconSet : 'lucide';
  svg.replaceChildren();
  svg.setAttribute('viewBox', renderedSet === 'phosphor' ? '0 0 256 256' : '0 0 24 24');
  svg.setAttribute('fill', renderedSet === 'phosphor' ? 'currentColor' : 'none');
  svg.removeAttribute('stroke');
  svg.removeAttribute('stroke-width');
  svg.removeAttribute('stroke-linecap');
  svg.removeAttribute('stroke-linejoin');
  svg.dataset.iconSet = renderedSet;
  if (renderedSet === 'lucide') {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const [tag, attributes] of iconData ?? []) {
      const child = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attributes)) {
        child.setAttribute(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), String(value));
      }
      svg.append(child);
    }
    return;
  }
  if (renderedSet === 'tabler') {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  const template = document.createElement('template');
  template.innerHTML = `<svg>${markup!}</svg>`;
  svg.append(...template.content.firstElementChild!.childNodes);
}

if (typeof window !== 'undefined') {
  window.addEventListener('obsidium-icon-set-change', () => {
    for (const svg of document.querySelectorAll<SVGSVGElement>('svg[data-icon-dom="true"]')) {
      updateIconElement(svg, Number(svg.dataset.strokeWidth) || 1.2, getIconSet());
    }
  });
}
