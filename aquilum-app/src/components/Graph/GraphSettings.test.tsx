// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { DEFAULT_PREFERENCES } from './graphDisplay';
import { GraphSettings } from './GraphSettings';

describe('GraphSettings', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('collapses to a compact control and restores graph settings', () => {
    act(() => {
      renderer = mountDom(
        <GraphSettings
          controls={{ ...DEFAULT_PREFERENCES, createdShare: 0 }}
          range={{ oldest: 0, newest: 1 }}
          onChange={() => {}}
          onRefresh={() => {}}
        />,
      );
    });

    const panel = renderer!.container.querySelector('aside')!;
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(4);
    const collapse = panel.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.collapseSettings')}"]`,
    );
    expect(collapse).not.toBeNull();

    act(() => collapse!.click());

    const expand = panel.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.expandSettings')}"]`,
    );
    expect(expand?.getAttribute('aria-expanded')).toBe('false');
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(0);

    act(() => expand!.click());

    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(4);
    expect(panel.querySelector(`[aria-label="${t('graph.collapseSettings')}"]`))
      .not.toBeNull();
  });
});
