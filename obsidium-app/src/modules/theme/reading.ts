export type ReadingThemeId = 'inherit' | 'paper-white' | 'ivory' | 'parchment' | 'sepia' | 'dark-paper';
export type ReadingMode = 'light' | 'dark';

export const readingThemeOptions: { id: ReadingThemeId; name: string }[] = [
  { id: 'inherit', name: 'Follow interface' },
  { id: 'paper-white', name: 'Paper White' },
  { id: 'ivory', name: 'Ivory' },
  { id: 'parchment', name: 'Parchment' },
  { id: 'sepia', name: 'Sepia' },
  { id: 'dark-paper', name: 'Dark Paper' },
];

export interface ReadingColors { background: string; text: string; muted: string; accent: string }
type PaperThemeId = Exclude<ReadingThemeId, 'inherit'>;
export const paperColors: Record<PaperThemeId, Record<ReadingMode, ReadingColors>> = {
  'paper-white': {
    light: { background: '#ffffff', text: '#202124', muted: '#53565b', accent: '#245d90' },
    dark: { background: '#1c1e20', text: '#eae7e2', muted: '#b7b6b1', accent: '#9cbeea' },
  },
  ivory: {
    light: { background: '#fffcf2', text: '#393329', muted: '#6a5f50', accent: '#815b31' },
    dark: { background: '#24211c', text: '#efe6d3', muted: '#bfb3a0', accent: '#d5ad70' },
  },
  parchment: {
    light: { background: '#f2e7d1', text: '#42382b', muted: '#695747', accent: '#74512f' },
    dark: { background: '#29241c', text: '#e7d5b6', muted: '#bbaa8e', accent: '#d6aa6c' },
  },
  sepia: {
    light: { background: '#e9dbc0', text: '#493727', muted: '#705a46', accent: '#80532e' },
    dark: { background: '#2c241d', text: '#e0caac', muted: '#bda78d', accent: '#d0a16f' },
  },
  'dark-paper': {
    light: { background: '#e5e2dc', text: '#333531', muted: '#60655e', accent: '#496454' },
    dark: { background: '#171a19', text: '#dcded7', muted: '#aaaead', accent: '#a1c2a4' },
  },
};

export function normalizeReadingTheme(value: unknown): ReadingThemeId {
  return typeof value === 'string' && value in paperColors ? value as PaperThemeId : 'inherit';
}

export function readingColors(id: ReadingThemeId, mode: ReadingMode): ReadingColors | null {
  return id === 'inherit' ? null : paperColors[id][mode];
}
