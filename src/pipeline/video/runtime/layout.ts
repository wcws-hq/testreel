// Per-aspect geometry. Full is 1920x1080; the lower third and callout sit under the content box. Short is 1080x1920 with
// content clear of the top bar and the callout kept above the player UI (bottom ~20%).
import type { VideoKind } from "../../../shared/types.ts";

export interface Box { x: number; y: number; w: number; h: number }
export interface Layout {
  kind: VideoKind;
  short: boolean;
  W: number;
  H: number;
  box: Box; // where scene content lives
  fs: { hero: number; title: number; body: number; small: number };
  pad: number;
}

export function layoutFor(kind: VideoKind): Layout {
  if (kind === "short") {
    return { kind, short: true, W: 1080, H: 1920, box: { x: 60, y: 260, w: 960, h: 1300 }, fs: { hero: 150, title: 84, body: 46, small: 32 }, pad: 28 };
  }
  return { kind, short: false, W: 1920, H: 1080, box: { x: 120, y: 112, w: 1680, h: 780 }, fs: { hero: 170, title: 88, body: 42, small: 27 }, pad: 28 };
}

// Terminal window geometry, shared by the scene (to draw) and the planner (to wrap and pick output lines).
export function terminalMetrics(L: Layout) {
  const fontPx = L.short ? 32 : 25;
  const adv = fontPx * 0.6;
  const lh = L.short ? 50 : 38;
  const winW = L.short ? 960 : 1090;
  const winH = L.short ? 900 : L.box.h;
  const titleH = 58;
  const padX = 32;
  const padY = 20;
  const R = Math.floor((winH - titleH - padY * 2) / lh);
  const cols = Math.floor((winW - padX * 2) / adv);
  return { fontPx, adv, lh, winW, winH, titleH, padX, padY, R, cols, maxOut: Math.min(R - 3, L.short ? 14 : 11) };
}
