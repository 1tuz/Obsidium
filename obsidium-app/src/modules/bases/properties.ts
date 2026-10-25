import { fileName, parentDirectory, relativePath } from '../paths';
import type { BaseFieldValue, BaseRow } from './types';

function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

export function baseProperty(
  row: BaseRow,
  property: string,
  workspacePath: string,
): BaseFieldValue | undefined {
  const relative = relativePath(workspacePath, row.path);
  switch (property) {
    case 'file.name': return fileName(row.path).replace(/\.[^.]+$/, '');
    case 'file.path': return relative;
    case 'file.ext': return extension(row.path);
    case 'file.folder': return parentDirectory(relative).replace(/\\/g, '/');
    default: {
      const key = property.startsWith('note.') ? property.slice('note.'.length) : property;
      return row.fields[key];
    }
  }
}
