import { createElement, useEffect, useState } from 'react';
import type { IconNode } from 'lucide';
import type { IconId } from './iconCatalog';
import { ensureLucideCatalog, getIconId, getIconMarkup, getIconSet, getLucideIcon, subscribeIconSet } from '../../modules/iconSet';

interface IconProps {
  icon: IconNode | IconId;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ icon, size = 24, strokeWidth = 2, className }: IconProps) {
  const [iconSet, updateIconSet] = useState(getIconSet);
  const [, updateCatalog] = useState(0);
  const iconId = getIconId(icon);
  const markup = iconSet === 'lucide' ? null : getIconMarkup(iconSet, iconId);
  const renderedSet = markup ? iconSet : 'lucide';
  const lucideIcon = typeof icon === 'string' ? getLucideIcon(iconId) : icon;

  useEffect(() => {
    const unsubscribe = subscribeIconSet(() => updateIconSet(getIconSet()));
    if (typeof icon === 'string') void ensureLucideCatalog().then(() => updateCatalog((revision) => revision + 1));
    return unsubscribe;
  }, [icon]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={renderedSet === 'phosphor' ? '0 0 256 256' : '0 0 24 24'}
      fill={renderedSet === 'phosphor' ? 'currentColor' : 'none'}
      stroke={renderedSet === 'phosphor' ? undefined : 'currentColor'}
      strokeWidth={renderedSet === 'phosphor' ? undefined : strokeWidth}
      strokeLinecap={renderedSet === 'phosphor' ? undefined : 'round'}
      strokeLinejoin={renderedSet === 'phosphor' ? undefined : 'round'}
      className={className}
      data-icon-set={renderedSet}
      data-icon-name={iconId}
      aria-hidden="true"
    >
      {renderedSet === 'lucide' && lucideIcon?.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
      {renderedSet !== 'lucide' && <g dangerouslySetInnerHTML={{ __html: markup! }} />}
    </svg>
  );
}
