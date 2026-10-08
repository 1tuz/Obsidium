import { useEffect, useState } from 'react';
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
import './EditingToolbar.css';

export type EditingToolbarPosition = 'top' | 'selection';

interface EditingToolbarProps {
  view: EditorView | null;
  position: EditingToolbarPosition;
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

export function EditingToolbar({ view, position }: EditingToolbarProps) {
  const [point, setPoint] = useState<Point | null>(null);

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
      role="toolbar"
      aria-label={t('editor.formatting.toolbar')}
      className={`q-editing-toolbar${position === 'selection' ? ' q-editing-toolbar--floating' : ''}`}
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
                onClick={() => { if (view) runEditingAction(view, action); }}
              >
                <Icon icon={icon} />
              </IconButton>
            );
          })}
        </div>
      ))}
    </div>
  );
}
