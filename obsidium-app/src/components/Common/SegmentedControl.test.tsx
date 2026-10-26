// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('SegmentedControl', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  const buttons = () => [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-segmented-control__button')];

  it('marks the selected option as a checked radio', () => {
    act(() => { renderer = mountDom(<SegmentedControl options={options} value="b" onChange={() => {}} />); });

    expect(renderer!.container.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(buttons().map((button) => button.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(buttons().map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(buttons().map((button) => button.getAttribute('aria-pressed'))).toEqual([null, null, null]);
  });

  it('reports the clicked option', () => {
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<SegmentedControl options={options} value="a" onChange={onChange} />); });

    act(() => { buttons()[2].click(); });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('moves the selection with arrow keys and keeps a single tab stop', () => {
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<SegmentedControl options={options} value="a" onChange={onChange} />); });

    const [first, , last] = buttons();
    expect(first.tabIndex).toBe(0);
    expect(last.tabIndex).toBe(-1);

    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(last);
  });
});
