import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const COMMON_ALIASES: Record<string, string> = { py: 'python', rs: 'rust' };

export function fenceLanguage(info: string): LanguageDescription | null {
  const name = /\S*/.exec(info)?.[0];
  if (!name) return null;
  return LanguageDescription.matchLanguageName(languages, COMMON_ALIASES[name.toLowerCase()] ?? name, true);
}
