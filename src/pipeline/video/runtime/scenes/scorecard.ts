import { abs, fill, h, svg, T, tf } from "../dom.ts";
import { drift, ease, need, seg } from "../ease.ts";
import { formatCount } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { GAUGE_FILL_SECONDS, gaugeTimes } from "../times.ts";
import { C, FONT } from "../theme.ts";

const KEYS = ["works", "quality", "effort", "speed"] as const;
const SWEEP = 270;
const TICKS = 36;

export function buildScorecard(c: SceneCtx): Scene {
  const { plan, L, P } = c;
  const score = need(plan.score, "score");
  const root = h("div", fill);
  const cols = L.short ? 2 : 4;
  const cw = L.box.w / cols;
  const G = L.short ? 330 : 340;
  const stroke = 26;
  const cellH = G + (L.short ? 96 : 100);
  const rowsN = KEYS.length / cols;
  const avgH = 96;
  const totalH = rowsN * cellH + (L.short ? 20 : 30) + avgH;
  const y0 = L.box.y + (L.box.h - totalH) / 2;
  const r = G / 2 - stroke / 2 - 14;
  const circ = 2 * Math.PI * r;
  const arc = (circ * SWEEP) / 360;
  const times = gaugeTimes(c.layer);

  const gauges = KEYS.map((key, i) => {
    const x = L.box.x + (i % cols) * cw + (cw - G) / 2;
    const y = y0 + Math.floor(i / cols) * cellH;
    const cell = h("div", `${abs}left:${x}px;top:${y}px;width:${G}px;height:${cellH}px;opacity:0`, root);
    const s = svg("svg", { width: G, height: G, viewBox: `0 0 ${G} ${G}`, style: `position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 0 18px ${P.glow(0.45)})` }, cell);
    const rot = `rotate(${90 + (360 - SWEEP) / 2} ${G / 2} ${G / 2})`;
    svg("circle", { cx: G / 2, cy: G / 2, r, fill: "none", stroke: "rgba(255,255,255,0.09)", "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": `${arc} ${circ}`, transform: rot }, s);
    const fillArc = svg("circle", { cx: G / 2, cy: G / 2, r, fill: "none", stroke: P.a, "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": `0 ${circ}`, transform: rot }, s);
    const shimmer = svg("circle", { cx: G / 2, cy: G / 2, r, fill: "none", stroke: "#fff", "stroke-opacity": 0.55, "stroke-width": stroke * 0.5, "stroke-linecap": "round", "stroke-dasharray": `1 ${circ}`, transform: rot }, s);
    const ticks = Array.from({ length: TICKS + 1 }, (_, k) => {
      const ang = ((90 + (360 - SWEEP) / 2 + (SWEEP * k) / TICKS) * Math.PI) / 180;
      const rr1 = G / 2 - 2;
      const rr2 = G / 2 + (k % 6 === 0 ? 12 : 6);
      return svg("line", { x1: G / 2 + Math.cos(ang) * rr1, y1: G / 2 + Math.sin(ang) * rr1, x2: G / 2 + Math.cos(ang) * rr2, y2: G / 2 + Math.sin(ang) * rr2, stroke: "rgba(255,255,255,0.2)", "stroke-width": 2.5, "stroke-linecap": "round" }, s);
    });
    const num = h("div", `${abs}left:0;top:${G / 2 - G * 0.2}px;width:${G}px;text-align:center;${T.num}font-family:${FONT.num};font-weight:800;font-size:${G * 0.36}px;line-height:1`, cell, "0");
    h("div", `${abs}left:0;top:${G / 2 + G * 0.14}px;width:${G}px;text-align:center;${T.mono}font-size:${G * 0.075}px;color:${C.faint};letter-spacing:0.1em`, cell, "/ 10");
    h("div", `${abs}left:0;top:${G + 18}px;width:${G}px;text-align:center;${T.mono}font-size:${L.short ? 36 : 34}px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${C.text}`, cell, key);
    return { cell, fillArc, shimmer, ticks, num, value: score.scores[key], i };
  });

  const avg = h("div", `${abs}left:${L.box.x}px;top:${y0 + rowsN * cellH + (L.short ? 20 : 30)}px;width:${L.box.w}px;height:${avgH}px;display:flex;justify-content:center;opacity:0`, root);
  const pill = h("div", `display:flex;align-items:baseline;gap:22px;padding:14px 44px;border-radius:999px;border:2px solid ${P.glow(0.6)};background:${P.glow(0.12)}`, avg);
  h("div", `${T.mono}font-size:30px;letter-spacing:0.14em;color:${C.dim}`, pill, "AVERAGE");
  const avgNum = h("div", `${T.num}font-family:${FONT.num};font-weight:800;font-size:64px;line-height:1;color:${P.soft}`, pill, "0.0");
  const avgAt = need(times.at(-1)) + GAUGE_FILL_SECONDS + 0.2;

  return {
    root,
    update(t) {
      for (const g of gauges) {
        const at = need(times[g.i]);
        const p = ease.outBack(seg(t, at, 0.55));
        g.cell.style.opacity = String(Math.min(1, p * 2.4));
        tf(g.cell, 0, (1 - p) * 50 + drift(t, 0.8, g.i * 1.7) * 4, 0.88 + 0.12 * p);
        const f = ease.outExpo(seg(t, at + 0.2, GAUGE_FILL_SECONDS));
        const len = (arc * (g.value / 10)) * f;
        g.fillArc.setAttribute("stroke-dasharray", `${len.toFixed(2)} ${circ}`);
        g.num.textContent = formatCount(g.value, f);
        const filled = ((g.value / 10) * f) * TICKS;
        g.ticks.forEach((tk, k) => tk.setAttribute("stroke", k <= filled ? P.soft : "rgba(255,255,255,0.2)"));
        const d = 0.06 * circ;
        const pos = ((t * 0.45 + g.i * 0.21) % 1.6) * Math.max(len, 1);
        g.shimmer.setAttribute("stroke-dasharray", `${d.toFixed(1)} ${circ}`);
        g.shimmer.setAttribute("stroke-dashoffset", String(-Math.min(pos, Math.max(len - d, 0))));
        g.shimmer.setAttribute("stroke-opacity", len > d * 2 && pos < len ? "0.55" : "0");
      }
      const a = ease.outBack(seg(t, avgAt, 0.5));
      avg.style.opacity = String(Math.min(1, a * 2));
      tf(avg, 0, (1 - a) * 24);
      avgNum.textContent = formatCount(score.average, ease.outExpo(seg(t, avgAt + 0.1, 0.9)), 1);
    },
  };
}
