import { childPath, fileStem } from '../paths';
import { createAtFreeName, createFile } from '../documents/fileGateway';
import { parseBase, serializeBase } from './baseFormat';

export function createBaseFile(folder: string): Promise<string | null> {
  return createAtFreeName(
    (attempt) => childPath(folder, `Base${attempt ? ` (${attempt})` : ''}.base`),
    (path) => {
      const definition = parseBase('');
      definition.views[0]!.name = fileStem(path);
      return createFile(path, serializeBase(definition));
    },
  );
}
