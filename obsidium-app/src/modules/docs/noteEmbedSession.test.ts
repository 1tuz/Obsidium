import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { PullResult } from '../documents/documentGateway';
import { NoteEmbedSession } from './noteEmbedSession';
import type { NoteEmbedBlockReason, NoteEmbedReplica } from './noteEmbedSession';

const SOURCE = '# Intro\nintro\n\n## Plan\n- one\n- two\n\n## Next\nend';

class FakeReplica implements NoteEmbedReplica {
  text: string;
  readonly log: { client: string; changes: unknown }[] = [];
  pushes = 0;
  private readonly handlers = new Set<() => void>();

  constructor(text: string) {
    this.text = text;
  }

  get version(): number {
    return this.log.length;
  }

  async open(path: string): Promise<{ text: string; version: number }> {
    return this.read(path);
  }

  async read(_path: string): Promise<{ text: string; version: number }> {
    return { text: this.text, version: this.log.length };
  }

  async release(_path: string): Promise<void> {}

  async push(_path: string, version: number, client: string, changes: unknown[]): Promise<boolean> {
    this.pushes += 1;
    if (version !== this.log.length) return false;
    this.apply(client, ChangeSet.fromJSON(changes[0]), true);
    return true;
  }

  async pull(_path: string, version: number): Promise<PullResult> {
    if (version > this.log.length) return { kind: 'resync', text: this.text, version: this.log.length };
    return { kind: 'changes', changes: this.log.slice(version) };
  }

  onChange(_path: string, handler: () => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  foreign(client: string, change: ChangeSet, notify = true): void {
    this.apply(client, change, notify);
  }

  private apply(client: string, change: ChangeSet, notify: boolean): void {
    this.text = change.apply(Text.of(this.text.split('\n'))).toString();
    this.log.push({ client, changes: change.toJSON() });
    if (notify) for (const handler of this.handlers) handler();
  }
}

async function flush(): Promise<void> {
  for (let round = 0; round < 64; round += 1) await Promise.resolve();
}

function changeOn(text: string, from: number, to: number, insert: string): ChangeSet {
  return ChangeSet.of({ from, to, insert }, text.length);
}

function setup(source = SOURCE) {
  const replica = new FakeReplica(source);
  const texts: string[] = [];
  const blocked: NoteEmbedBlockReason[] = [];
  const session = new NoteEmbedSession({
    path: 'Note.md',
    heading: 'Plan',
    clientId: 'me',
    replica,
    onText: (text) => texts.push(text),
    onBlocked: (reason) => blocked.push(reason),
  });
  return { replica, session, texts, blocked };
}

describe('note embed session', () => {
  it('pushes local edits inside the section and leaves the rest of the note untouched', async () => {
    const { replica, session, texts } = setup();
    await session.start();
    expect(texts[texts.length - 1]).toBe('- one\n- two\n');
    session.applyLocal(changeOn('- one\n- two\n', 12, 12, '- three\n'));
    await flush();
    expect(replica.text).toBe('# Intro\nintro\n\n## Plan\n- one\n- two\n- three\n\n## Next\nend');
    expect(texts[texts.length - 1]).toBe('- one\n- two\n- three\n');
  });

  it('restores the source when the inverse change set is applied', async () => {
    const { replica, session } = setup();
    await session.start();
    session.applyLocal(changeOn('- one\n- two\n', 12, 12, '- three\n'));
    await flush();
    session.applyLocal(changeOn('- one\n- two\n- three\n', 12, 20, ''));
    await flush();
    expect(replica.text).toBe(SOURCE);
  });

  it('blocks when another client deletes the heading', async () => {
    const { replica, session, blocked } = setup();
    await session.start();
    const from = SOURCE.indexOf('## Plan');
    replica.foreign('other', changeOn(SOURCE, from, SOURCE.indexOf('- one'), ''));
    await flush();
    expect(blocked).toEqual(['missing-heading']);
    const pushes = replica.pushes;
    session.applyLocal(changeOn('- one\n- two\n', 0, 0, 'x'));
    await flush();
    expect(replica.pushes).toBe(pushes);
    expect(replica.text).toBe('# Intro\nintro\n\n- one\n- two\n\n## Next\nend');
  });

  it('shifts the range when another client edits before the section', async () => {
    const { replica, session, texts, blocked } = setup();
    await session.start();
    replica.foreign('other', changeOn(SOURCE, 0, 0, 'extra\n'));
    await flush();
    expect(blocked).toEqual([]);
    expect(texts[texts.length - 1]).toBe('- one\n- two\n');
    session.applyLocal(changeOn('- one\n- two\n', 0, 0, 'X'));
    await flush();
    expect(replica.text).toBe('extra\n# Intro\nintro\n\n## Plan\nX- one\n- two\n\n## Next\nend');
    expect(texts[texts.length - 1]).toBe('X- one\n- two\n');
  });

  it('blocks when a foreign change crosses the section boundary', async () => {
    const { replica, session, blocked } = setup();
    await session.start();
    const from = SOURCE.indexOf('## Plan');
    replica.foreign('other', changeOn(SOURCE, from, SOURCE.indexOf('- one') + 2, '## Plan\n- '));
    await flush();
    expect(blocked).toEqual(['range-changed']);
  });

  it('resyncs through read when a push is rejected and stays usable', async () => {
    const { replica, session, texts, blocked } = setup();
    await session.start();
    replica.foreign('other', changeOn(SOURCE, SOURCE.length, SOURCE.length, '!'), false);
    session.applyLocal(changeOn('- one\n- two\n', 0, 0, 'X'));
    await flush();
    expect(blocked).toEqual([]);
    expect(texts[texts.length - 1]).toBe('- one\n- two\n');
    expect(replica.text).toBe(`${SOURCE}!`);
    session.applyLocal(changeOn('- one\n- two\n', 0, 0, 'Y'));
    await flush();
    expect(replica.text).toBe(`${SOURCE}!`.replace('- one', 'Y- one'));
    expect(texts[texts.length - 1]).toBe('Y- one\n- two\n');
  });

  it('keeps the heading intact when the section ends the note', async () => {
    const source = '# Intro\n## Plan';
    const { replica, session, texts, blocked } = setup(source);
    await session.start();
    session.applyLocal(changeOn('', 0, 0, 'x'));
    await flush();
    expect(blocked).toEqual([]);
    expect(replica.text).toBe('# Intro\n## Plan\nx');
    expect(texts[texts.length - 1]).toBe('x');
  });

  it('reports a missing note instead of editing', async () => {
    const replica = new FakeReplica(SOURCE);
    replica.open = async () => {
      throw new Error('missing');
    };
    const blocked: NoteEmbedBlockReason[] = [];
    const session = new NoteEmbedSession({
      path: 'Gone.md',
      heading: 'Plan',
      clientId: 'me',
      replica,
      onText: () => {},
      onBlocked: (reason) => blocked.push(reason),
    });
    await session.start();
    expect(blocked).toEqual(['missing-note']);
    expect(replica.pushes).toBe(0);
  });
});
