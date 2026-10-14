import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, fitFont, h, T, tf } from "../dom.ts";
import { drift, ease, seg } from "../ease.ts";
import { icon } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { quoteTimes } from "../times.ts";
import { C } from "../theme.ts";

type QuoteScene = Extract<ResolvedScene, { kind: "quote" }>;

export function buildQuote(c: SceneCtx, s: QuoteScene): Scene {
  const { L, P, D } = c;
  const root = h("div", fill);
  const textW = L.box.w - (L.short ? 0 : 160);
  const style = `${T.display}font-weight:700;letter-spacing:-0.025em;line-height:1.14;`;
  const attrH = s.attribution ? 90 : 0;
  const size = fitFont(s.text, style, textW, L.box.h - 220 - attrH, L.short ? 84 : 92, 30);
  const group = h("div", `${abs}left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;height:${L.box.h}px;display:flex;flex-direction:column;justify-content:center;gap:34px`, root);
  const mark = h("div", `width:${L.short ? 130 : 150}px;height:${L.short ? 130 : 150}px;filter:drop-shadow(0 0 36px ${P.glow(0.7)});opacity:0`, group);
  icon(mark, "quote", L.short ? 130 : 150, P.a);
  const body = h("div", `font-size:${size}px;${style}width:${textW}px`, group);
  const times = quoteTimes(s.text, c.layer);
  const words = s.text.split(/\s+/).filter(Boolean).map((w, i) => {
    if (i > 0) body.appendChild(document.createTextNode(" "));
    return h("span", `display:inline-block`, body, w);
  });
  const attr = s.attribution ? h("div", `display:flex;align-items:center;gap:20px;opacity:0`, group) : null;
  if (attr && s.attribution) {
    h("div", `width:56px;height:5px;border-radius:3px;background:${P.a};box-shadow:0 0 18px ${P.glow(0.8)}`, attr);
    h("div", `${T.mono}font-size:${L.short ? 34 : 32}px;color:${C.dim};letter-spacing:0.04em`, attr, s.attribution);
  }
  const lastWord = times.at(-1) ?? 1;

  return {
    root,
    update(t) {
      const m = ease.outBack(seg(t, 0.1, 0.6));
      mark.style.opacity = String(Math.min(1, m * 2));
      tf(mark, 0, (1 - m) * 30, 0.7 + 0.3 * m);
      words.forEach((w, i) => {
        const at = times[i] ?? 0;
        const p = ease.outCubic(seg(t, at - 0.15, 0.45));
        const next = times[i + 1] ?? lastWord + 0.6;
        const current = t >= at && t < next;
        w.style.opacity = String(0.14 + 0.86 * p);
        w.style.color = current ? P.soft : C.text;
        tf(w, 0, (1 - p) * 16);
      });
      if (attr) {
        const a = ease.outCubic(seg(t, lastWord + 0.2, 0.6));
        attr.style.opacity = String(a);
        tf(attr, (1 - a) * -30, 0);
      }
      tf(group, drift(t, 0.5, 1) * 4, drift(t, 0.4, 3) * 4, 1 + 0.04 * (t / Math.max(D, 1)));
    },
  };
}
