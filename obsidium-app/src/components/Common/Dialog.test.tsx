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

function TriggerHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="trigger" onClick={() => setOpen(true)}>open</button>
      <Dialog open={open} title="Harness" closeLabel="Close" onClose={() => { onClose(); setOpen(false); }}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Dialog>
    </div>
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

  it('moves focus into the panel when it opens', async () => {
    const onClose = vi.fn();
    act(() => { renderer = mountDom(<Harness onClose={onClose} />); });
    await actAndSettle();

    const panel = renderer!.container.querySelector<HTMLElement>('.q-dialog')!;
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('cycles Tab from the last focusable element back to the first', async () => {
    const onClose = vi.fn();
    act(() => { renderer = mountDom(<TriggerHarness onClose={onClose} />); });
    await actAndSettle();

    const trigger = renderer!.container.querySelector<HTMLButtonElement>('.trigger')!;
    trigger.focus();
    await actAndSettle(() => { trigger.click(); });

    const panel = renderer!.container.querySelector<HTMLElement>('.q-dialog')!;
    const focusable = [...panel.querySelectorAll<HTMLButtonElement>('button')];
    const last = focusable[focusable.length - 1];
    last.focus();
    await actAndSettle(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('returns focus to the trigger on close', async () => {
    const onClose = vi.fn();
    act(() => { renderer = mountDom(<TriggerHarness onClose={onClose} />); });
    await actAndSettle();

    const trigger = renderer!.container.querySelector<HTMLButtonElement>('.trigger')!;
    trigger.focus();
    await actAndSettle(() => { trigger.click(); });

    const panel = renderer!.container.querySelector<HTMLElement>('.q-dialog')!;
    expect(panel.contains(document.activeElement)).toBe(true);

    await actAndSettle(() => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(renderer!.container.querySelector('.q-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
