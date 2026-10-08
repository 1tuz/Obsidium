import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PaneLayout } from '../../modules/ui-state';
import { t } from '../../i18n';
import { setSplitRatio } from '../../modules/panes/layout';
import './PaneLayoutView.css';

interface PaneLayoutViewProps {
  layout: PaneLayout;
  renderPane: (paneId: string) => ReactNode;
  onResize: (path: number[], ratio: number) => void;
}

export function PaneLayoutView({ layout, renderPane, onResize }: PaneLayoutViewProps) {
  const [preview, setPreview] = useState<{ path: number[]; ratio: number } | null>(null);
  const displayLayout = preview ? setSplitRatio(layout, preview.path, preview.ratio) : layout;
  return (
    <PaneNode
      layout={displayLayout}
      path={[]}
      renderPane={renderPane}
      onResize={(path, ratio) => setPreview({ path: [...path], ratio })}
      onCommitResize={(path, ratio) => {
        setPreview(null);
        onResize(path, ratio);
      }}
      onCancelResize={() => setPreview(null)}
    />
  );
}

function PaneNode({
  layout,
  path,
  renderPane,
  onResize,
  onCommitResize,
  onCancelResize,
}: PaneLayoutViewProps & {
  path: number[];
  onCommitResize: (path: number[], ratio: number) => void;
  onCancelResize: () => void;
}) {
  if (layout.kind === 'pane') {
    return <div className="q-pane-layout__pane">{renderPane(layout.paneId)}</div>;
  }

  const horizontal = layout.direction === 'horizontal';
  const firstStyle = { flex: `0 1 ${layout.ratio * 100}%` } satisfies CSSProperties;

  return (
    <div className={`q-pane-layout q-pane-layout--${layout.direction}`}>
      <div className="q-pane-layout__child" style={firstStyle}>
        <PaneNode layout={layout.children[0]} path={[...path, 0]} renderPane={renderPane} onResize={onResize} onCommitResize={onCommitResize} onCancelResize={onCancelResize} />
      </div>
      <PaneDivider
        horizontal={horizontal}
        ratio={layout.ratio}
        onResize={(ratio) => onResize(path, ratio)}
        onCommitResize={(ratio) => onCommitResize(path, ratio)}
        onCancelResize={onCancelResize}
      />
      <div className="q-pane-layout__child q-pane-layout__child--remaining">
        <PaneNode layout={layout.children[1]} path={[...path, 1]} renderPane={renderPane} onResize={onResize} onCommitResize={onCommitResize} onCancelResize={onCancelResize} />
      </div>
    </div>
  );
}

function PaneDivider({ horizontal, ratio, onResize, onCommitResize, onCancelResize }: { horizontal: boolean; ratio: number; onResize: (ratio: number) => void; onCommitResize: (ratio: number) => void; onCancelResize: () => void }) {
  const latestRatio = useRef(ratio);
  const update = (clientX: number, clientY: number, element: HTMLDivElement) => {
    const parent = element.parentElement;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    const position = horizontal ? clientX - bounds.left : clientY - bounds.top;
    const size = horizontal ? bounds.width : bounds.height;
    if (size > 0) {
      latestRatio.current = position / size;
      onResize(latestRatio.current);
    }
  };

  return (
    <div
      className={`q-pane-layout__divider ${horizontal ? 'q-pane-layout__divider--horizontal' : 'q-pane-layout__divider--vertical'}`}
      role="separator"
      aria-label={t(horizontal ? 'titlebar.resizePaneWidth' : 'titlebar.resizePaneHeight')}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event.clientX, event.clientY, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          update(event.clientX, event.clientY, event.currentTarget);
        }
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onCommitResize(latestRatio.current);
      }}
      onPointerCancel={onCancelResize}
      onKeyDown={(event) => {
        const negative = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const positive = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== negative && event.key !== positive) return;
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        const bounds = parent?.getBoundingClientRect();
        if (!bounds) return;
        const size = horizontal ? bounds.width : bounds.height;
        const rect = event.currentTarget.getBoundingClientRect();
        const position = horizontal ? rect.left - bounds.left : rect.top - bounds.top;
        const next = (position + (event.key === positive ? 24 : -24)) / size;
        latestRatio.current = next;
        onResize(next);
        onCommitResize(next);
      }}
    />
  );
}
