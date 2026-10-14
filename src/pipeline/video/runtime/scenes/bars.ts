import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, fitFont, fitLine, h, maskedWords, T, textHeight, textWidth, tf } from "../dom.ts";
import { clamp, ease, need, seg } from "../ease.ts";
import { formatCount, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C, FONT } from "../theme.ts";

type BarsScene = Extract<ResolvedScene, { kind: "bars" }>;

export function buildBars(c: SceneCtx, s: BarsScene): Scene {
  const { L, P } = c;
  const root = h("div", fill);
  const items = s.items.slice(0, 6);
  const maxValue = Math.max(...items.map((i) => i.max ?? 0), ...items.map((i) => i.value), 1);
  const leader = items.reduce((best, it, i) => (it.value > need(items[best]).value ? i : best), 0);
  const titleStyle = `${T.display}font-weight:800;`;
  const titleSize = fitFont(s.title, titleStyle, L.box.w, L.short ? 160 : 130, L.short ? 76 : 72, 34, true);
  const titleH = textHeight(s.title, `${titleStyle}line-height:1.05;`, L.box.w, titleSize, true);
  const rowH = Math.min(L.short ? 170 : 150, (L.box.h - titleH - 60) / items.length);
  const blockH = titleH + 44 + items.length * rowH;
  const top0 = L.box.y + Math.max(0, (L.box.h - blockH) / 2);
  const titleBox = h("div", `${abs}left:${L.box.x}px;top:${top0}px;width:${L.box.w}px;font-size:${titleSize}px;line-height:1.05`, root);
  const titleWords = maskedWords(titleBox, s.title, titleStyle);
  const listTop = top0 + titleH + 44;
  const labelW = L.short ? L.box.w : 440;
  const valStyle = `${T.num}font-family:${FONT.num};font-weight:800;white-space:nowrap;`;
  const valueTexts = items.map((it) => `${formatCount(it.value, 1)}${it.unit ? ` ${it.unit}` : ""}`);
  const widest = valueTexts.reduce((a, b) => (textWidth(b, valStyle, 52) > textWidth(a, valStyle, 52) ? b : a), "");
  const valueSize = fitLine(widest, valStyle, L.short ? 380 : 440, 52, 26);
  const valueW = Math.ceil(textWidth(widest, valStyle, valueSize)) + 8;
  const trackW = L.short ? L.box.w : L.box.w - labelW - valueW - 56;
  const trackH = L.short ? 44 : 38;

  const rows = items.map((it, i) => {
    const y = listTop + i * rowH;
    const row = h("div", `${abs}left:${L.box.x}px;top:${y}px;width:${L.box.w}px;height:${rowH}px;opacity:0`, root);
    const lead = i === leader;
    const lblStyle = `${T.display}font-weight:600;line-height:1.1;letter-spacing:-0.01em;`;
    const lblW = L.short ? L.box.w - valueW - 20 : labelW;
    const lblSize = fitFont(it.label, lblStyle, lblW, L.short ? 56 : rowH - 24, L.short ? 42 : 40, 22);
    h("div", `${abs}left:0;top:${L.short ? 0 : 0}px;width:${lblW}px;${L.short ? "" : `height:${rowH - 12}px;display:flex;align-items:center;`}font-size:${lblSize}px;${lblStyle}color:${lead ? C.text : C.dim}`, row, it.label);
    const trackX = L.short ? 0 : labelW + 28;
    const trackY = L.short ? 62 : (rowH - trackH) / 2 - 6;
    const track = h("div", `${abs}left:${trackX}px;top:${trackY}px;width:${trackW}px;height:${trackH}px;border-radius:${trackH / 2}px;background:rgba(255,255,255,0.08);overflow:hidden`, row);
    const bar = h("div", `${abs}left:0;top:0;height:100%;border-radius:${trackH / 2}px;overflow:hidden;background:${lead ? `linear-gradient(90deg,${P.a},${P.soft})` : P.glow(0.5)};${lead ? `box-shadow:0 0 36px ${P.glow(0.6)}` : ""}`, track);
    const streak = h("div", `${abs}top:0;width:120px;height:100%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.45),rgba(255,255,255,0))`, bar);
    const value = h("div", `${abs}${L.short ? `right:0;top:-6px;` : `left:${trackX + trackW + 28}px;top:${(rowH - 56) / 2 - 8}px;`}font-size:${valueSize}px;${valStyle}color:${lead ? P.soft : C.text}`, row);
    const unit = it.unit ?? "";
    return { row, bar, streak, value, it, i, frac: clamp(it.value / (it.max ?? maxValue)), unit, vw: trackW };
  });

  return {
    root,
    update(t) {
      revealWords(titleWords, t, 0.1, 0.07, 0.7);
      for (const r of rows) {
        const start = 0.55 + r.i * 0.22;
        const e = ease.outCubic(seg(t, start, 0.5));
        r.row.style.opacity = String(e);
        tf(r.row, (1 - e) * -40, 0);
        const fillP = ease.outExpo(seg(t, start + 0.15, 1.3));
        r.bar.style.width = `${(r.frac * fillP * r.vw).toFixed(1)}px`;
        r.value.textContent = `${formatCount(r.it.value, fillP)}${r.unit ? ` ${r.unit}` : ""}`;
        const barW = r.frac * fillP * r.vw;
        const sx = (((t * 0.55 + r.i * 0.23) % 1.7) - 0.35) * Math.max(barW, 1) - 60;
        r.streak.style.transform = `translate3d(${sx.toFixed(1)}px,0,0)`;
        r.streak.style.opacity = String(barW > 30 ? 1 : 0);
      }
    },
  };
}
