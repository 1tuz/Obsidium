import {
  EDIT_WRITE,
  renameFile,
  writeFileAtomic,
  type WriteSource,
  type FileRenameResult,
  type FileSnapshot,
  type FileWriteResult,
} from './fileGateway';
import { clamp } from '../math';

const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 5_000;

interface ScheduledWrite {
  content: () => string;
  delayMs: number;
  onSaved: () => void;
  onError: (error: unknown) => void;
}

function isBlank(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  return true;
}

function abandonedByTruncation(previous: string, next: string): string | null {
  if (!isBlank(next) || isBlank(previous)) return null;
  return previous;
}

export class DocumentFileWriter {
  private tail: Promise<void> = Promise.resolve();
  private pending: ScheduledWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  onSynced: ((path: string, hash: string) => void) | null = null;

  onTruncate: ((path: string, previous: string) => void | Promise<void>) | null = null;

  constructor(
    private path: string,
    private hash: string,
    private content: string,
  ) {}

  get syncedHash(): string {
    return this.hash;
  }

  get syncedContent(): string {
    return this.content;
  }

  adopt(snapshot: FileSnapshot): void {
    this.hash = snapshot.hash;
    this.content = snapshot.content;
  }

  adoptPath(path: string): void {
    this.path = path;
  }

  schedule(request: ScheduledWrite): void {
    this.pending = request;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, clamp(request.delayMs, MIN_DELAY_MS, MAX_DELAY_MS));
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const request = this.pending;
    this.pending = null;
    if (!request) return this.tail;
    return this.write(request.content()).then(request.onSaved, request.onError);
  }

  write(content: string, source: WriteSource = EDIT_WRITE): Promise<FileWriteResult> {
    return this.enqueue(() => this.commit(content, source));
  }

  writeCurrent(read: () => string, source: WriteSource): Promise<FileWriteResult> {
    return this.enqueue(() => this.commit(read(), source));
  }

  rename(newPath: string): Promise<FileRenameResult> {
    return this.enqueue(async () => {
      const result = await renameFile(this.path, newPath);
      this.path = newPath;
      this.adopt(result);
      return result;
    });
  }

  idle(): Promise<void> {
    return this.flush().then(() => this.tail);
  }

  settled(): Promise<void> {
    return this.tail;
  }

  dispose(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async commit(content: string, source: WriteSource): Promise<FileWriteResult> {
    const abandoned = abandonedByTruncation(this.content, content);
    if (abandoned !== null) await this.keepAbandoned(abandoned);
    const result = await writeFileAtomic(this.path, content, this.hash, source);
    this.hash = result.hash;
    this.content = content;
    this.onSynced?.(this.path, result.hash);
    return result;
  }

  private async keepAbandoned(previous: string): Promise<void> {
    if (!this.onTruncate) return;
    try {
      await this.onTruncate(this.path, previous);
    } catch (error) {
      console.error('Failed to keep the text an emptied note lost', error);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined).catch(() => {});
    return result;
  }
}
