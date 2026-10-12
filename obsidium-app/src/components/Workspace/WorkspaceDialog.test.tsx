// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { WorkspaceDialog } from './WorkspaceDialog';

const workspaceMocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  forgetWorkspace: vi.fn(),
  pickWorkspaceFolder: vi.fn(),
}));

vi.mock('../../modules/workspaces', () => ({
  listWorkspaces: workspaceMocks.listWorkspaces,
  forgetWorkspace: workspaceMocks.forgetWorkspace,
  pickWorkspaceFolder: workspaceMocks.pickWorkspaceFolder,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

describe('WorkspaceDialog', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.clearAllMocks();
  });

  it('keeps multiple workspaces visible and exposes their management menu', async () => {
    workspaceMocks.listWorkspaces.mockResolvedValue([
      { id: 'workspace-appfarm', path: '/vaults/AppFarm', lastSeenMs: 2, homePage: '' },
      { id: 'workspace-komus', path: '/vaults/komus', lastSeenMs: 1, homePage: '' },
    ]);
    await actAndSettle(() => {
      renderer = mountDom(
        <WorkspaceDialog
          open
          currentPath="/vaults/AppFarm"
          onClose={vi.fn()}
          onOpenWorkspace={vi.fn(async () => true)}
        />,
      );
    });

    expect(document.body.textContent).toContain('AppFarm');
    expect(document.body.textContent).toContain('komus');

    const manageButton = [...document.querySelectorAll('button')]
      .find((button) => /manage vaults|управление хранилищами/i.test(button.textContent ?? ''));
    expect(manageButton).toBeDefined();
    act(() => {
      manageButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const row = [...document.querySelectorAll('.q-workspace-row')]
      .find((element) => element.textContent?.includes('komus'));
    act(() => {
      row?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }));
    });

    expect(document.querySelector('[role="menu"]')?.textContent).toMatch(/copy vault ID|скопировать ID хранилища/i);
    expect(document.querySelector('[role="menu"]')?.textContent).toMatch(/show in file manager|показать папку/i);
  });
});
