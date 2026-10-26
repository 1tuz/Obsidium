import { t } from '../../i18n';
import { childPath, comparablePath } from '../paths';
import { sanitizeFileName } from './documentFactory';
import { createAtFreeName, ensureDirectory, readDirectory } from './fileGateway';

class FolderNameTaken extends Error {
  readonly code = 'already_exists';

  constructor(path: string) {
    super(path);
  }
}

export async function createUniqueFolder(
  directory: string,
  preferredName?: string,
): Promise<string | null> {
  const baseName = sanitizeFileName(preferredName) || t('fileTree.newFolderName');
  try {
    const taken = new Set(
      (await readDirectory(directory)).map((item) => comparablePath(childPath(directory, item.name))),
    );
    return await createAtFreeName(
      (attempt) => childPath(directory, attempt === 0 ? baseName : `${baseName} ${attempt}`),
      async (path) => {
        if (taken.has(comparablePath(path))) throw new FolderNameTaken(path);
        await ensureDirectory(path);
      },
    );
  } catch (error) {
    console.error('Failed to create folder', error);
    return null;
  }
}
