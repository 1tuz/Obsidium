import {
  BookOpen, Briefcase, Code2, FileText, Folder, Heart,
  Music2, Pin, Star, Tag, type IconNode,
} from 'lucide';
import { rebasedPath } from '../../modules/paths';
import type { FileIconAssignment, FileIconId } from '../../modules/settings';

export type { FileIconAssignment } from '../../modules/settings';

export const FILE_ICON_CHOICES: readonly { name: FileIconId; icon: IconNode }[] = [
  { name: 'file', icon: FileText }, { name: 'folder', icon: Folder },
  { name: 'book', icon: BookOpen }, { name: 'star', icon: Star },
  { name: 'tag', icon: Tag }, { name: 'code', icon: Code2 },
  { name: 'briefcase', icon: Briefcase }, { name: 'pin', icon: Pin },
  { name: 'heart', icon: Heart }, { name: 'music', icon: Music2 },
];

export function fileIcon(name: string): IconNode {
  return FILE_ICON_CHOICES.find(choice => choice.name === name)?.icon ?? FileText;
}

export function setFileIcon(
  current: Record<string, FileIconAssignment>,
  path: string,
  assignment: FileIconAssignment | null,
): Record<string, FileIconAssignment> {
  const next = { ...current };
  if (assignment && /^#[0-9a-f]{6}$/i.test(assignment.color) &&
      FILE_ICON_CHOICES.some(choice => choice.name === assignment.name)) {
    next[path] = assignment;
  } else {
    delete next[path];
  }
  return next;
}

export function rebaseFileIcons(
  current: Record<string, FileIconAssignment>, from: string, to: string,
): Record<string, FileIconAssignment> {
  let changed = false;
  const next = { ...current };
  for (const [path, icon] of Object.entries(current)) {
    const moved = rebasedPath(path, from, to);
    if (!moved || moved === path) continue;
    delete next[path];
    next[moved] = icon;
    changed = true;
  }
  return changed ? next : current;
}
