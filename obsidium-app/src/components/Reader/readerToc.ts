export type RawTocItem = {
  id?: number;
  label?: string | null;
  href?: string | null;
  subitems?: readonly RawTocItem[] | null;
};

export type ReaderTocItem = {
  id: number;
  label: string;
  href: string | null;
  depth: number;
};

export function flattenToc(toc: readonly RawTocItem[] | null | undefined): ReaderTocItem[] {
  const items: ReaderTocItem[] = [];
  const used = new Set<number>();
  let counter = 0;

  const takeId = (id: number | undefined): number => {
    if (typeof id === 'number' && !used.has(id)) {
      used.add(id);
      return id;
    }
    while (used.has(counter)) counter += 1;
    used.add(counter);
    counter += 1;
    return counter - 1;
  };

  const walk = (list: readonly RawTocItem[] | null | undefined, depth: number): void => {
    if (!list) return;
    for (const item of list) {
      if (!item) continue;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (label) {
        const href = typeof item.href === 'string' ? item.href.trim() || null : null;
        items.push({ id: takeId(item.id), label, href, depth });
      }
      walk(item.subitems, depth + 1);
    }
  };

  walk(toc, 0);
  return items;
}

export function tocItemLabel(items: readonly ReaderTocItem[], id: number | null | undefined): string {
  if (id === null || id === undefined) return '';
  return items.find((item) => item.id === id)?.label ?? '';
}
