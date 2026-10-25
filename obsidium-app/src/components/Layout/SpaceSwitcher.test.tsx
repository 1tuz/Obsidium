// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { SettingsProvider } from '../../modules/settings';
import { useSpaces } from '../../hooks/useSpaces';
import { t } from '../../i18n';
import type { Space } from '../../modules/spaces';
import { SpaceSwitcher } from './SpaceSwitcher';

const events = vi.hoisted(() => ({
  listener: null as null | ((event: { payload: string[] }) => void),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: (event: { payload: string[] }) => void) => {
    events.listener = handler;
    return Promise.resolve(() => {
      events.listener = null;
    });
  },
}));

const invokeMock = vi.mocked(invoke);

const spaces: Space[] = [
  { id: 'all', name: 'All notes', root: '', includeTags: [], excludeFolders: [] },
  { id: 'work', name: 'Work', root: 'projects', includeTags: [], excludeFolders: [] },
  { id: 'archive', name: 'Archive', root: 'archive', includeTags: ['old'], excludeFolders: [] },
];

function Harness({ workspacePath }: { workspacePath: string }) {
  const controller = useSpaces(workspacePath);
  return (
    <SpaceSwitcher
      spaces={controller.spaces}
      activeSpaceId={controller.activeSpaceId}
      onSelect={controller.selectSpace}
      onManage={() => {}}
    />
  );
}

async function openSwitcher(renderer: MountedDom): Promise<HTMLButtonElement> {
  const trigger = renderer.container.querySelector<HTMLButtonElement>(
    `[aria-label="${t('spaces.switcher')}"]`,
  );
  expect(trigger).not.toBeNull();
  await actAndSettle(() => {
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return trigger!;
}

function optionNamed(name: string): HTMLButtonElement {
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((element) => element.textContent === name);
  expect(option).toBeDefined();
  return option!;
}

describe('SpaceSwitcher', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    invokeMock.mockReset();
    events.listener = null;
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.clearAllMocks();
  });

  it('shows the active space name and lists every space', async () => {
    await actAndSettle(() => {
      renderer = mountDom(
        <SpaceSwitcher
          spaces={spaces}
          activeSpaceId="all"
          onSelect={vi.fn()}
          onManage={vi.fn()}
        />,
      );
    });

    expect(renderer!.container.querySelector('[data-space-switcher]')).not.toBeNull();
    expect(renderer!.container.textContent).toContain('All notes');

    await openSwitcher(renderer!);

    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent))
      .toEqual(['All notes', 'Work', 'Archive']);
  });

  it('reports the selected space id', async () => {
    const onSelect = vi.fn();
    await actAndSettle(() => {
      renderer = mountDom(
        <SpaceSwitcher
          spaces={spaces}
          activeSpaceId="all"
          onSelect={onSelect}
          onManage={vi.fn()}
        />,
      );
    });

    await openSwitcher(renderer!);
    await actAndSettle(() => {
      optionNamed('Archive').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('archive');
  });

  it('opens space management', async () => {
    const onManage = vi.fn();
    await actAndSettle(() => {
      renderer = mountDom(
        <SpaceSwitcher
          spaces={spaces}
          activeSpaceId="all"
          onSelect={vi.fn()}
          onManage={onManage}
        />,
      );
    });

    const manage = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('spaces.manage')}"]`,
    );
    expect(manage).not.toBeNull();
    act(() => {
      manage!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('requests the filtered files of the selected space', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'get_spaces') return spaces;
      if (command === 'list_space_files') return ['/vault/projects/plan.md'];
      return null;
    });

    await actAndSettle(() => {
      renderer = mountDom(
        <SettingsProvider>
          <Harness workspacePath="/vault" />
        </SettingsProvider>,
      );
    });

    expect(renderer!.container.textContent).toContain('All notes');
    expect(invokeMock).not.toHaveBeenCalledWith('list_space_files', expect.anything());

    await openSwitcher(renderer!);
    await actAndSettle(() => {
      optionNamed('Work').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(invokeMock).toHaveBeenCalledWith('list_space_files', {
      workspacePath: '/vault',
      spaceId: 'work',
    });
    expect(renderer!.container.textContent).toContain('Work');
  });

  it('refreshes the filtered tree after a workspace change', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'get_spaces') return spaces;
      if (command === 'list_space_files') return ['/vault/projects/plan.md'];
      return null;
    });
    const requests = () => invokeMock.mock.calls.filter(([command]) => command === 'list_space_files');

    await actAndSettle(() => {
      renderer = mountDom(
        <SettingsProvider>
          <Harness workspacePath="/vault" />
        </SettingsProvider>,
      );
    });
    await openSwitcher(renderer!);
    await actAndSettle(() => {
      optionNamed('Work').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(requests()).toEqual([
      ['list_space_files', { workspacePath: '/vault', spaceId: 'work' }],
    ]);

    expect(events.listener).not.toBeNull();
    await actAndSettle(() => {
      events.listener!({ payload: ['/vault/projects/plan.md'] });
    });
    await actAndSettle(() => new Promise<void>((resolve) => {
      setTimeout(resolve, 90);
    }));

    expect(requests()).toEqual([
      ['list_space_files', { workspacePath: '/vault', spaceId: 'work' }],
      ['list_space_files', { workspacePath: '/vault', spaceId: 'work' }],
    ]);
  });
});
