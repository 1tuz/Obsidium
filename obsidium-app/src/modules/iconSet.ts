import type { IconId, IconSet } from '../components/Common/iconCatalog';

export type { IconSet };

const eventName = 'obsidium-icon-set-change';
let activeIconSet: IconSet = 'lucide';
let changeRevision = 0;
let tablerIcons: Record<IconId, string> | null = null;
let phosphorIcons: Record<IconId, string> | null = null;
let lucideIcons: Record<IconId, import('lucide').IconNode> | null = null;
let legacyIconIds: Map<import('lucide').IconNode, IconId> | null = null;
let lucideCatalogPromise: Promise<void> | null = null;

export function getIconSet(): IconSet {
  const stored = document.documentElement.dataset.iconSet;
  return stored === 'lucide' || stored === 'tabler' || stored === 'phosphor' ? stored : activeIconSet;
}

export function getIconId(icon: IconId | import('lucide').IconNode): IconId {
  if (typeof icon === 'string') return icon;
  return legacyIconIds?.get(icon) ?? 'file';
}

export function getLucideIcon(iconId: IconId): import('lucide').IconNode | null {
  return lucideIcons?.[iconId] ?? null;
}

export function ensureLucideCatalog(): Promise<void> {
  if (lucideIcons && legacyIconIds) return Promise.resolve();
  lucideCatalogPromise ??= import('../components/Common/lucideIconCatalog').then(({ LUCIDE_ICONS, LEGACY_ICON_IDS }) => {
    lucideIcons = LUCIDE_ICONS;
    legacyIconIds = LEGACY_ICON_IDS;
  }).catch((error: unknown) => {
    lucideCatalogPromise = null;
    throw error;
  });
  return lucideCatalogPromise;
}

export function getIconMarkup(iconSet: IconSet, iconId: IconId): string | null {
  if (iconSet === 'tabler') return tablerIcons?.[iconId] ?? null;
  if (iconSet === 'phosphor') return phosphorIcons?.[iconId] ?? null;
  return null;
}

export async function setIconSet(iconSet: IconSet): Promise<void> {
  const revision = ++changeRevision;
  if (iconSet === activeIconSet) return;
  if (iconSet === 'tabler') {
    const [{ TABLER_ICONS }] = await Promise.all([
      import('../components/Common/tablerIcons').then((module) => ({ TABLER_ICONS: module.TABLER_ICONS })),
      ensureLucideCatalog(),
    ]);
    tablerIcons = TABLER_ICONS;
  } else if (iconSet === 'phosphor') {
    const [{ PHOSPHOR_ICONS }] = await Promise.all([
      import('../components/Common/phosphorIcons').then((module) => ({ PHOSPHOR_ICONS: module.PHOSPHOR_ICONS })),
      ensureLucideCatalog(),
    ]);
    phosphorIcons = PHOSPHOR_ICONS;
  }
  if (revision !== changeRevision) return;
  activeIconSet = iconSet;
  document.documentElement.dataset.iconSet = iconSet;
  window.dispatchEvent(new Event(eventName));
}

export function subscribeIconSet(listener: () => void): () => void {
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
