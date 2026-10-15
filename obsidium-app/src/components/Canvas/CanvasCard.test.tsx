// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { CanvasCard, type CanvasCardNode } from './CanvasCard';

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

  it('previews image links and exposes group children as a group', () => {
    act(() => {
      renderer = mountDom(
        <>
          <CanvasCard node={node('link', { url: 'https://example.test/image.png?width=400' })} />
          <CanvasCard node={node('group')}><span>Nested card</span></CanvasCard>
        </>,
      );
    });

    expect(renderer!.container.querySelector('.q-canvas-card__image')?.getAttribute('src'))
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

    expect(renderer!.container.querySelector('.q-canvas-card__image')?.getAttribute('src'))
      .toBe('asset://images/diagram.png');
  });

  it('applies standard Canvas colors through the inherited color token', () => {
    act(() => {
      renderer = mountDom(<CanvasCard node={node('text')} color="var(--q-red-600)" />);
    });

    const card = renderer!.container.querySelector('.q-canvas-card') as HTMLElement;
    expect(card.getAttribute('style')).toContain('--q-canvas-node-color: var(--q-red-600)');
  });

  it('applies the shape stroke color inline', () => {
    act(() => {
      renderer = mountDom(<CanvasCard node={node('text')} strokeColor="var(--q-canvas-default-stroke)" />);
    });

    const card = renderer!.container.querySelector('.q-canvas-card') as HTMLElement;
    expect(card.style.borderColor).toBe('var(--q-canvas-default-stroke)');
  });
});
