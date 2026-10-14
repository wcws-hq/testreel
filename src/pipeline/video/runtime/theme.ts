// Colours and type stacks. The accent is chosen per video; verdict colours are reserved for verdicts.
export const C = {
  text: "#F5F5F7",
  dim: "rgba(245,245,247,0.64)",
  faint: "rgba(245,245,247,0.38)",
  line: "rgba(255,255,255,0.10)",
  card: "#0A0A0D",
  card2: "#101015",
  use: "#3DDC84",
  watch: "#FFB020",
  skip: "#FF5D5D",
} as const;

export const FONT = {
  display: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  num: '"Outfit", "Inter", sans-serif',
} as const;

export const VERDICT_COLOR = { USE: C.use, WATCH: C.watch, SKIP: C.skip } as const;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function lighten(hex: string, p: number): string {
  const [r, g, b] = channels(hex).map((c) => Math.round(c + (255 - c) * p));
  return `rgb(${r},${g},${b})`;
}

export interface Palette { a: string; soft: string; glow: (alpha: number) => string }
export function palette(accent: string): Palette {
  return { a: accent, soft: lighten(accent, 0.38), glow: (alpha) => rgba(accent, alpha) };
}
