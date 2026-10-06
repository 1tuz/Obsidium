import { getManagedWriterForPath, getOpenDoc } from '../docs';
import { applyDocumentText, DIRECT_WRITE_ORIGIN, documentText } from '../docSync';
import { PathQueue } from '../pathQueue';
import { absolutePath } from '../paths';
import { EDIT_WRITE, readFileSnapshot, writeFileAtomic } from './fileGateway';
import { toggleTaskLine } from './taskCheckbox';

const toggles = new PathQueue<boolean>();

export async function toggleTaskInFile(
  workspacePath: string,
  relative: string,
  line: number,
): Promise<boolean> {
  const path = absolutePath(workspacePath, relative);
  return toggles.run(path, async () => {
    const openDoc = getOpenDoc(path);
    const writer = getManagedWriterForPath(path);
    if (openDoc && writer) {
      const text = documentText(openDoc);
      const next = toggleTaskLine(text.toString(), line);
      if (next === null) return false;
      applyDocumentText(openDoc, next, DIRECT_WRITE_ORIGIN);
      await writer.writeCurrent(() => text.toString(), EDIT_WRITE);
      return true;
    }
    const snapshot = await readFileSnapshot(path);
    const next = toggleTaskLine(snapshot.content, line);
    if (next === null || next === snapshot.content) return false;
    await writeFileAtomic(path, next, snapshot.hash, EDIT_WRITE);
    return true;
  });
}
