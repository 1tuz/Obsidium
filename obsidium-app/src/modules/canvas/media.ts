import { absolutePath, parentDirectory, relativePath } from '../paths';

function workspaceRelative(workspacePath: string, path: string): string {
  if (!/^[a-zA-Z]:[\\/]/.test(path) && !path.startsWith('/') && !path.startsWith('\\\\')) return path;
  try {
    return relativePath(workspacePath, path);
  } catch {
    return '';
  }
}

export type CanvasMediaKind = 'image' | 'video';
export type CanvasMediaResolution = { kind: CanvasMediaKind; url: string; external: boolean };

const KIND_BY_EXTENSION: Record<string, CanvasMediaKind> = {
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  jpeg: 'image',
  jpg: 'image',
  jpe: 'image',
  png: 'image',
  svg: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
  ogg: 'video',
  mov: 'video',
  m4v: 'video',
  mkv: 'video',
};

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function canvasMediaKind(target: string): CanvasMediaKind | null {
  const trimmed = target.trim();
  const path = trimmed.split(/[?#]/, 1)[0] ?? '';
  const direct = KIND_BY_EXTENSION[extensionOf(path)];
  if (direct) return direct;
  const data = /^data:([^;,]+)/i.exec(path);
  if (!data?.[1]) return null;
  if (/^image\//i.test(data[1])) return 'image';
  return /^video\//i.test(data[1]) ? 'video' : null;
}

function normalizeRelative(target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.replace(/\\/g, '/'));
  } catch {
    decoded = target.replace(/\\/g, '/');
  }
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? segments.join('/') : null;
}

export function resolveCanvasMedia(input: {
  workspacePath: string;
  canvasPath: string;
  nodeType: string;
  nodeFile?: string;
  target: string;
}): CanvasMediaResolution | null {
  const target = input.target.trim();
  if (!target) return null;
  const kind = canvasMediaKind(target);
  if (!kind) return null;

  const external =
    /^(?:https?:|data:|asset:|blob:)/i.test(target)
    || /^[\\/]/.test(target)
    || /^[a-z]:[\\/]/i.test(target)
    || /^file:\/\//i.test(target);
  if (external) return { kind, url: target, external: true };

  const normalized = normalizeRelative(target);
  if (!normalized) return null;

  if (input.nodeType === 'file' && input.nodeFile && target === input.nodeFile) {
    return { kind, url: absolutePath(input.workspacePath, normalized), external: false };
  }

  const directory = normalizeRelative(
    input.nodeType === 'file' && input.nodeFile
      ? parentDirectory(input.nodeFile)
      : parentDirectory(workspaceRelative(input.workspacePath, input.canvasPath)),
  );
  const relative = directory ? `${directory}/${normalized}` : normalized;
  return { kind, url: absolutePath(input.workspacePath, relative), external: false };
}
