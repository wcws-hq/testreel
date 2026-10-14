import { abs, fill, fitFont, h, maskedWords, T, tf } from "../dom.ts";
import { drift, ease, need, seg } from "../ease.ts";
import { revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { pointTimes } from "../times.ts";

export function buildHook(c: SceneCtx, lines: string[]): Scene {
  const { L, P } = c;
  const root = h("div", fill);
  const cx = L.box.x + L.box.w / 2;
  const cy = L.box.y + L.box.h / 2;
  const maxR = Math.hypot(L.W, L.H) * 0.5;
  const rings = [0, 1, 2].map(() => h("div", `${abs}border-radius:50%;border:2px solid ${P.glow(0.5)};opacity:0`, root));

  const group = h("div", `${abs}left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;height:${L.box.h}px;display:flex;flex-direction:column;justify-content:center;align-items:${L.short ? "center" : "flex-start"}`, root);
  const style = `${T.display}font-weight:900;`;
  const perLine = L.box.h / Math.max(lines.length, 1) / (L.short ? 1.05 : 1.12);
  const size = Math.min(...lines.map((l) => fitFont(l, style, L.box.w, perLine, L.fs.hero, 44, true)));
  const times = pointTimes(lines, c.layer);
  times[0] = Math.min(need(times[0]), 0.1);
  const last = lines.length - 1;
  const words = lines.map((line, i) => {
    const row = h("div", `font-size:${size}px;line-height:1.0;margin:${size * 0.04}px 0;position:relative;${L.short ? "text-align:center;" : ""}`, group);
    const gradient = `background:linear-gradient(100deg,${P.soft},${P.a} 70%);-webkit-background-clip:text;background-clip:text;color:transparent;`;
    return maskedWords(row, line, `${style}${i === last ? gradient : ""}`);
  });
  const bar = h("div", `position:relative;width:${Math.min(L.box.w, size * 3.4)}px;height:${Math.max(8, size * 0.07)}px;margin-top:${size * 0.12}px;border-radius:6px;background:${P.a};box-shadow:0 0 30px ${P.glow(0.8)};transform-origin:0 50%`, group);

  return {
    root,
    update(t) {
      rings.forEach((r, k) => {
        const phase = (t * 0.16 + k / rings.length) % 1;
        const rad = phase * maxR;
        r.style.left = `${cx - rad}px`;
        r.style.top = `${cy - rad}px`;
        r.style.width = `${2 * rad}px`;
        r.style.height = `${2 * rad}px`;
        r.style.opacity = String((1 - phase) * 0.35 * ease.outCubic(seg(t, 0, 0.8)));
      });
      words.forEach((w, i) => revealWords(w, t, need(times[i]), 0.08, 0.75));
      const barP = ease.outQuart(seg(t, need(times[last]) + 0.35, 0.8));
      bar.style.transform = `scaleX(${barP})`;
      const k = 1 + 0.045 * (t / Math.max(c.D, 1)) + 0.012 * ease.outCubic(seg(t, 0, 1.2));
      tf(group, drift(t, 0.7, 2) * 5, drift(t, 0.5, 5) * 6, k);
    },
  };
}
