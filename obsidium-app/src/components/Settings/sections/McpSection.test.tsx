// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../modules/settings';
import { setLanguage, t } from '../../../i18n';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { McpSection } from './McpSection';

vi.mock('../../../modules/mcp', () => ({
  applyMcpSettings: vi.fn(),
  createMcpToken: vi.fn(),
  getMcpStatus: vi.fn().mockResolvedValue({ running: true, port: 8787, executable: '/app/obsidium' }),
}));

vi.mock('../useSettingsPersist', () => ({
  useSettingsPersist: () => ({ persist: vi.fn() }),
}));

describe('McpSection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    setLanguage('en');
  });

  it('uses the Obsidium alias in generated MCP setup examples', async () => {
    const config = {
      mcp: { enabled: true, token: 'secret', port: 8787, allowWrite: false },
    } as AppConfig;
    await act(async () => {
      renderer = mountDom(<McpSection config={config} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const snippets = renderer!.container.querySelectorAll('.q-mcp-snippet__code');
    expect(snippets).toHaveLength(3);
    expect(renderer!.container.textContent).toContain('claude mcp add --transport http obsidium');
    expect(renderer!.container.textContent).toContain('[mcp_servers.obsidium]');
    expect(renderer!.container.textContent).toContain('"obsidium"');
    expect(renderer!.container.textContent).not.toContain('aquilum');
  });

  it('describes history retention without exposing the legacy storage name', () => {
    for (const locale of ['en', 'ru']) {
      setLanguage(locale);
      const hint = t('settings.history.retentionHint');
      expect(hint).not.toContain('aquilum');
      expect(hint).not.toContain('.aquilum');
    }
  });
});
