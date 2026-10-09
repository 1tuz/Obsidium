import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './registry';

describe('CommandRegistry', () => {
  it('ranks prefix matches before loose matches', () => {
    const registry = new CommandRegistry([
      { id: 'view.graph', title: 'Open graph', run() {} },
      { id: 'search.global', title: 'Search knowledge base', keywords: ['open finder'], run() {} },
    ]);

    expect(registry.search('open').map((command) => command.id)).toEqual([
      'view.graph',
      'search.global',
    ]);
  });

  it('does not expose disabled commands', () => {
    const registry = new CommandRegistry([
      { id: 'enabled', title: 'Enabled', run() {} },
      { id: 'disabled', title: 'Disabled', enabled: () => false, run() {} },
    ]);
    expect(registry.list().map((command) => command.id)).toEqual(['enabled']);
  });

  it('executes commands by stable id', async () => {
    const run = vi.fn();
    const registry = new CommandRegistry([{ id: 'note.new', title: 'New note', run }]);
    await expect(registry.execute('note.new')).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
