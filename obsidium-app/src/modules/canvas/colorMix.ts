function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHex(value: string): [number, number, number] | null {
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function parseChannels(value: string): [number, number, number] | null {
  const numbers = value.match(/-?[\d.]+(?:e-?\d+)?/gi)?.map(Number);
  if (!numbers || numbers.length < 3 || numbers.slice(0, 3).some((channel) => !Number.isFinite(channel))) {
    return null;
  }
  return [numbers[0], numbers[1], numbers[2]];
}

export function parseCssColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  const functional = /^(rgba?|color)\(([^)]*)\)$/i.exec(trimmed);
  if (!functional) return null;
  const channels = parseChannels(functional[2]);
  if (!channels) return null;
  const srgb = functional[1].toLowerCase() === 'color';
  return channels.map((channel) => clampChannel(srgb ? channel * 255 : channel)) as [number, number, number];
}

export function mixCssColors(from: string, to: string, amount: number): string {
  const source = parseCssColor(from);
  const target = parseCssColor(to);
  if (!source || !target) return from;
  const ratio = Math.min(1, Math.max(0, amount));
  return `rgb(${source.map((channel, index) => clampChannel(channel * (1 - ratio) + target[index] * ratio)).join(' ')})`;
}
