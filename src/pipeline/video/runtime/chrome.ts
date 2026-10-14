// Persistent layers that live outside the scenes: background, chapter ticker, lower-third, callout, grain, vignette.
import type { VideoPlan } from "../plan.ts";
import { abs, fill, fitFont, h, T, tf } from "./dom.ts";
import { clamp, drift, ease, need, rng, seg } from "./ease.ts";
import type { Layout } from "./layout.ts";
import { C, type Palette } from "./theme.ts";

export interface Layer { update(t: number): void }

// The grain pattern changes a few times a second. Faster grain at crf 18 multiplies the bitrate roughly tenfold.
const GRAIN_HOLD_FRAMES = 8;

export function buildBackground(stage: HTMLElement, L: Layout, P: Palette): Layer {
  const root = h("div", `${fill}background:#000;overflow:hidden`, stage);
  const size = Math.round(Math.max(L.W, L.H) * 0.9);
  const blob = (alpha: number) => h("div", `${abs}width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:50%;background:radial-gradient(circle,${P.glow(alpha)} 0%,${P.glow(0)} 66%)`, root);
  const a = blob(0.1);
  const b = blob(0.055);
  const grid = h("div", `${fill}opacity:0.55;background-image:radial-gradient(rgba(255,255,255,0.13) 1.6px,transparent 1.8px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse at 50% 46%,#000 0%,transparent 70%)`, root);
  return {
    update(t) {
      tf(a, L.W * (0.78 + 0.1 * drift(t, 0.21, 1)), L.H * (0.22 + 0.08 * drift(t, 0.17, 4)));
      tf(b, L.W * (0.12 + 0.08 * drift(t, 0.19, 2)), L.H * (0.86 + 0.06 * drift(t, 0.15, 7)));
      grid.style.backgroundPosition = `${(t * 7).toFixed(1)}px ${(t * 4).toFixed(1)}px`;
    },
  };
}

export function buildGrainAndVignette(stage: HTMLElement, fps: number): Layer {
  const tile = document.createElement("canvas");
  tile.width = 256;
  tile.height = 256;
  const ctx = tile.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const img = ctx.createImageData(256, 256);
  const rand = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const grain = h("div", `${fill}opacity:0.025;background-image:url(${tile.toDataURL()});background-size:256px 256px;mix-blend-mode:screen`, stage);
  h("div", `${fill}background:radial-gradient(ellipse at 50% 48%,rgba(0,0,0,0) 58%,rgba(0,0,0,0.42) 100%)`, stage);
  return {
    update(t) {
      const r = rng(Math.floor(Math.round(t * fps) / GRAIN_HOLD_FRAMES));
      grain.style.backgroundPosition = `${Math.floor(r() * 256)}px ${Math.floor(r() * 256)}px`;
    },
  };
}

export function buildTicker(stage: HTMLElement, plan: VideoPlan, P: Palette): Layer {
  const x0 = 120;
  const width = 1680;
  const root = h("div", `${abs}left:${x0}px;top:26px;width:${width}px;height:60px;opacity:0`, stage);
  const label = h("div", `${T.mono}${abs}left:0;top:0;font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:${C.dim};white-space:nowrap`, root);
  const count = h("div", `${T.mono}position:absolute;right:0;top:0;font-size:22px;letter-spacing:0.14em;color:${C.faint}`, root);
  const chapters = plan.chapters;
  const span = Math.max(need(chapters.at(-1)).end - need(chapters[0]).start, 1);
  const gap = 8;
  const segs = chapters.map((c) => {
    const left = ((c.start - need(chapters[0]).start) / span) * width;
    const w = ((c.end - c.start) / span) * width - gap;
    const track = h("div", `${abs}left:${left.toFixed(1)}px;top:42px;width:${w.toFixed(1)}px;height:5px;border-radius:3px;background:rgba(255,255,255,0.14);overflow:hidden`, root);
    const bar = h("div", `${abs}width:100%;height:100%;background:${P.a};transform-origin:0 50%;transform:scaleX(0)`, track);
    return { c, bar };
  });
  let current = -1;
  return {
    update(t) {
      const inP = seg(t, plan.tickerStart, 0.5);
      const outP = seg(t, plan.tickerEnd - 0.5, 0.4);
      root.style.opacity = String(ease.outCubic(inP) * (1 - outP));
      let idx = 0;
      segs.forEach((s, i) => {
        s.bar.style.transform = `scaleX(${clamp((t - s.c.start) / (s.c.end - s.c.start)).toFixed(4)})`;
        if (t >= s.c.start) idx = i;
      });
      const ch = need(chapters[idx]);
      if (idx !== current) {
        label.textContent = `${String(idx + 1).padStart(2, "0")}  ${ch.title}`;
        count.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}`;
        current = idx;
      }
      const e = ease.outCubic(seg(t, ch.start, 0.4));
      label.style.opacity = String(0.4 + 0.6 * e);
      tf(label, 0, (1 - e) * 8);
    },
  };
}

export function buildLowerThird(stage: HTMLElement, plan: VideoPlan, L: Layout, P: Palette): Layer {
  const { start, end } = plan.lowerThird;
  const root = h("div", `${abs}opacity:0;${L.short ? "left:60px;top:176px" : "left:120px;top:932px"}`, stage);
  const bar = h("div", `${abs}left:0;top:0;width:7px;height:84px;border-radius:4px;background:${P.a};box-shadow:0 0 24px ${P.glow(0.7)};transform-origin:50% 0`, root);
  const body = h("div", "position:relative;margin-left:26px;white-space:nowrap", root);
  const nameSize = fitFont(plan.repo.name, `${T.display}white-space:nowrap`, L.short ? 780 : 760, 70, L.short ? 56 : 52, 30);
  h("div", `${T.display}font-size:${nameSize}px;line-height:1.05`, body, plan.repo.name);
  const meta = [plan.repo.owner, plan.repo.language, plan.tested ? "tested in a sandbox" : "explained"].filter(Boolean).join("  /  ");
  h("div", `${T.mono}font-size:${L.short ? 26 : 24}px;color:${C.dim};margin-top:6px;letter-spacing:0.02em;max-width:${L.short ? 820 : 760}px;overflow:hidden;text-overflow:ellipsis`, body, meta);
  return {
    update(t) {
      if (t < start - 0.01 || t > end + 0.6) {
        root.style.opacity = "0";
        return;
      }
      const inP = seg(t, start, 0.5);
      const outP = seg(t, end, 0.45);
      bar.style.transform = `scaleY(${ease.outCubic(seg(t, start, 0.35)) * (1 - ease.inCubic(outP))})`;
      const e = ease.outQuart(seg(t, start + 0.1, 0.5));
      body.style.opacity = String(e * (1 - outP));
      body.style.clipPath = `inset(0 ${(1 - e) * 100}% 0 0)`;
      tf(body, (1 - e) * -34 - outP * 20, 0);
      root.style.opacity = String(inP > 0 ? 1 : 0);
    },
  };
}

export function buildCallout(stage: HTMLElement, plan: VideoPlan, L: Layout, P: Palette): Layer {
  const items = plan.layers.flatMap((l) => (l.callout ? [l.callout] : []));
  const maxW = 880;
  const holder = h("div", `${abs}opacity:0;${L.short ? `left:${(L.W - maxW) / 2}px;width:${maxW}px;top:1584px;display:flex;justify-content:center` : `right:120px;top:944px;width:${maxW}px;display:flex;justify-content:flex-end`}`, stage);
  const pill = h("div", `display:flex;align-items:center;gap:16px;padding:14px 28px;border-radius:22px;background:${P.glow(0.18)};border:1.5px solid ${P.glow(0.55)};box-shadow:0 0 40px ${P.glow(0.25)};max-width:${maxW}px`, holder);
  h("div", `flex:none;width:14px;height:14px;border-radius:50%;background:${P.a};box-shadow:0 0 14px ${P.a}`, pill);
  const text = h("div", `${T.display}font-size:${L.short ? 40 : 36}px;font-weight:700;letter-spacing:-0.01em;line-height:1.1`, pill);
  let shown = -1;
  return {
    update(t) {
      const idx = items.findIndex((c) => t >= c.start && t <= c.end + 0.3);
      const c = items[idx];
      if (!c) {
        holder.style.opacity = "0";
        return;
      }
      if (shown !== idx) {
        text.textContent = c.text;
        text.style.fontSize = `${fitFont(c.text, `${T.display}font-weight:700;line-height:1.1`, maxW - 100, L.short ? 90 : 80, L.short ? 40 : 36, 24)}px`;
        shown = idx;
      }
      const inP = ease.outBack(seg(t, c.start, 0.4));
      const outP = seg(t, c.end, 0.25);
      holder.style.opacity = String(clamp(inP * 2) * (1 - outP));
      tf(pill, 0, (1 - inP) * 18, 0.88 + 0.12 * inP);
    },
  };
}
