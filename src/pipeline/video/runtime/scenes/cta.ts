import { abs, fill, fitLine, h, maskedWords, T, tf } from "../dom.ts";
import { drift, ease, seg } from "../ease.ts";
import { revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C } from "../theme.ts";
import { subscribeButton } from "./subscribe.ts";

export function buildCta(c: SceneCtx): Scene {
  const { plan, L, P } = c;
  const root = h("div", fill);
  const col = h("div", `${abs}left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;height:${L.box.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${L.short ? 40 : 34}px`, root);
  h("div", `${T.mono}font-size:${L.short ? 32 : 30}px;letter-spacing:0.2em;color:${C.dim}`, col, "ENJOYED THIS?");
  const style = `${T.display}font-weight:900;white-space:nowrap;`;
  const size = fitLine(plan.channel, style, L.box.w * 0.97, L.short ? 150 : 190, 26);
  const row = h("div", `font-size:${size}px;line-height:1.05;white-space:nowrap`, col);
  const words = maskedWords(row, plan.channel, `${style}background:linear-gradient(100deg,#fff 25%,${P.soft});-webkit-background-clip:text;background-clip:text;color:transparent;`);
  const btn = subscribeButton(col, P, L.short ? 50 : 52);
  const note = h("div", `${T.display}font-weight:500;font-size:${L.short ? 40 : 38}px;color:${C.dim};letter-spacing:-0.01em;opacity:0`, col, "Source links are in the description.");
  return {
    root,
    update(t) {
      revealWords(words, t, 0.15, 0.1, 0.8);
      btn.update(t, 1.9);
      const n = ease.outCubic(seg(t, 1.1, 0.6));
      note.style.opacity = String(n);
      tf(note, 0, (1 - n) * 16);
      tf(col, drift(t, 0.6, 1) * 4, drift(t, 0.45, 2) * 5);
    },
  };
}
