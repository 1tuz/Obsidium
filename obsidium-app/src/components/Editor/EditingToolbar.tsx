import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import {
  Bold, Italic, Strikethrough, Highlighter, Code, Heading1, Heading2,
  Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListTodo,
  Quote, Link2, Image, Table2,
  Minus, Undo2, Redo2, IndentIncrease, IndentDecrease, type IconNode,
} from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import { runEditingAction, type EditingAction } from './editingToolbarActions';
import { applyColoredHighlight, removeColoredHighlight } from './extensions/highlightr';
import './EditingToolbar.css';

export type EditingToolbarPosition = 'top' | 'selection';

interface EditingToolbarProps {
  view: EditorView | null;
  position: EditingToolbarPosition;
  highlightrEnabled?: boolean;
  highlightColors?: readonly string[];
}

interface ButtonDefinition {
  action: EditingAction;
  icon: IconNode;
}

const GROUPS: readonly (readonly ButtonDefinition[])[] = [
  [{ action: 'undo', icon: Undo2 }, { action: 'redo', icon: Redo2 }],
  [{ action: 'h1', icon: Heading1 }, { action: 'h2', icon: Heading2 }, { action: 'h3', icon: Heading3 },
    { action: 'h4', icon: Heading4 }, { action: 'h5', icon: Heading5 }, { action: 'h6', icon: Heading6 }],
  [{ action: 'bold', icon: Bold }, { action: 'italic', icon: Italic },
    { action: 'strike', icon: Strikethrough }, { action: 'highlight', icon: Highlighter },
    { action: 'inlineCode', icon: Code }],
  [{ action: 'bullet', icon: List }, { action: 'ordered', icon: ListOrdered },
    { action: 'task', icon: ListTodo }, { action: 'quote', icon: Quote }],
  [{ action: 'link', icon: Link2 }, { action: 'image', icon: Image }, { action: 'table', icon: Table2 },
    { action: 'codeBlock', icon: Code }, { action: 'rule', icon: Minus }],
  [{ action: 'indent', icon: IndentIncrease }, { action: 'outdent', icon: IndentDecrease }],
];

interface Point {
  left: number;
  top: number;
}

function selectionCoordinates(view: EditorView): Point | null {
  const selection = view.state.selection.main;
  if (!view.hasFocus || selection.empty) return null;
  const rectangle = view.coordsAtPos(selection.from);
  if (!rectangle) return null;
  return {
    left: Math.max(8, Math.min(rectangle.left, window.innerWidth - 660)),
    top: Math.max(8, rectangle.top - 52),
  };
}

export function EditingToolbar({
  view, position, highlightrEnabled = true, highlightColors = ['#ffe96b'],
}: EditingToolbarProps) {
  const [point, setPoint] = useState<Point | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [palettePoint, setPalettePoint] = useState<Point>({ left: 8, top: 8 });

  useEffect(() => {
    if (!paletteOpen) return;
    const place = () => {
      const rect = toolbarRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPalettePoint({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 310)),
        top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 80)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [paletteOpen]);

  useEffect(() => {
    if (!view || position !== 'selection') return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPoint(selectionCoordinates(view)));
    };
    update();
    view.dom.addEventListener('mouseup', update);
    view.dom.addEventListener('keyup', update);
    view.dom.addEventListener('focusin', update);
    view.dom.addEventListener('focusout', update);
    document.addEventListener('selectionchange', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      view.dom.removeEventListener('mouseup', update);
      view.dom.removeEventListener('keyup', update);
      view.dom.removeEventListener('focusin', update);
      view.dom.removeEventListener('focusout', update);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [position, view]);

  if (position === 'selection' && (!view || !point)) return null;

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('editor.formatting.toolbar')}
      className={`q-editing-toolbar${position === 'selection' ? ' q-editing-toolbar--floating' : ' q-editing-toolbar--top'}`}
      style={position === 'selection' && point ? { left: point.left, top: point.top } : undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      {GROUPS.map((group, index) => (
        <div className="q-editing-toolbar__group" key={index}>
          {group.map(({ action, icon }) => {
            const label = t(`editor.formatting.${action}`);
            return (
              <IconButton
                key={action}
                size="small"
                label={label}
                disabled={!view || view.state.readOnly}
                onClick={() => {
                  if (!view) return;
                  if (action === 'highlight' && highlightrEnabled) setPaletteOpen((open) => !open);
                  else runEditingAction(view, action);
                }}
              >
                <Icon icon={icon} />
              </IconButton>
            );
          })}
        </div>
      ))}
      {highlightrEnabled && paletteOpen && view && createPortal(<div className="q-editing-toolbar__palette"
        style={{ left: palettePoint.left, top: palettePoint.top }}
        onMouseDown={(event) => event.preventDefault()}
        role="group" aria-label={t('settings.builtins.palette')}>
        {highlightColors.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).map((color, index) => (
          <button type="button" key={`${color}-${index}`}
            className="q-editing-toolbar__color"
            title={color} aria-label={color}
            style={{ backgroundColor: color }}
            onClick={() => { applyColoredHighlight(view, color); setPaletteOpen(false); }} />
        ))}
        <button type="button" onClick={() => { removeColoredHighlight(view); setPaletteOpen(false); }}>
          {t('settings.builtins.removeColor')}
        </button>
      </div>, document.body)}
    </div>
  );
}
