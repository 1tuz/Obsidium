import { parseFrontmatter, setFrontmatterField } from '../docs/frontmatter';

const TYPE_KEY = 'type';

function typeField(content: string): { key: string; types: string[] } | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;
  const key = Object.keys(parsed.data).find((candidate) => candidate.toLowerCase() === TYPE_KEY) ?? TYPE_KEY;
  const value = parsed.data[key];
  if (Array.isArray(value)) return { key, types: value.map((item) => item.trim()).filter(Boolean) };
  if (typeof value !== 'string') return { key, types: [] };
  const trimmed = value.trim();
  return { key, types: trimmed ? [trimmed] : [] };
}

export function readNoteType(content: string): string | null {
  return typeField(content)?.types[0] ?? null;
}

export function setNoteType(content: string, typeName: string | null): string | null {
  const name = typeName?.trim() || null;
  const field = typeField(content);
  if (!field) {
    if (!name) return null;
    const newline = content.indexOf('\n');
    const eol = newline > 0 && content[newline - 1] === '\r' ? '\r\n' : '\n';
    return `---${eol}type: ${name}${eol}---${eol}${content}`;
  }
  if (!name) {
    return field.types.length > 0 ? setFrontmatterField(content, field.key, '') : null;
  }
  if (field.types.length === 1 && field.types[0].toLowerCase() === name.toLowerCase()) return null;
  return setFrontmatterField(content, field.key, name);
}
