// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasCard, type CanvasCardNode } from './CanvasCard';
import { renderMarkdownToHtml } from '../../modules/export/markdownToHtml';

const node = (type: CanvasCardNode['type'], fields: Partial<CanvasCardNode> = {}): CanvasCardNode => ({
  id: 'card-1',
  type,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  ...fields,
});

describe('CanvasCard', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders formatted Markdown without allowing executable URL schemes', () => {
    act(() => {
      renderer = mountDom(<CanvasCard node={node('text', { text: '**bold** [unsafe](javascript:alert(1))' })} />);
    });

    expect(renderer!.container.querySelector('strong')?.textContent).toBe('bold');
    expect(renderer!.container.querySelector('a')?.getAttribute('href')).toBe('#');
  });

  it('emits inline text edits to the owner', async () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(<CanvasCard node={node('text', { text: 'before' })} editing onChange={onChange} />);
    });

    const editor = renderer!.container.querySelector('textarea')!;
    editor.value = 'after';
    await actAndSettle(() => { editor.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('card-1', 'after');
  });

  it('renders supplied file Markdown and resolves local images', () => {
    act(() => {
      renderer = mountDom(
        <CanvasCard
          node={node('file', { file: 'notes/Plan.md' })}
          markdown='![diagram](diagram.png)'
          resolveImageUrl={(_node, target) => `asset://${target}`}
        />,
      );
    });

    expect(renderer!.container.querySelector('.q-canvas-card__title')?.textContent).toBe('Plan.md');
    expect(renderer!.container.querySelector('img')?.getAttribute('src')).toBe('asset://diagram.png');
  });

  it('exposes the open hint on the file card title', () => {
    act(() => {
      renderer = mountDom(<CanvasCard node={node('file', { file: 'notes/Plan.md' })} openHint="Open note" />);
    });

    expect(renderer!.container.querySelector('.q-canvas-card__title')?.getAttribute('title')).toBe('Open note');
  });

  it('previews image links and exposes group children as a group', () => {
    act(() => {
      renderer = mountDom(
        <>
          <CanvasCard node={node('link', { url: 'https://example.test/image.png?width=400' })} />
          <CanvasCard node={node('group')}><span>Nested card</span></CanvasCard>
        </>,
      );
    });

    expect(renderer!.container.querySelector('.q-canvas-card__media-image')?.getAttribute('src'))
      .toBe('https://example.test/image.png?width=400');
    expect(renderer!.container.querySelector('[role="group"]')?.textContent).toBe('Nested card');
  });

  it('resolves relative image links from the workspace', () => {
    act(() => {
      renderer = mountDom(
        <CanvasCard
          node={node('link', { url: 'images/diagram.png' })}
          resolveImageUrl={(_node, target) => `asset://${target}`}
        />,
      );
    });

    expect(renderer!.container.querySelector('.q-canvas-card__media-image')?.getAttribute('src'))
      .toBe('asset://images/diagram.png');
  });

  it('applies standard Canvas colors through the inherited color token', () => {
    act(() => {
      renderer = mountDom(<CanvasCard node={node('text')} color="var(--q-red-600)" />);
    });

    const card = renderer!.container.querySelector('.q-canvas-card') as HTMLElement;
    expect(card.getAttribute('style')).toContain('--q-canvas-node-color: var(--q-red-600)');
  });

  it('separates shape rendering from card chrome', () => {
    act(() => {
      renderer = mountDom(
        <>
          <CanvasCard node={node('text', { text: 'inside' })} shape="diamond" />
          <CanvasCard node={node('text', { text: 'plain' })} />
        </>,
      );
    });

    const [shapeCard, plainCard] = [...renderer!.container.querySelectorAll<HTMLElement>('.q-canvas-card')];
    expect(shapeCard.classList.contains('q-canvas-card--shape')).toBe(true);
    expect(shapeCard.style.borderColor).toBe('');
    expect(plainCard.classList.contains('q-canvas-card--shape')).toBe(false);
  });

  it('renders a file card image without replacing it with the file name', () => {
    act(() => {
      renderer = mountDom(
        <CanvasCard
          node={node('file', { file: 'Files/photo.png' })}
          media={{ kind: 'image', src: 'asset://photo.png', label: 'photo.png' }}
        />,
      );
    });

    expect(renderer!.container.querySelector('.q-canvas-card__media-image')?.getAttribute('src')).toBe('asset://photo.png');
    expect(renderer!.container.querySelector('.q-canvas-card__title')).toBeNull();
  });

  it('prevents the default action before handing a note link to navigation', () => {
    const onOpenNoteLink = vi.fn((_target: string, _source: string) => {
      expect(currentEvent?.defaultPrevented).toBe(true);
    });
    let currentEvent: Event | null = null;
    act(() => {
      renderer = mountDom(
        <CanvasCard
          node={node('text', { text: '[[Note]]' })}
          onOpenNoteLink={onOpenNoteLink}
          resolveImageUrl={() => ''}
        />,
      );
    });
    const link = renderer!.container.querySelector<HTMLAnchorElement>('a[data-note-target]')!;
    expect(renderMarkdownToHtml('[[Note]]', { noteLinks: true })).toContain('data-note-target');
    currentEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(currentEvent!); });
    expect(onOpenNoteLink).toHaveBeenCalledWith('Note', 'wiki');
  });
});
