import { useEffect, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { t } from '../../i18n';
import { subscribeMinimap, type MinimapMark, type MinimapState } from './extensions/blocks/minimapBridge';
import './HeadingMinimap.css';

const EMPTY_MINIMAP: MinimapState = { marks: [], activeIndex: -1, top: 0, viewportHeight: 0 };

const LEVEL_WIDTHS: Record<number, number> = { 1: 15, 2: 14, 3: 13, 4: 12, 5: 11, 6: 10 };

const MIN_ROW_STEP = 3;
const MAX_ROW_STEP = 12;
const DOCK_REACH = 3;
const DOCK_GAIN = 0.6;
const MAX_SCALE_FACTOR = 1.5;

export interface MinimapRow {
  mark: MinimapMark;
  source: number;
}

export function markWidth(level: number, factor: number): number {
  return Math.round((LEVEL_WIDTHS[level] ?? LEVEL_WIDTHS[6]!) * Math.min(MAX_SCALE_FACTOR, factor));
}

export function minimapRows(
  marks: readonly MinimapMark[],
  viewportHeight: number,
  activeIndex: number,
): MinimapRow[] {
  if (marks.length === 0) return [];
  const all = marks.map((mark, source) => ({ mark, source }));
  if (viewportHeight <= 0) return all;
  const capacity = Math.max(1, Math.floor(viewportHeight / MIN_ROW_STEP));
  const stride = Math.max(1, Math.ceil(marks.length / capacity));
  const rows: MinimapRow[] = [];
  for (let index = 0; index < marks.length; index += stride) {
    rows.push({ mark: marks[index]!, source: index });
  }
  if (activeIndex >= 0 && activeIndex < marks.length && rows.every((row) => row.source !== activeIndex)) {
    rows.push({ mark: marks[activeIndex]!, source: activeIndex });
    rows.sort((left, right) => left.source - right.source);
  }
  return rows;
}

export function rowStep(count: number, viewportHeight: number): number {
  if (count <= 0 || viewportHeight <= 0) return MAX_ROW_STEP;
  return Math.max(MIN_ROW_STEP, Math.min(MAX_ROW_STEP, Math.floor(viewportHeight / count)));
}

export function dockFactor(distance: number, step: number): number {
  return 1 + DOCK_GAIN * Math.max(0, 1 - distance / (step * DOCK_REACH));
}

export function HeadingMinimap({ view }: { view: EditorView | null }) {
  const [state, setState] = useState<MinimapState>(EMPTY_MINIMAP);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!view) {
      setState(EMPTY_MINIMAP);
      return;
    }
    return subscribeMinimap(view, setState);
  }, [view]);

  if (!view || state.marks.length === 0) return null;

  const jump = (pos: number) => {
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
    view.focus();
  };

  const rows = minimapRows(state.marks, state.viewportHeight, state.activeIndex);
  const step = rowStep(rows.length, state.viewportHeight);
  const hoveredRow = hovered !== null ? rows[hovered] : undefined;

  return (
    <nav
      className="q-block-minimap"
      aria-label={t('blocks.minimapLabel')}
      style={{ top: state.top, height: rows.length * step }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const row = Math.floor((event.clientY - rect.top) / step);
        setHovered(row >= 0 && row < rows.length ? row : null);
      }}
      onPointerLeave={() => setHovered(null)}
    >
      {hoveredRow ? (
        <span className="q-block-minimap__label" style={{ top: hovered! * step + step / 2 }}>
          {hoveredRow.mark.text}
        </span>
      ) : null}
      {rows.map((row, index) => {
        const factor = hovered === null ? 1 : dockFactor(Math.abs(index - hovered) * step, step);
        return (
          <button
            key={`${row.mark.pos}-${row.source}`}
            type="button"
            className="q-block-minimap__stroke"
            data-level={row.mark.level}
            style={{ width: markWidth(row.mark.level, factor), top: index * step + step / 2 }}
            aria-label={row.mark.text}
            aria-current={row.source === state.activeIndex ? 'true' : undefined}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={() => jump(row.mark.pos)}
          />
        );
      })}
    </nav>
  );
}
