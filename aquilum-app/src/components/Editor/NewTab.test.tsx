import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { NewTab } from './NewTab';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('NewTab', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders and invokes the three new-tab actions', () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    act(() => {
      renderer = create(<NewTab onCreate={onCreate} onOpen={onOpen} onClose={onClose} />);
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual([
      t('editor.createNote'),
      t('editor.openFile'),
      t('editor.close'),
    ]);

    act(() => buttons.forEach((button) => button.props.onClick()));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
