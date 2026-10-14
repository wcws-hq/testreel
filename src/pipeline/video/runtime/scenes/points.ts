import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, fitFont, h, maskedWords, T, textHeight, tf } from "../dom.ts";
import { clamp, ease, need, seg } from "../ease.ts";
import { revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { pointTimes } from "../times.ts";
import { C, FONT } from "../theme.ts";

type PointsScene = Extract<ResolvedScene, { kind: "points" }>;

export function buildPoints(c: SceneCtx, s: PointsScene): Scene {
  const { L, P } = c;
  const root = h("div", fill);
  const items = s.items.slice(0, 5);
  const titleStyle = `${T.display}font-weight:800;`;
  const titleSize = fitFont(s.title, titleStyle, L.box.w, L.short ? 170 : 120, L.short ? 76 : 72, 34, true);
  const titleBox = h("div", `${abs}left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;font-size:${titleSize}px;line-height:1.05`, root);
  const titleWords = maskedWords(titleBox, s.title, titleStyle);
  const titleH = textHeight(s.title, `${titleStyle}line-height:1.05;`, L.box.w, titleSize, true);
  const listTop = L.box.y + titleH + 36;
  const gap = 20;
  const rowH = Math.min(L.short ? 190 : 140, (L.box.y + L.box.h - listTop - gap * (items.length - 1)) / items.length);
  const badge = Math.min(rowH - 36, L.short ? 96 : 84);
  const textW = L.box.w - badge - 100;
  const times = pointTimes(items, c.layer);
  const lastTime = need(times.at(-1));

  const rows = items.map((txt, i) => {
    const y = listTop + i * (rowH + gap);
    const el = h("div", `${abs}left:${L.box.x}px;top:${y}px;width:${L.box.w}px;height:${rowH}px;border-radius:26px;border:1.5px solid ${C.line};background:${C.card};display:flex;align-items:center;gap:30px;padding:0 34px;overflow:hidden;opacity:0`, root);
    const num = h("div", `flex:none;width:${badge}px;height:${badge}px;border-radius:50%;border:2.5px solid ${P.glow(0.7)};display:flex;align-items:center;justify-content:center;${T.num}font-family:${FONT.num};font-size:${badge * 0.5}px;font-weight:800;color:${P.soft}`, el, String(i + 1));
    const size = fitFont(txt, `${T.display}font-weight:600;letter-spacing:-0.015em;line-height:1.12;`, textW, rowH - 28, L.short ? 52 : 50, 22);
    const text = h("div", `${T.display}font-weight:600;letter-spacing:-0.015em;line-height:1.12;font-size:${size}px;width:${textW}px`, el, txt);
    const sheen = h("div", `${abs}left:0;top:0;width:260px;height:100%;background:linear-gradient(100deg,rgba(255,255,255,0),${P.glow(0.16)},rgba(255,255,255,0));opacity:0`, el);
    return { el, num, text, sheen, i };
  });

  return {
    root,
    update(t) {
      revealWords(titleWords, t, 0.1, 0.07, 0.7);
      let active = times.findLastIndex((x) => t >= x);
      if (active === items.length - 1 && t > lastTime + 2.8) active = Math.floor((t - lastTime - 2.8) / 2.4) % items.length;
      for (const r of rows) {
        const at = need(times[r.i]);
        const p = ease.outExpo(seg(t, at, 0.65));
        const on = r.i === active;
        r.el.style.opacity = String(p * (on ? 1 : 0.58));
        tf(r.el, (1 - p) * -110, 0, on ? 1.015 : 1);
        r.el.style.borderColor = on ? P.glow(0.8) : C.line;
        r.el.style.background = on ? `linear-gradient(90deg,${P.glow(0.14)},${C.card} 70%)` : C.card;
        r.num.style.background = on ? P.a : "transparent";
        r.num.style.color = on ? "#000" : P.soft;
        const sweep = on ? seg(t - at, 0, 1.4) : 0;
        r.sheen.style.opacity = sweep > 0 && sweep < 1 ? "1" : "0";
        r.sheen.style.transform = `translate3d(${(clamp(sweep) * (L.box.w + 260) - 260).toFixed(1)}px,0,0)`;
      }
    },
  };
}
