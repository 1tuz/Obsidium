// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';
import { CanvasLinkDialog, normalizeCanvasLink } from './CanvasLinkDialog';

const input = (renderer: MountedDom) => renderer.container.querySelector<HTMLInputElement>('input')!;

async function type(renderer: MountedDom, value: string): Promise<void> {
  const field = input(renderer);
  field.value = value;
  await actAndSettle(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(renderer: MountedDom): Promise<void> {
  await actAndSettle(() => {
    renderer.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('normalizeCanvasLink', () => {
  it('trims allowed addresses and keeps their scheme', () => {
    expect(normalizeCanvasLink('  https://example.test/page  ')).toBe('https://example.test/page');
    expect(normalizeCanvasLink('HTTP://example.test')).toBe('HTTP://example.test');
    expect(normalizeCanvasLink('mailto:user@example.test')).toBe('mailto:user@example.test');
    expect(normalizeCanvasLink('tel:+15551234')).toBe('tel:+15551234');
  });

  it('treats schemeless values as workspace-relative paths', () => {
    expect(normalizeCanvasLink(' notes/Plan.md ')).toBe('notes/Plan.md');
    expect(normalizeCanvasLink('./diagram.png')).toBe('./diagram.png');
  });

  it('rejects empty, protocol-relative and unsupported schemes', () => {
    expect(normalizeCanvasLink('')).toBeNull();
    expect(normalizeCanvasLink('   ')).toBeNull();
    expect(normalizeCanvasLink('//example.test/page')).toBeNull();
    expect(normalizeCanvasLink('javascript:alert(1)')).toBeNull();
    expect(normalizeCanvasLink('ftp://example.test/file')).toBeNull();
    expect(normalizeCanvasLink('data:text/html,<p>x</p>')).toBeNull();
  });
});

describe('CanvasLinkDialog', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.clearAllMocks();
  });

  it('blocks an invalid address and keeps the dialog open', async () => {
    const onSubmit = vi.fn();
    act(() => {
      renderer = mountDom(<CanvasLinkDialog open mode="add" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    await type(renderer!, 'javascript:alert(1)');
    await submit(renderer!);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent).toBe(t('canvas.link.invalid'));
    expect(renderer!.container.querySelector('.q-canvas-link-dialog')).not.toBeNull();
  });

  it('submits the trimmed address in add mode', async () => {
    const onSubmit = vi.fn();
    act(() => {
      renderer = mountDom(<CanvasLinkDialog open mode="add" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    expect(renderer!.container.querySelector('.q-dialog__title')?.textContent).toBe(t('canvas.link.addTitle'));
    expect(input(renderer!).getAttribute('aria-label')).toBe(t('canvas.link.address'));
    expect(input(renderer!).getAttribute('placeholder')).toBe('https://');

    await type(renderer!, '  https://example.test/page  ');
    await submit(renderer!);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('https://example.test/page');
    expect(renderer!.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('prefills the address in edit mode and saves it', async () => {
    const onSubmit = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasLinkDialog open mode="edit" initialValue="notes/Plan.md" onClose={vi.fn()} onSubmit={onSubmit} />,
      );
    });

    expect(renderer!.container.querySelector('.q-dialog__title')?.textContent).toBe(t('canvas.link.editTitle'));
    expect(input(renderer!).value).toBe('notes/Plan.md');
    expect(renderer!.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent)
      .toBe(t('canvas.link.save'));

    await type(renderer!, 'notes/Other.md');
    await submit(renderer!);

    expect(onSubmit).toHaveBeenCalledWith('notes/Other.md');
  });

  it('resets the address and error when reopened or the initial value changes', async () => {
    const onSubmit = vi.fn();
    act(() => {
      renderer = mountDom(<CanvasLinkDialog open mode="add" initialValue="notes/Plan.md" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    await type(renderer!, 'javascript:alert(1)');
    await submit(renderer!);
    expect(renderer!.container.querySelector('[role="alert"]')).not.toBeNull();

    await actAndSettle(() => {
      renderer!.update(<CanvasLinkDialog open={false} mode="add" initialValue="notes/Plan.md" onClose={vi.fn()} onSubmit={onSubmit} />);
    });
    await actAndSettle(() => {
      renderer!.update(<CanvasLinkDialog open mode="add" initialValue="notes/Plan.md" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    expect(input(renderer!).value).toBe('notes/Plan.md');
    expect(renderer!.container.querySelector('[role="alert"]')).toBeNull();

    await actAndSettle(() => {
      renderer!.update(<CanvasLinkDialog open mode="edit" initialValue="notes/Other.md" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    expect(input(renderer!).value).toBe('notes/Other.md');
  });
});
