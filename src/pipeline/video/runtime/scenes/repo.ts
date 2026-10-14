import { abs, fill, fitFont, fitLine, h, maskedWords, T, tf } from "../dom.ts";
import { drift, ease, seg } from "../ease.ts";
import { card, formatCount, icon, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C, FONT } from "../theme.ts";

export function buildRepo(c: SceneCtx): Scene {
  const { plan, L, P } = c;
  const r = plan.repo;
  const root = h("div", fill);
  const wrap = h("div", `${abs}left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;height:${L.box.h}px;display:flex;flex-direction:${L.short ? "column" : "row"};gap:${L.short ? 30 : 56}px`, root);
  const main = h("div", `display:flex;flex-direction:column;justify-content:center;gap:${L.short ? 26 : 30}px;${L.short ? "" : "width:1030px;flex:none"}`, wrap);

  const head = h("div", "display:flex;align-items:center;gap:28px", main);
  const mono = h("div", `flex:none;width:${L.short ? 110 : 128}px;height:${L.short ? 110 : 128}px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid ${P.glow(0.8)};background:${P.glow(0.14)};box-shadow:0 0 50px ${P.glow(0.35)}`, head);
  h("div", `${T.num}font-size:${L.short ? 56 : 64}px;color:${P.soft}`, mono, r.owner.charAt(0).toUpperCase());
  const titles = h("div", `min-width:0;flex:1`, head);
  h("div", `${T.mono}font-size:${L.short ? 30 : 32}px;color:${C.dim};letter-spacing:0.04em;margin-bottom:6px`, titles, r.owner);
  const nameStyle = `${T.display}font-weight:900;white-space:nowrap;`;
  const nameSize = fitLine(r.name, nameStyle, L.short ? 760 : 820, L.short ? 108 : 132, 26);
  const nameRow = h("div", `font-size:${nameSize}px;line-height:1.02;white-space:nowrap`, titles);
  const nameWords = maskedWords(nameRow, r.name, nameStyle);

  const descW = L.short ? L.box.w : 1030;
  const descStyle = `${T.display}font-weight:500;letter-spacing:-0.01em;line-height:1.28;color:${C.dim};`;
  const descText = r.description || "No description provided.";
  const descSize = fitFont(descText, descStyle, descW, L.short ? 190 : 170, L.short ? 42 : 40, 26);
  const desc = h("div", `${descStyle}font-size:${descSize}px;opacity:0`, main, descText);

  const tiles = h("div", `display:flex;gap:${L.short ? 18 : 24}px`, main);
  const tileData = [
    { name: "star" as const, value: r.stars, label: "stars" },
    { name: "fork" as const, value: r.forks, label: "forks" },
    { name: "issue" as const, value: r.openIssues, label: "open issues" },
  ];
  const tileEls = tileData.map((d) => {
    const t = card(tiles, `flex:1;min-width:0;padding:${L.short ? "22px 22px" : "26px 28px"};opacity:0`);
    const top = h("div", "display:flex;align-items:center;gap:12px;margin-bottom:8px", t);
    icon(top, d.name, L.short ? 30 : 32, P.soft);
    h("div", `${T.mono}font-size:${L.short ? 24 : 24}px;letter-spacing:0.1em;text-transform:uppercase;color:${C.dim}`, top, d.label);
    const v = h("div", `${T.num}font-family:${FONT.num};font-weight:800;font-size:${L.short ? 62 : 76}px;line-height:1.05`, t, "0");
    return { t, v, target: d.value };
  });

  const chips = h("div", "display:flex;flex-wrap:wrap;gap:14px", main);
  const chipTexts = [r.language, r.license, r.updated, ...r.topics].filter((x): x is string => !!x).slice(0, L.short ? 5 : 7);
  const chipEls = chipTexts.map((txt, i) => h("div", `${T.mono}font-size:${L.short ? 26 : 26}px;padding:10px 20px;border-radius:999px;border:1.5px solid ${i < 3 ? P.glow(0.45) : C.line};background:${i < 3 ? P.glow(0.1) : "rgba(255,255,255,0.04)"};color:${i < 3 ? C.text : C.dim};opacity:0`, chips, txt));

  const panel = card(wrap, `${L.short ? "flex:1;min-height:250px" : "flex:1;height:100%"};overflow:hidden;position:relative;border-radius:24px;opacity:0`);
  const bar = h("div", `position:absolute;left:0;right:0;top:0;height:58px;display:flex;align-items:center;gap:9px;padding:0 22px;border-bottom:1px solid ${C.line};background:#101015;z-index:2`, panel);
  for (const col of ["#3a3a42", "#3a3a42", "#3a3a42"]) h("i", `width:12px;height:12px;border-radius:50%;background:${col}`, bar);
  h("span", `${T.mono}font-size:22px;color:${C.dim};margin-left:12px`, bar, "README.md");
  const list = h("div", `position:absolute;left:0;right:0;top:58px;padding:0 26px`, panel);
  const lh = L.short ? 38 : 40;
  const lines = r.readme.length ? r.readme : ["(no README)"];
  const lineEls = lines.map((txt) => h("div", `${T.mono}font-size:${L.short ? 24 : 24}px;line-height:${lh}px;height:${lh}px;white-space:pre;overflow:hidden;text-overflow:ellipsis;color:rgba(245,245,247,0.4);border-left:3px solid transparent;padding-left:14px;margin-left:-14px`, list, txt));
  h("div", `position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(0deg,${C.card},rgba(10,10,13,0));z-index:2`, panel);
  const viewH = (L.short ? 300 : L.box.h) - 58;
  let hot = -1;

  return {
    root,
    update(t) {
      revealWords(nameWords, t, 0.1, 0.09, 0.8);
      const d = ease.outCubic(seg(t, 0.4, 0.6));
      desc.style.opacity = String(d);
      tf(desc, 0, (1 - d) * 22);
      tileEls.forEach((e, i) => {
        const p = ease.outBack(seg(t, 0.55 + i * 0.14, 0.55));
        e.t.style.opacity = String(Math.min(1, p * 2));
        tf(e.t, 0, (1 - p) * 40 + drift(t, 0.9, i * 2) * 3, 0.9 + 0.1 * p);
        e.v.textContent = formatCount(e.target, ease.outExpo(seg(t, 0.7 + i * 0.14, 1.5)));
      });
      chipEls.forEach((e, i) => {
        const p = ease.outCubic(seg(t, 1.1 + i * 0.09, 0.45));
        e.style.opacity = String(p);
        tf(e, 0, (1 - p) * 14);
      });
      const pp = ease.outCubic(seg(t, 0.3, 0.7));
      panel.style.opacity = String(pp);
      tf(panel, (1 - pp) * (L.short ? 0 : 60), (1 - pp) * (L.short ? 60 : 0));
      const scroll = Math.min(Math.max(0, (t - 0.9) * (L.short ? 34 : 40)), Math.max(0, lines.length * lh - viewH));
      tf(list, 0, -scroll);
      const center = Math.min(lines.length - 1, Math.floor((scroll + viewH * 0.45) / lh));
      if (center !== hot) {
        if (hot >= 0) {
          const old = lineEls[hot];
          if (old) {
            old.style.color = "rgba(245,245,247,0.4)";
            old.style.borderLeftColor = "transparent";
          }
        }
        const now = lineEls[center];
        if (now) {
          now.style.color = C.text;
          now.style.borderLeftColor = P.a;
        }
        hot = center;
      }
    },
  };
}
