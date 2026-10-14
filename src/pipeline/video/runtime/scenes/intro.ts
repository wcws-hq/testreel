import { abs, fill, fitLine, h, maskedWords, T, tf } from "../dom.ts";
import { ease, seg } from "../ease.ts";
import { formatCount, icon, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C, FONT } from "../theme.ts";

// 3 s title card: owner, giant repo name, a tested/explained badge and the star count.
export function buildIntro(c: SceneCtx): Scene {
  const { plan, L, P } = c;
  const root = h("div", fill);
  const cx = L.W / 2;
  const burst = h("div", `${abs}left:${cx - 600}px;top:${L.H / 2 - 600}px;width:1200px;height:1200px;border-radius:50%;background:radial-gradient(circle,${P.glow(0.26)} 0%,${P.glow(0)} 62%);opacity:0`, root);
  const col = h("div", `${abs}left:${L.box.x}px;top:0;width:${L.box.w}px;height:${L.H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center`, root);
  const owner = h("div", `${T.mono}font-size:34px;letter-spacing:0.16em;text-transform:uppercase;color:${C.dim};margin-bottom:26px;opacity:0`, col, plan.repo.owner);
  const nameStyle = `${T.display}font-weight:900;white-space:nowrap;`;
  const size = fitLine(plan.repo.name, nameStyle, L.box.w * 0.97, L.short ? 150 : 230, 26);
  const nameRow = h("div", `font-size:${size}px;line-height:1;white-space:nowrap`, col);
  const chars = maskedWords(nameRow, plan.repo.name, `${nameStyle}background:linear-gradient(100deg,#fff 20%,${P.soft});-webkit-background-clip:text;background-clip:text;color:transparent;`);
  const line = h("div", `height:6px;border-radius:3px;background:${P.a};box-shadow:0 0 30px ${P.glow(0.9)};margin:34px 0 38px;transform-origin:50% 50%;width:${Math.min(L.box.w * 0.5, 620)}px`, col);
  const chips = h("div", "display:flex;gap:22px;align-items:center", col);
  const badge = h("div", `${T.mono}font-size:32px;font-weight:700;letter-spacing:0.14em;padding:14px 30px;border-radius:999px;background:${P.glow(0.16)};border:2px solid ${P.glow(0.7)};color:${P.soft};opacity:0`, chips, plan.tested ? "TESTED" : "EXPLAINED");
  const starChip = h("div", `display:flex;align-items:center;gap:14px;padding:14px 30px;border-radius:999px;border:1.5px solid ${C.line};background:rgba(255,255,255,0.05);opacity:0`, chips);
  icon(starChip, "star", 34, P.soft);
  const stars = h("div", `${T.num}font-size:40px;font-weight:700;font-family:${FONT.num}`, starChip, "0");

  return {
    root,
    update(t) {
      const b = ease.outCubic(seg(t, 0, 1.4));
      burst.style.opacity = String(b * (1 - 0.5 * seg(t, 1.4, 1.4)));
      tf(burst, 0, 0, 0.6 + 0.5 * b);
      owner.style.opacity = String(ease.outCubic(seg(t, 0.1, 0.5)));
      tf(owner, 0, (1 - ease.outCubic(seg(t, 0.1, 0.5))) * 16);
      revealWords(chars, t, 0.25, 0.08, 0.8);
      line.style.transform = `scaleX(${ease.outExpo(seg(t, 0.7, 0.8))})`;
      const bp = ease.outBack(seg(t, 1.0, 0.45));
      badge.style.opacity = String(Math.min(1, bp * 2));
      tf(badge, 0, (1 - bp) * 20, 0.85 + 0.15 * bp);
      const sp = ease.outBack(seg(t, 1.15, 0.45));
      starChip.style.opacity = String(Math.min(1, sp * 2));
      tf(starChip, 0, (1 - sp) * 20, 0.85 + 0.15 * sp);
      const n = ease.outExpo(seg(t, 1.2, 1.3));
      stars.textContent = formatCount(plan.repo.stars, n);
      tf(col, 0, 0, 1 + 0.04 * seg(t, 0, 3));
    },
  };
}
