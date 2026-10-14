import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, fitFont, fitLine, h, T, textWidth, tf } from "../dom.ts";
import { drift, ease, seg } from "../ease.ts";
import { card, formatCount, scramble } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { STATS_COUNT_SECONDS, STATS_COUNT_START, STATS_ENTER } from "../times.ts";
import { C, FONT } from "../theme.ts";

type StatsScene = Extract<ResolvedScene, { kind: "stats" }>;

export function buildStats(c: SceneCtx, s: StatsScene): Scene {
  const { L, P } = c;
  const items = s.items.slice(0, 4);
  const n = items.length;
  const root = h("div", fill);
  const gap = 28;
  const cols = L.short ? (n === 4 ? 2 : 1) : n;
  const rowsN = Math.ceil(n / cols);
  const cw = (L.box.w - (cols - 1) * gap) / cols;
  const ch = Math.min(L.short ? 400 : 480, (L.box.h - (rowsN - 1) * gap) / rowsN);
  const gridH = rowsN * ch + (rowsN - 1) * gap;
  const gy = L.box.y + (L.box.h - gridH) / 2;
  const pad = 38;
  const innerW = cw - pad * 2;
  const numStyle = `font-family:${FONT.num};font-weight:800;letter-spacing:-0.03em;`;
  const maxNum = L.short ? (cols === 2 ? 110 : 150) : 190;

  const cells = items.map((it, i) => {
    const x = L.box.x + (i % cols) * (cw + gap);
    const y = gy + Math.floor(i / cols) * (ch + gap);
    const el = card(root, `${abs}left:${x}px;top:${y}px;width:${cw}px;height:${ch}px;padding:${pad}px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;opacity:0`);
    const top = h("div", `${abs}left:0;top:0;width:100%;height:6px;background:linear-gradient(90deg,${P.a},${P.soft});transform-origin:0 50%`, el);
    const numeric = typeof it.value === "number";
    const finalText = numeric ? formatCount(it.value as number, 1) : String(it.value);
    const suffix = it.suffix ?? "";
    const shown = finalText + suffix;
    const oneLine = textWidth(shown, numStyle, 40) <= innerW;
    const numSize = oneLine ? fitLine(shown, numStyle, innerW, maxNum, 40) : fitFont(shown, `${numStyle}white-space:normal;word-break:break-all;line-height:1.05;`, innerW, ch * 0.42, 40, 20);
    const row = h("div", `display:flex;align-items:baseline;gap:${numSize * 0.12}px;${oneLine ? "white-space:nowrap;" : "flex-wrap:wrap;word-break:break-all;"}${T.num}${numStyle}font-size:${numSize}px;line-height:1.05;color:${C.text}`, el);
    const num = h("span", "max-width:100%", row, "0");
    if (suffix) h("span", `font-size:${numSize * 0.5}px;color:${P.soft};font-weight:700`, row, suffix);
    const labelSize = fitFont(it.label, `${T.display}font-weight:600;letter-spacing:-0.01em;line-height:1.15;`, innerW, L.short ? 100 : 100, L.short ? 44 : 40, 22);
    h("div", `${T.display}font-weight:600;letter-spacing:-0.01em;line-height:1.15;font-size:${labelSize}px;color:${C.dim};margin-top:${numSize * 0.14}px`, el, it.label);
    return { el, top, num, numeric, value: it.value, finalText, i };
  });

  return {
    root,
    update(t, frame) {
      const hot = t > 2.6 ? Math.floor((t - 2.6) / 2.2) % n : -1;
      for (const cell of cells) {
        const p = ease.outBack(seg(t, STATS_ENTER(cell.i), 0.6));
        cell.el.style.opacity = String(Math.min(1, p * 2.4));
        tf(cell.el, 0, (1 - p) * 70 + drift(t, 0.8, cell.i * 1.3) * 5, 0.92 + 0.08 * p);
        cell.top.style.transform = `scaleX(${ease.outExpo(seg(t, STATS_ENTER(cell.i) + 0.15, 0.8))})`;
        const q = seg(t, STATS_COUNT_START(cell.i), STATS_COUNT_SECONDS);
        if (cell.numeric) cell.num.textContent = formatCount(cell.value as number, ease.outExpo(q));
        else cell.num.textContent = q >= 1 ? cell.finalText : q <= 0 ? "" : scramble(cell.finalText, ease.outCubic(q), frame);
        const glow = cell.i === hot ? Math.sin(Math.PI * (((t - 2.6) / 2.2) % 1)) : 0;
        cell.el.style.borderColor = glow > 0.02 ? P.glow(0.25 + 0.6 * glow) : C.line;
        cell.el.style.boxShadow = glow > 0.02 ? `0 0 ${50 * glow}px ${P.glow(0.3 * glow)}` : "none";
      }
    },
  };
}
