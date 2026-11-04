import { type Extension, RangeSet, StateField, type Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { t } from '../../../../i18n';
import type { MenuItem } from '../../../Common/Menu';
import { parseSyncRegions, syncedRegionText, type SyncRegion } from '../../../../modules/blocks/synced';
import {
  ensureSyncedLoaded,
  detachSyncedBlock,
  getSyncedBlock,
  lastSeenRevision,
  markSyncedSeen,
  updateSyncedBlock,
} from '../../../../modules/blocks/syncedStore';
import { requestOpenNote } from '../../../../modules/blocks/navigation';
import { openBlockMenu } from './menuHost';
import './synced.css';

export interface SyncedExtensionOptions {
  path: () => string;
  enabled: boolean;
}

const replacingViews = new WeakSet<EditorView>();

class SyncedBadgeWidget extends WidgetType {
  constructor(readonly id: string) {
    super();
  }

  eq(other: SyncedBadgeWidget): boolean {
    return other instanceof SyncedBadgeWidget && other.id === this.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const badge = document.createElement('button');
    badge.className = 'q-block-synced-badge';
    badge.type = 'button';
    badge.textContent = t('blocks.synced');
    badge.setAttribute('aria-label', t('blocks.synced'));
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = badge.getBoundingClientRect();
      openBlockMenu(view, {
        items: syncedMenuItems(view, this.id),
        position: { top: rect.bottom, left: rect.left, width: rect.width },
        ariaLabel: t('blocks.synced'),
        exclude: badge,
      });
    });
    return badge;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function syncedMenuItems(view: EditorView, id: string): MenuItem[] {
  const record = getSyncedBlock(id);
  const sourcePath = record?.sourcePath ?? '';
  return [
    {
      id: 'synced-source',
      label: t('blocks.syncedSource'),
      disabled: sourcePath === '',
      onSelect: () => {
        requestOpenNote(sourcePath);
      },
    },
    {
      id: 'synced-copy',
      label: t('blocks.syncedCopy'),
      disabled: !record,
      onSelect: () => {
        void navigator.clipboard.writeText(`[[${sourcePath}#^${id}]]`);
      },
    },
    {
      id: 'synced-detach',
      label: t('blocks.syncedDetach'),
      danger: true,
      onSelect: () => {
        void detachSyncedBlock(view, id);
      },
    },
  ];
}

function buildDecorations(source: string, regions: readonly SyncRegion[]): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  for (const region of regions) {
    const openEnd = region.from + region.id.length + 21;
    const openLineEnd = source[openEnd] === '\n' ? openEnd + 1 : openEnd;
    decorations.push(Decoration.replace({}).range(region.from, openLineEnd));
    decorations.push(Decoration.widget({ widget: new SyncedBadgeWidget(region.id), side: -1 }).range(region.from));
    const closeFrom = source.lastIndexOf('\n', region.to - 1) + 1;
    const closeEnd = source[region.to] === '\n' ? region.to + 1 : region.to;
    if (closeFrom < closeEnd) decorations.push(Decoration.replace({}).range(closeFrom, closeEnd));
  }
  return decorations;
}

const decorationsField = StateField.define<DecorationSet>({
  create(state) {
    const source = state.doc.toString();
    const decorations = buildDecorations(source, parseSyncRegions(source));
    return decorations.length ? RangeSet.of(decorations, true) : Decoration.none;
  },
  update(_value, transaction) {
    if (!transaction.docChanged) return Decoration.none;
    const source = transaction.state.doc.toString();
    const decorations = buildDecorations(source, parseSyncRegions(source));
    return decorations.length ? RangeSet.of(decorations, true) : Decoration.none;
  },
});

export function syncedExtension(options: SyncedExtensionOptions): Extension {
  if (!options.enabled) return [];

  const plugin = ViewPlugin.fromClass(class {
    private applying = false;
    private initialised = false;

    constructor(private readonly view: EditorView) {
      void this.reconcile();
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged || this.applying || replacingViews.has(this.view)) return;
      void this.handleDocChange();
    }

    private async reconcile(): Promise<void> {
      await ensureSyncedLoaded();
      if (!this.initialised) {
        this.initialised = true;
        await this.applyStoreRegions();
      }
    }

    private async applyStoreRegions(): Promise<void> {
      const source = this.view.state.doc.toString();
      const regions = parseSyncRegions(source);
      for (const region of regions) {
        const record = getSyncedBlock(region.id);
        if (!record) continue;
        const seen = lastSeenRevision(this.view, region.id);
        if (seen !== null && seen >= record.revision) continue;
        if (region.content === record.content) {
          markSyncedSeen(this.view, region.id, record.revision);
          continue;
        }
        this.dispatchRegion(region, record.content, record.id);
        markSyncedSeen(this.view, region.id, record.revision);
      }
    }

    private async handleDocChange(): Promise<void> {
      await ensureSyncedLoaded();
      const source = this.view.state.doc.toString();
      const regions = parseSyncRegions(source);
      if (regions.length === 0) return;
      const authorPath = options.path();
      for (const region of regions) {
        const record = getSyncedBlock(region.id);
        if (!record) continue;
        const seen = lastSeenRevision(this.view, region.id);
        if (seen !== null && record.revision > seen && region.content !== record.content) {
          this.dispatchRegion(region, record.content, region.id);
          markSyncedSeen(this.view, region.id, record.revision);
          continue;
        }
        if (region.content !== record.content) {
          markSyncedSeen(this.view, region.id, record.revision + 1);
          await updateSyncedBlock(region.id, region.content, authorPath);
        }
      }
    }

    private dispatchRegion(region: SyncRegion, content: string, id: string): void {
      const next = syncedRegionText(id, content);
      if (next === this.view.state.doc.sliceString(region.from, region.to)) return;
      this.applying = true;
      replacingViews.add(this.view);
      try {
        this.view.dispatch({ changes: { from: region.from, to: region.to, insert: next } });
      } finally {
        this.applying = false;
        replacingViews.delete(this.view);
      }
    }
  });

  return [decorationsField, plugin];
}
