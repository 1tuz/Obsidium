import { relativePath } from '../paths';

const ABSOLUTE_PATTERN = /^(?:[a-zA-Z]:[\\/]|\/)/;

const uriListEntry = (value: string): string => {
  const first = value.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (!first) return '';
  if (!first.toLowerCase().startsWith('file://')) return first;
  const decoded = decodeURIComponent(first.slice('file://'.length));
  return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
};

export const canvasWorkspacePath = (workspacePath: string, raw: string): string | null => {
  const value = uriListEntry(raw.trim());
  if (!value) return null;
  if (!ABSOLUTE_PATTERN.test(value)) {
    const relative = value.replace(/\\/g, '/').replace(/^\.\//, '');
    return relative && !relative.split('/').includes('..') ? relative : null;
  }
  try {
    return relativePath(workspacePath, value);
  } catch {
    return null;
  }
};
