// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { WebPagePane } from './WebPagePane';

describe('WebPagePane', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (container) act(() => render(null, container!));
    container = null;
  });

  it('shows a validated website inside the tab content', () => {
    container = document.createElement('div');
    act(() => { render(<WebPagePane url="https://example.com/docs" />, container!); });

    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://example.com/docs');
    expect(frame?.getAttribute('title')).toBe('example.com');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });
});
