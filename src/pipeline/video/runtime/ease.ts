// Tiny deterministic timeline toolkit. Every animation in the page is a pure function of time built from these.

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
// Progress 0..1 of a window that starts at `a` and lasts `d` seconds.
export const seg = (t: number, a: number, d: number): number => clamp((t - a) / d);

export const ease = {
  outCubic: (p: number) => 1 - (1 - p) ** 3,
  outQuart: (p: number) => 1 - (1 - p) ** 4,
  outExpo: (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  inCubic: (p: number) => p ** 3,
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  inOutSine: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
  outBack: (p: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  },
};

// Deterministic pseudo-random numbers (mulberry32) so grain, glitches and particles are identical in every worker.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Slow organic drift in -1..1 from a few summed sines, stable for a given phase.
export const drift = (t: number, speed: number, phase: number): number =>
  (Math.sin(t * speed + phase) + Math.sin(t * speed * 0.57 + phase * 1.7)) / 2;

// Indexed reads are checked once, here, instead of cast at every call site.
export function need<T>(v: T | null | undefined, what = "value"): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}
