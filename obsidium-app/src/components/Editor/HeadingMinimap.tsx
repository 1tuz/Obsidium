import { useEffect, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { t } from '../../i18n';
import { subscribeMinimap, type MinimapState } from './extensions/blocks/minimapBridge';
import './HeadingMinimap.css';

const EMPTY_MINIMAP: MinimapState = { marks: [], activeIndex: -1 };

const LEVEL_WIDTHS: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 10, 6: 8 };

export function HeadingMinimap({ view }: { view: EditorView | null }) {
  const [state, setState] = useState<MinimapState>(EMPTY_MINIMAP);

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

  return (
    <nav className="q-block-minimap" aria-label={t('blocks.minimapLabel')}>
      {state.marks.map((mark, index) => (
        <button
          key={`${mark.pos}-${index}`}
          type="button"
          className="q-block-minimap__stroke"
          data-kind={mark.kind}
          data-level={mark.level}
          style={{
            width: mark.kind === 'heading'
              ? LEVEL_WIDTHS[mark.level] ?? 8
              : mark.kind === 'listItem' ? Math.max(4, 9 - mark.level) : 8,
            top: `${mark.ratio * 100}%`,
          }}
          title={mark.text}
          aria-current={index === state.activeIndex ? 'true' : undefined}
          onClick={() => jump(mark.pos)}
        />
      ))}
    </nav>
  );
}
