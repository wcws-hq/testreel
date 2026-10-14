import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, h, T, tf } from "../dom.ts";
import { clamp, drift, ease, lerp, need, seg } from "../ease.ts";
import { icon } from "../kit.ts";
import { terminalMetrics } from "../layout.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { planTerminal, type TermRow } from "../times.ts";
import { C } from "../theme.ts";

type TerminalScene = Extract<ResolvedScene, { kind: "terminal" }>;

interface RowView { row: TermRow; el: HTMLElement; text: HTMLElement; caret: HTMLElement | null; hl: HTMLElement | null; typed: number }

// Replays real test steps: the command is typed, the real output lines appear, the view scrolls like a terminal.
export function buildTerminal(c: SceneCtx, s: TerminalScene): Scene {
  const { L, P, D } = c;
  const root = h("div", fill);
  const { fontPx, adv, lh, winW, winH, titleH, padX, padY, R, cols, maxOut } = terminalMetrics(L);
  const plan = planTerminal(s.steps, c.layer, cols, maxOut);
  const winX = L.box.x;
  const groupTop = L.short ? L.box.y + (L.box.h - winH - 96) / 2 : L.box.y; // on the Short the step strip and the window are centred together
  const winY = L.short ? groupTop + 96 : groupTop;

  h("div", `${abs}left:${winX + winW / 2 - 700}px;top:${winY + winH / 2 - 700}px;width:1400px;height:1400px;border-radius:50%;background:radial-gradient(circle,${P.glow(0.2)} 0%,${P.glow(0)} 58%)`, root);
  const win = h("div", `${abs}left:${winX}px;top:${winY}px;width:${winW}px;height:${winH}px;border-radius:24px;overflow:hidden;background:#07070a;border:1px solid rgba(255,255,255,0.13);box-shadow:0 50px 120px rgba(0,0,0,0.9),0 0 80px ${P.glow(0.16)};opacity:0`, root);
  const bar = h("div", `${abs}left:0;top:0;width:${winW}px;height:${titleH}px;display:flex;align-items:center;gap:10px;padding:0 24px;background:#101015;border-bottom:1px solid ${C.line};z-index:3`, win);
  for (const col of ["#ff5f57", "#febc2e", "#28c840"]) h("i", `width:14px;height:14px;border-radius:50%;background:${col};opacity:0.85`, bar);
  h("span", `${T.mono}font-size:20px;color:${C.dim};margin-left:18px;flex:1`, bar, "sandbox  /  bash");
  h("span", `${T.mono}font-size:18px;letter-spacing:0.1em;text-transform:uppercase;color:${P.soft};border:1.5px solid ${P.glow(0.5)};border-radius:999px;padding:5px 14px`, bar, "container");
  const body = h("div", `${abs}left:0;top:${titleH}px;width:${winW}px;height:${winH - titleH}px;overflow:hidden`, win);
  const content = h("div", `${abs}left:${padX}px;top:${padY}px;width:${winW - padX * 2}px`, body);

  const rows = plan.rows;
  const lastAt = Math.max(...rows.map((r) => r.at));
  const keyRows: RowView[] = [];
  const views: RowView[] = rows.map((row, i) => {
    const el = h("div", `${abs}left:0;top:${i * lh}px;width:${winW - padX * 2}px;height:${lh}px;line-height:${lh}px;white-space:pre;font-size:${fontPx}px;${T.mono}opacity:0`, content);
    const hl = row.kind === "out" && row.key ? h("div", `${abs}left:-${padX}px;top:0;width:${winW}px;height:${lh}px;background:linear-gradient(90deg,${P.glow(0.3)},${P.glow(0)});opacity:0;border-left:4px solid ${P.a}`, el) : null;
    let text: HTMLElement;
    let caret: HTMLElement | null = null;
    const isPrompt = row.kind === "prompt";
    if (row.kind === "cmd" || isPrompt) {
      const wrapped = i > 0 && need(rows[i - 1]).kind === "cmd" && need(rows[i - 1]).step === row.step;
      h("span", `color:${P.a};font-weight:700`, el, isPrompt || !wrapped ? "$ " : "  ");
      text = h("span", `color:${C.text};font-weight:600`, el);
      caret = h("span", `display:inline-block;width:${adv * 0.9}px;height:${fontPx * 1.05}px;background:${P.a};vertical-align:-${fontPx * 0.18}px;opacity:0`, el);
    } else if (row.kind === "status") {
      const ok = row.exit === 0;
      const chip = h("span", `display:inline-flex;align-items:center;gap:10px;padding:2px 16px;border-radius:999px;font-size:${fontPx - 5}px;line-height:${lh - 8}px;margin-top:4px;border:1.5px solid ${ok ? P.glow(0.7) : "rgba(255,255,255,0.55)"};color:${ok ? P.soft : C.text};background:${ok ? P.glow(0.12) : "rgba(255,255,255,0.08)"}`, el);
      icon(chip, ok ? "check" : "cross", fontPx - 8, ok ? P.soft : C.text, true);
      text = h("span", "", chip, `exit ${row.exit}  ${row.secs}s`);
    } else {
      const colour = row.kind === "note" ? C.faint : row.kind === "more" ? C.faint : row.key ? P.soft : "rgba(245,245,247,0.74)";
      text = h("span", `color:${colour};${row.key ? "font-weight:700;" : ""}${row.kind === "more" ? "font-style:italic;" : ""}`, el, row.text);
    }
    const v: RowView = { row, el, text, caret, hl, typed: -1 };
    if (hl) keyRows.push(v);
    return v;
  });
  h("div", `${abs}left:0;top:${titleH}px;width:${winW}px;height:50px;background:linear-gradient(180deg,#07070a,rgba(7,7,10,0));z-index:2;pointer-events:none`, win);

  // Step list: a side panel in full, a segmented strip above the window in short.
  const spans = plan.spans;
  const cardH = 112;
  const cardGap = 16;
  const panelW = L.box.x + L.box.w - (winX + winW + 50);
  const side = L.short ? null : h("div", `${abs}left:${winX + winW + 50}px;top:${winY}px;width:${panelW}px;height:${winH}px;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 40px,#000 calc(100% - 40px),transparent 100%)`, root);
  const sideList = side ? h("div", `${abs}left:0;top:0;width:${panelW}px`, side) : null;
  const cards = side && sideList
    ? spans.map((sp, i) => {
        const el = h("div", `${abs}left:0;top:${i * (cardH + cardGap)}px;width:${panelW}px;height:${cardH}px;border-radius:20px;border:1.5px solid ${C.line};background:${C.card};padding:16px 22px;overflow:hidden`, sideList);
        const top = h("div", "display:flex;align-items:center;justify-content:space-between", el);
        h("div", `${T.mono}font-size:20px;letter-spacing:0.12em;color:${C.dim}`, top, `STEP ${String(sp.n).padStart(2, "0")}`);
        const status = h("div", `${T.mono}font-size:20px;color:${C.faint};opacity:0`, top, sp.exit === 0 ? `ok  ${sp.secs}s` : `exit ${sp.exit}  ${sp.secs}s`);
        h("div", `${T.mono}font-size:22px;color:${C.text};margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, el, sp.cmd);
        const prog = h("div", `${abs}left:0;bottom:0;width:100%;height:5px;background:${P.a};transform-origin:0 50%;transform:scaleX(0)`, el);
        return { el, status, prog };
      })
    : [];
  const strip = L.short ? h("div", `${abs}left:${winX}px;top:${groupTop}px;width:${winW}px;height:72px`, root) : null;
  const stripLabel = strip ? h("div", `${T.mono}font-size:26px;letter-spacing:0.1em;color:${C.dim}`, strip) : null;
  const stripBars = strip ? spans.map((_, i) => {
    const w = (winW - (spans.length - 1) * 8) / spans.length;
    const b = h("div", `${abs}left:${i * (w + 8)}px;top:50px;width:${w}px;height:10px;border-radius:5px;background:rgba(255,255,255,0.14);overflow:hidden`, strip);
    return h("div", `width:100%;height:100%;background:${P.a};transform-origin:0 50%;transform:scaleX(0)`, b);
  }) : [];
  const maxScroll = Math.max(0, spans.length * (cardH + cardGap) - cardGap - winH);
  const targetScroll = (i: number) => clamp(i * (cardH + cardGap) - winH / 2 + cardH / 2, 0, maxScroll);

  return {
    root,
    update(t) {
      const enter = ease.outQuart(seg(t, 0, 0.7));
      win.style.opacity = String(clamp(enter * 2));
      const push = 1 + 0.035 * clamp(t / Math.max(D, 1));
      win.style.transform = `translate3d(${(drift(t, 0.4, 1) * 4).toFixed(2)}px,${((1 - enter) * 60 + drift(t, 0.35, 4) * 4).toFixed(2)}px,0) scale(${((0.96 + 0.04 * enter) * push).toFixed(4)})`;

      let pushed = 0;
      for (const [i, v] of views.entries()) {
        const { row } = v;
        if (i >= R) pushed += ease.outCubic(seg(t, row.at, 0.2));
        if (t < row.at) {
          v.el.style.opacity = "0";
          continue;
        }
        const appear = seg(t, row.at, 0.12);
        v.el.style.opacity = String(appear);
        if (row.kind === "cmd" || row.kind === "prompt") {
          const isPrompt = row.kind === "prompt";
          const n = isPrompt ? 0 : Math.floor(clamp((t - row.at) / Math.max(row.typeSeconds, 0.01)) * row.text.length);
          if (n !== v.typed) {
            v.text.textContent = row.text.slice(0, n);
            v.typed = n;
          }
          const typing = !isPrompt && n < row.text.length;
          const blink = Math.floor(t * 2.2) % 2 === 0;
          if (v.caret) v.caret.style.opacity = typing || (isPrompt && blink) ? "1" : "0";
        } else if (row.kind === "out") {
          v.el.style.transform = `translate3d(${((1 - ease.outCubic(appear)) * -10).toFixed(2)}px,0,0)`;
        }
      }
      tf(content, 0, -pushed * lh);

      const hotAfter = lastAt + 0.8;
      const hot = t > hotAfter && keyRows.length ? Math.floor((t - hotAfter) / 1.6) % keyRows.length : -1;
      keyRows.forEach((v, k) => {
        if (!v.hl) return;
        const flash = 1 - seg(t, v.row.at, 0.9);
        const pulse = k === hot ? Math.sin(Math.PI * ((t - hotAfter) / 1.6 - Math.floor((t - hotAfter) / 1.6))) : 0;
        v.hl.style.opacity = String(t >= v.row.at ? Math.max(flash * 0.8, pulse) : 0);
      });

      const active = spans.findLastIndex((sp) => t >= sp.start);
      cards.forEach((cd, i) => {
        const sp = need(spans[i]);
        const done = t >= sp.end;
        const isActive = i === active;
        cd.el.style.borderColor = isActive ? P.glow(0.85) : C.line;
        cd.el.style.background = isActive ? `linear-gradient(180deg,${P.glow(0.16)},${C.card})` : C.card;
        cd.el.style.opacity = String(t < sp.start - 0.2 ? 0.3 : done ? 0.62 : 1);
        cd.status.style.opacity = t > sp.typeEnd + 0.4 ? "1" : "0";
        cd.prog.style.transform = `scaleX(${clamp((t - sp.start) / Math.max(sp.end - sp.start, 0.01)).toFixed(4)})`;
      });
      if (sideList) {
        const prev = Math.max(active - 1, 0);
        const e = ease.inOutCubic(seg(t, active >= 0 ? need(spans[active]).start : 0, 0.6));
        tf(sideList, 0, -lerp(targetScroll(prev), targetScroll(Math.max(active, 0)), e));
      }
      if (stripLabel) stripLabel.textContent = `STEP ${Math.max(active, 0) + 1} / ${spans.length}`;
      stripBars.forEach((b, i) => {
        const sp = need(spans[i]);
        b.style.transform = `scaleX(${clamp((t - sp.start) / Math.max(sp.end - sp.start, 0.01)).toFixed(4)})`;
      });
    },
  };
}
