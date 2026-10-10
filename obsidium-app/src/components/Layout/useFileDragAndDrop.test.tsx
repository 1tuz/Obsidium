// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom } from '../../testing/mountDom';
import { useFileTreeDrag } from './useFileDragAndDrop';

function DragTree({ onDrop }: { onDrop: (source: string, target: string) => void }) {
  const container = useRef<HTMLElement | null>(null);
  useFileTreeDrag(container, (path) => [path], onDrop);
  return (
    <div ref={container}>
      <div data-file-id="/vault/Project.base" data-file-type="file" data-file-name="Project" />
      <div data-file-id="/vault/Work" data-file-type="folder" data-file-name="Work" />
    </div>
  );
}

describe('file tree drag', () => {
  it('moves a Base file after holding the primary mouse button and dropping on a folder', async () => {
    const onDrop = vi.fn();
    const tree = mountDom(<DragTree onDrop={onDrop} />);
    await actAndSettle(() => new Promise((resolve) => setTimeout(resolve, 30)));
    const source = tree.container.querySelector('[data-file-id="/vault/Project.base"]')!;
    const target = tree.container.querySelector('[data-file-id="/vault/Work"]')!;

    act(() => {
      source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 1 }));
      document.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 1 }));
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    });

    expect(onDrop).toHaveBeenCalledWith('/vault/Project.base', '/vault/Work');
    act(() => tree.unmount());
  });
});
