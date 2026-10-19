import { samePath } from '../paths';

export interface NoteEmbed {
  target: string;
  heading: string | null;
  blockId: string | null;
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
  const fragment = anchor < 0 ? '' : target.slice(anchor + 1).trim();
  const extension = noteTarget.match(/\.([^.\\/]+)$/)?.[1];
  if (extension && NON_NOTE_EXTENSIONS.has(extension.toLowerCase())) return null;
  return {
    target: noteTarget,
    heading: fragment && !fragment.startsWith('^') ? fragment : null,
    blockId: fragment.startsWith('^') ? fragment.slice(1) || null : null,
  };
}

export function noteEmbedOffset(content: string, heading: string | null, blockId: string | null = null): number | null {
  const text = content.replace(/\r\n?/g, '\n');
  const lines: string[] = [];
  const lineOffsets: number[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const breakAt = text.indexOf('\n', lineStart);
    const lineEnd = breakAt < 0 ? text.length : breakAt;
    lines.push(text.slice(lineStart, lineEnd));
    lineOffsets.push(lineStart);
    if (breakAt < 0) break;
    lineStart = breakAt + 1;
  }
  if (blockId) {
    const index = locateBlockLine(lines, blockId);
    if (index < 0) return null;
    const marker = lines[index]!.lastIndexOf(`^${blockId}`);
    return lineOffsets[index]! + Math.max(0, marker);
  }
  if (!heading) return 0;
  const expected = normalizeHeading(heading);
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker?.[1]?.[0] === fence.marker && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      continue;
    }
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match && normalizeHeading(match[2]!) === expected) return lineOffsets[index]!;
  }
  return null;
}

function blockLinePatterns(blockId: string): [RegExp, RegExp] {
  const suffix = escapeRegex(blockId);
  return [
    new RegExp(`^\\s{0,3}\\^${suffix}(?![\\w-])\\s*$`),
    new RegExp(`\\s\\^${suffix}(?![\\w-])\\s*$`),
  ];
}

function locateBlockLine(lines: string[], blockId: string): number {
  let fence: { marker: string; length: number } | null = null;
  const [standalone, trailing] = blockLinePatterns(blockId);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker?.[1]?.[0] === fence.marker && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (standalone.test(line) || trailing.test(line)) return index;
    if (marker) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      continue;
    }
  }
  return -1;
}

export function noteEmbedSection(content: string, heading: string | null, blockId: string | null = null): string {
  const lines = content.split(/\r?\n/);
  if (blockId) return noteEmbedBlock(lines, blockId);
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

function noteEmbedBlock(lines: string[], blockId: string): string {
  let fence: { marker: string; length: number } | null = null;
  let found = -1;
  let standalone = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker?.[1]?.[0] === fence.marker && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      continue;
    }
    if (new RegExp(`^\\s{0,3}\\^${escapeRegex(blockId)}\\s*$`).test(line)) {
      found = index;
      standalone = true;
      break;
    }
    if (new RegExp(`\\s+\\^${escapeRegex(blockId)}\\s*$`).test(line)) {
      found = index;
      break;
    }
  }
  if (found < 0) return '';
  const end = standalone ? found : found + 1;
  const listItem = /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(lines[found]!);
  let start = standalone ? found - 1 : found;
  if (!listItem) {
    while (start > 0 && lines[start - 1]!.trim()) start -= 1;
  }
  const selected = lines.slice(start, end);
  if (!standalone) selected[selected.length - 1] = selected[selected.length - 1]!.replace(/\s+\^[\w-]+\s*$/, '').trimEnd();
  return selected.join('\n');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHeading(value: string): string {
  return value.replace(/[*_`~\[\]]/g, '').trim().toLocaleLowerCase();
}
