import { useCallback, useEffect, useRef } from 'react';
import type { JSX, TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import {
  PANEL_LIMITS,
  clampPanelWidth,
  resizePanel,
  type PanelSide,
} from '../../modules/layout/panelWidth';
import './PanelResizer.css';

const KEYBOARD_STEP = 16;
const RESIZE_KEYS: Record<string, true> = {
  ArrowLeft: true,
  ArrowRight: true,
  Home: true,
  End: true,
};

export function PanelResizer({ side, width, onResize, onReset, label }: {
  side: PanelSide;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
}): JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const keyboardResizing = useRef(false);
  const { min, max } = PANEL_LIMITS[side];

  const syncResizingFlag = useCallback(() => {
    const resizing = drag.current !== null || keyboardResizing.current;
    if (resizing) document.documentElement.dataset.panelResizing = 'true';
    else delete document.documentElement.dataset.panelResizing;
  }, []);

  useEffect(() => () => {
    delete document.documentElement.dataset.panelResizing;
  }, []);

  const handlePointerDown = (event: TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { startX: event.clientX, startWidth: width };
    syncResizingFlag();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    onResize(resizePanel(side, current.startWidth, event.clientX - current.startX));
  };

  const endDrag = () => {
    drag.current = null;
    syncResizingFlag();
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!RESIZE_KEYS[event.key]) return;
    event.preventDefault();
    keyboardResizing.current = true;
    syncResizingFlag();
    if (event.key === 'ArrowLeft') onResize(clampPanelWidth(side, width - KEYBOARD_STEP));
    else if (event.key === 'ArrowRight') onResize(clampPanelWidth(side, width + KEYBOARD_STEP));
    else if (event.key === 'Home') onResize(min);
    else onResize(max);
  };

  const handleKeyUp = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!RESIZE_KEYS[event.key]) return;
    keyboardResizing.current = false;
    syncResizingFlag();
  };

  const handleBlur = () => {
    if (!keyboardResizing.current) return;
    keyboardResizing.current = false;
    syncResizingFlag();
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
      onKeyUp={handleKeyUp}
      onBlur={handleBlur}
      onDblClick={onReset}
    />
  );
}
