// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { Dialog } from './Dialog';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      title="Harness"
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    >
      <button type="button">inside</button>
    </Dialog>
  );
}

describe('Dialog', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('closes on Escape even when the focused field swallows the key', async () => {
    const onClose = vi.fn();
    act(() => { renderer = mountDom(<Harness onClose={onClose} />); });
    await actAndSettle();

    const field = renderer!.container.querySelector<HTMLInputElement>('input') ?? renderer!.container.querySelector<HTMLElement>('button')!;
    field.focus();
    await actAndSettle(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(renderer!.container.querySelector('.q-dialog')).toBeNull();
  });

  it('ignores Escape when a later dialog is stacked on top', async () => {
    const onClose = vi.fn();
    act(() => {
      renderer = mountDom(
        <div>
          <Harness onClose={onClose} />
          <div className="q-dialog">top</div>
        </div>,
      );
    });
    await actAndSettle();
    await actAndSettle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
