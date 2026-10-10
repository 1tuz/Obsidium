import { samePath } from '../paths';

export interface NoteEmbed {
  target: string;
  heading: string | null;
}

export function noteEmbedCreatesCycle(path: string, ancestry: readonly string[]): boolean {
  return ancestry.some((ancestor) => samePath(path, ancestor));
}

const NON_NOTE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg',
  'mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'mkv',
  'pdf', 'epub', 'mobi', 'azw3', 'fb2',
]);

export function parseNoteEmbed(line: string): NoteEmbed | null {
  const match = line.trim().match(/^!\[\[([^\]]+)\]\]$/);
  if (!match) return null;
  const target = match[1]!.split('|', 1)[0]!.trim();
  const anchor = target.indexOf('#');
  const noteTarget = (anchor < 0 ? target : target.slice(0, anchor)).trim();
  if (!noteTarget) return null;
  const extension = noteTarget.match(/\.([^.\\/]+)$/)?.[1];
  if (extension && NON_NOTE_EXTENSIONS.has(extension.toLowerCase())) return null;
  return {
    target: noteTarget,
    heading: anchor < 0 ? null : target.slice(anchor + 1).trim() || null,
  };
}

export function noteEmbedSection(content: string, heading: string | null): string {
  const lines = content.split(/\r?\n/);
  if (!heading) return content;
  const expected = normalizeHeading(heading);
  const start = lines.findIndex((line) => {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match && normalizeHeading(match[2]!) === expected;
  });
  if (start < 0) return '';
  const depth = lines[start]!.match(/^\s{0,3}(#+)/)![1]!.length;
  let end = start + 1;
  while (end < lines.length) {
    const nextDepth = lines[end]!.match(/^\s{0,3}(#{1,6})\s/)?.[1]?.length;
    if (nextDepth && nextDepth <= depth) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

function normalizeHeading(value: string): string {
  return value.replace(/[*_`~\[\]]/g, '').trim().toLocaleLowerCase();
}
