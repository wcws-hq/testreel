import { abs, clampWords, fill, fitFont, fitLine, h, maskedWords, svg, T, textHeight, tf } from "../dom.ts";
import { ease, need, rng, seg } from "../ease.ts";
import { formatCount, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { VERDICT_HIT } from "../times.ts";
import { C, FONT, VERDICT_COLOR, rgba } from "../theme.ts";

export function buildVerdict(c: SceneCtx): Scene {
  const { plan, L, D } = c;
  const score = need(plan.score, "score");
  const vc = VERDICT_COLOR[score.verdict];
  const root = h("div", fill);
  const showLimits = !L.short && D >= 12 && score.limitations.length > 0;
  const leftW = L.short ? L.box.w : 1020;
  const ring = L.short ? 230 : 400;

  // Full: the limitations sit under the summary, so every block is measured first and the verdict word takes what is left.
  const top = L.box.y;
  const height = L.box.h;
  const gap = L.short ? 16 : 18;
  const labelH = Math.ceil((L.short ? 32 : 30) * 1.3);
  const ringSlot = L.short ? h("div", "display:flex;align-items:center;gap:28px;width:100%", root) : null;
  const lineW = L.short ? leftW - ring - 28 : leftW;
  const lineStyle = `${T.display}font-weight:500;letter-spacing:-0.01em;line-height:1.25;color:${C.text};`;
  const lineSize = fitFont(score.oneLine, lineStyle, lineW, L.short ? 330 : 150, L.short ? 42 : 40, 22, true);
  const limitStyle = `${T.display}font-weight:500;line-height:1.3;letter-spacing:-0.005em;`;
  const limitSize = 28;
  const limitW = leftW - 28;
  const limitTexts = showLimits ? score.limitations.slice(0, 3).map((txt) => clampWords(txt, limitStyle, limitW, limitSize, 2)) : [];
  const limitHs = limitTexts.map((txt) => Math.ceil(textHeight(txt, limitStyle, limitW, limitSize)));
  const summaryH = Math.ceil(textHeight(score.oneLine, lineStyle, lineW, lineSize, true));
  const fixedH = labelH + (L.short ? 0 : summaryH) + limitHs.reduce((a, b) => a + b, 0) + gap * (2 + limitTexts.length);
  const wordMax = L.short ? 300 : Math.min(330, Math.floor((height - fixedH) / 0.95));
  const wordStyle = `${T.display}font-weight:900;letter-spacing:-0.05em;white-space:nowrap;`;
  const wordSize = fitLine(score.verdict, wordStyle, leftW, wordMax, 80);

  const glow = h("div", `${abs}left:${L.box.x + leftW / 2 - 700}px;top:${top + 200 - 700}px;width:1400px;height:1400px;border-radius:50%;background:radial-gradient(circle,${rgba(vc, 0.3)} 0%,${rgba(vc, 0)} 56%);opacity:0`, root);
  const col = h("div", `${abs}left:${L.box.x}px;top:${top}px;width:${leftW}px;height:${height}px;display:flex;flex-direction:column;justify-content:center;gap:${gap}px;align-items:flex-start`, root);
  h("div", `${T.mono}flex:none;font-size:${L.short ? 32 : 30}px;letter-spacing:0.22em;color:${C.dim}`, col, "THE VERDICT");
  const word = h("div", `flex:none;font-size:${wordSize}px;line-height:0.95;${wordStyle}color:${vc};text-shadow:0 0 70px ${rgba(vc, 0.55)};opacity:0;margin-left:-${wordSize * 0.03}px`, col, score.verdict);
  if (ringSlot) col.appendChild(ringSlot);
  const lineBox = h("div", `flex:none;font-size:${lineSize}px;width:${lineW}px;${lineStyle}`, ringSlot ?? col);
  const lineWords = maskedWords(lineBox, score.oneLine, lineStyle);
  const limits = limitTexts.map((txt) => h("div", `flex:none;${limitStyle}font-size:${limitSize}px;color:${C.dim};padding-left:25px;border-left:3px solid ${rgba(vc, 0.7)};width:${leftW}px;opacity:0`, col, txt));

  const rx = L.box.x + leftW + 80 + (L.box.w - leftW - 80 - ring) / 2;
  const ry = top + (height - ring) / 2;
  const ringBox = ringSlot
    ? h("div", `position:relative;flex:none;order:-1;width:${ring}px;height:${ring}px;opacity:0`, ringSlot)
    : h("div", `${abs}left:${rx}px;top:${ry}px;width:${ring}px;height:${ring}px;opacity:0`, root);
  const rs = svg("svg", { width: ring, height: ring, viewBox: `0 0 ${ring} ${ring}`, style: `position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 0 22px ${rgba(vc, 0.5)})` }, ringBox);
  const rr = ring / 2 - 22;
  const circ = 2 * Math.PI * rr;
  svg("circle", { cx: ring / 2, cy: ring / 2, r: rr, fill: "none", stroke: "rgba(255,255,255,0.09)", "stroke-width": 24 }, rs);
  const arc = svg("circle", { cx: ring / 2, cy: ring / 2, r: rr, fill: "none", stroke: vc, "stroke-width": 24, "stroke-linecap": "round", "stroke-dasharray": `0 ${circ}`, transform: `rotate(-90 ${ring / 2} ${ring / 2})` }, rs);
  const avg = h("div", `${abs}left:0;top:${ring / 2 - ring * 0.2}px;width:${ring}px;text-align:center;${T.num}font-family:${FONT.num};font-weight:800;font-size:${ring * 0.3}px;line-height:1`, ringBox, "0.0");
  h("div", `${abs}left:0;top:${ring / 2 + ring * 0.13}px;width:${ring}px;text-align:center;${T.mono}font-size:${ring * 0.075}px;letter-spacing:0.12em;color:${C.faint}`, ringBox, L.short ? "/ 10" : "AVERAGE / 10");

  const wave = h("div", `${abs}border-radius:50%;border:6px solid ${vc};opacity:0;box-shadow:0 0 60px ${rgba(vc, 0.6)}`, root);
  const rand = rng(11);
  const sparks = Array.from({ length: 28 }, () => ({ a: rand() * Math.PI * 2, d: 260 + rand() * 520, s: 6 + rand() * 12, el: h("div", `${abs}border-radius:50%;background:${vc};opacity:0`, root) }));
  const wx = L.box.x + Math.min(leftW, 520) / 2;
  const wy = top + height / 2 - (L.short ? 120 : 100);
  const lineAt = VERDICT_HIT + 1.0;
  const limitStart = VERDICT_HIT + 2.8;

  return {
    root,
    update(t) {
      const k = seg(t, VERDICT_HIT, 0.5);
      const e = ease.outBack(k);
      glow.style.opacity = String(ease.outCubic(seg(t, VERDICT_HIT, 0.8)));
      word.style.opacity = String(Math.min(1, k * 4));
      const shake = t > VERDICT_HIT ? Math.sin(t * 90) * 16 * (1 - seg(t, VERDICT_HIT, 0.5)) : 0;
      word.style.transform = `translate3d(${shake.toFixed(2)}px,${(shake * 0.4).toFixed(2)}px,0) scale(${(1 + (1 - e) * 1.3).toFixed(4)})`;
      word.style.filter = k < 1 ? `blur(${((1 - ease.outCubic(k)) * 16).toFixed(1)}px)` : "";
      const w = seg(t, VERDICT_HIT, 1.0);
      const rad = ease.outCubic(w) * 900;
      wave.style.left = `${wx - rad}px`;
      wave.style.top = `${wy - rad}px`;
      wave.style.width = `${2 * rad}px`;
      wave.style.height = `${2 * rad}px`;
      wave.style.opacity = String(w > 0 && w < 1 ? (1 - w) * 0.8 : 0);
      const age = seg(t, VERDICT_HIT, 1.2);
      for (const sp of sparks) {
        const dist = ease.outCubic(age) * sp.d;
        sp.el.style.opacity = String(age > 0 && age < 1 ? 1 - age : 0);
        sp.el.style.width = `${sp.s}px`;
        sp.el.style.height = `${sp.s}px`;
        tf(sp.el, wx + Math.cos(sp.a) * dist, wy + Math.sin(sp.a) * dist, 1 - age * 0.6);
      }
      const rp = ease.outBack(seg(t, VERDICT_HIT + 0.3, 0.6));
      ringBox.style.opacity = String(Math.min(1, rp * 2));
      tf(ringBox, 0, (1 - rp) * 40, 0.85 + 0.15 * rp);
      const f = ease.outExpo(seg(t, VERDICT_HIT + 0.5, 1.5));
      arc.setAttribute("stroke-dasharray", `${(circ * (score.average / 10) * f).toFixed(2)} ${circ}`);
      avg.textContent = formatCount(score.average, f, 1);
      revealWords(lineWords, t, lineAt, 0.035, 0.6);
      const span = Math.max(D - limitStart - 1.5, 1);
      limits.forEach((el, i) => {
        const p = ease.outCubic(seg(t, limitStart + (span * i) / Math.max(limits.length, 1) * 0.6, 0.5));
        el.style.opacity = String(p);
        tf(el, (1 - p) * -24, 0);
      });
    },
  };
}
