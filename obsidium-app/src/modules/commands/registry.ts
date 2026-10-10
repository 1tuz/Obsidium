import type { ShortcutToken } from '../../config/shortcuts';

export interface AppCommand {
  id: string;
  title: string;
  keywords?: readonly string[];
  shortcut?: ShortcutToken;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

export interface RankedCommand {
  command: AppCommand;
  score: number;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scoreCommand(command: AppCommand, query: string): number {
  if (!query) return 1;
  const needle = normalized(query);
  const title = normalized(command.title);
  const id = normalized(command.id);
  const keywords = (command.keywords ?? []).map(normalized);

  if (title === needle || id === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (id.startsWith(needle)) return 70;
  if (keywords.some((item) => item.startsWith(needle))) return 60;
  if (title.includes(needle)) return 50;
  if (id.includes(needle)) return 40;
  if (keywords.some((item) => item.includes(needle))) return 30;

  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const haystack = [title, id, ...keywords].join(' ');
    if (words.every((word) => haystack.includes(word))) return 20;
  }
  return 0;
}

export class CommandRegistry {
  private readonly byId = new Map<string, AppCommand>();

  constructor(commands: readonly AppCommand[] = []) {
    for (const command of commands) this.register(command);
  }

  register(command: AppCommand): void {
    if (this.byId.has(command.id)) {
      throw new Error(`Duplicate command id: ${command.id}`);
    }
    this.byId.set(command.id, command);
  }

  list(): AppCommand[] {
    return [...this.byId.values()].filter((command) => command.enabled?.() !== false);
  }

  search(query: string): AppCommand[] {
    return this.list()
      .map((command): RankedCommand => ({ command, score: scoreCommand(command, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title))
      .map((entry) => entry.command);
  }

  async execute(id: string): Promise<boolean> {
    const command = this.byId.get(id);
    if (!command || command.enabled?.() === false) return false;
    await command.run();
    return true;
  }
}
