import { useRef } from 'react';
import type { JSX, TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import {
  PANEL_LIMITS,
  clampPanelWidth,
  resizePanel,
  type PanelSide,
} from '../../modules/layout/panelWidth';
import './PanelResizer.css';

const KEYBOARD_STEP = 16;

export function PanelResizer({ side, width, onResize, onReset, label }: {
  side: PanelSide;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
}): JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const { min, max } = PANEL_LIMITS[side];

  const handlePointerDown = (event: TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { startX: event.clientX, startWidth: width };
    document.documentElement.dataset.panelResizing = 'true';
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    onResize(resizePanel(side, current.startWidth, event.clientX - current.startX));
  };

  const endDrag = () => {
    drag.current = null;
    delete document.documentElement.dataset.panelResizing;
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(clampPanelWidth(side, width - KEYBOARD_STEP));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(clampPanelWidth(side, width + KEYBOARD_STEP));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onResize(min);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      onResize(max);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`q-panel-resizer q-panel-resizer--${side}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDblClick={onReset}
    />
  );
}
