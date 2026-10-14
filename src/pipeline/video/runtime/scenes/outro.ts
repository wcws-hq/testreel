import { abs, fill, fitLine, h, maskedWords, T, tf } from "../dom.ts";
import { drift, ease, seg } from "../ease.ts";
import { formatCount, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C, FONT, VERDICT_COLOR, rgba } from "../theme.ts";
import { subscribeButton } from "./subscribe.ts";

// 5 s closing card: what was covered, the verdict when there is one, and the subscribe button.
export function buildOutro(c: SceneCtx): Scene {
  const { plan, L, P } = c;
  const root = h("div", fill);
  const col = h("div", `${abs}left:${L.box.x}px;top:0;width:${L.box.w}px;height:${L.H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:34px`, root);
  h("div", `${T.mono}font-size:30px;letter-spacing:0.2em;color:${C.dim}`, col, plan.tested ? "TESTED IN A SANDBOX" : "EXPLAINED FROM THE README");
  const style = `${T.display}font-weight:900;white-space:nowrap;`;
  const size = fitLine(plan.repo.name, style, L.box.w * 0.97, 190, 26);
  const row = h("div", `font-size:${size}px;line-height:1.05;white-space:nowrap`, col);
  const words = maskedWords(row, plan.repo.name, `${style}background:linear-gradient(100deg,#fff 25%,${P.soft});-webkit-background-clip:text;background-clip:text;color:transparent;`);
  const score = plan.score;
  const chip = score ? h("div", `display:flex;align-items:baseline;gap:22px;padding:12px 40px;border-radius:999px;border:2.5px solid ${VERDICT_COLOR[score.verdict]};background:${rgba(VERDICT_COLOR[score.verdict], 0.12)};opacity:0`, col) : null;
  let scoreNum: HTMLElement | null = null;
  if (chip && score) {
    h("div", `${T.display}font-size:54px;font-weight:900;color:${VERDICT_COLOR[score.verdict]};letter-spacing:-0.02em`, chip, score.verdict);
    scoreNum = h("div", `${T.num}font-family:${FONT.num};font-weight:800;font-size:54px;color:${C.text}`, chip, "0.0");
  }
  const btn = subscribeButton(col, P, 46);
  return {
    root,
    update(t) {
      revealWords(words, t, 0.2, 0.09, 0.8);
      if (chip && scoreNum && score) {
        const p = ease.outBack(seg(t, 0.8, 0.5));
        chip.style.opacity = String(Math.min(1, p * 2));
        tf(chip, 0, (1 - p) * 20, 0.88 + 0.12 * p);
        scoreNum.textContent = formatCount(score.average, ease.outExpo(seg(t, 0.9, 1.2)), 1);
      }
      btn.update(t, 2.6);
      tf(col, drift(t, 0.6, 1) * 4, drift(t, 0.45, 2) * 5);
    },
  };
}
