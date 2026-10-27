import { childPath, fileStem } from '../paths';
import { createAtFreeName, createFile } from '../documents/fileGateway';
import { buildCalendarBase } from './calendar';

export function createCalendarBaseFile(workspacePath: string): Promise<string | null> {
  return createAtFreeName(
    (attempt) => childPath(workspacePath, `Calendar${attempt ? ` (${attempt})` : ''}.base`),
    (path) => createFile(path, buildCalendarBase(fileStem(path))),
  );
}
