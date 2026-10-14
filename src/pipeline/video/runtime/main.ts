// Entry point of the in-page runtime. The page exposes window.__seek(t): render the frame at time t, deterministically.
import type { PlanLayer, VideoPlan } from "../plan.ts";
import { buildBackground, buildCallout, buildGrainAndVignette, buildLowerThird, buildTicker, type Layer } from "./chrome.ts";
import { h } from "./dom.ts";
import { need } from "./ease.ts";
import { layoutFor } from "./layout.ts";
import { buildBars } from "./scenes/bars.ts";
import { buildBrowser } from "./scenes/browser.ts";
import { buildCta } from "./scenes/cta.ts";
import { buildFootage } from "./scenes/footage.ts";
import { buildHook } from "./scenes/hook.ts";
import { buildIntro } from "./scenes/intro.ts";
import { buildOutro } from "./scenes/outro.ts";
import { buildPoints } from "./scenes/points.ts";
import { buildQuote } from "./scenes/quote.ts";
import { buildRepo } from "./scenes/repo.ts";
import { buildScorecard } from "./scenes/scorecard.ts";
import { buildStats } from "./scenes/stats.ts";
import { buildTerminal } from "./scenes/terminal.ts";
import { buildVerdict } from "./scenes/verdict.ts";
import type { Scene, SceneCtx } from "./scene.ts";
import { applyTransition, buildFx, resetFx, resetRoot } from "./transitions.ts";
import { palette } from "./theme.ts";

declare global {
  interface Window {
    __PLAN__: VideoPlan;
    __ready: Promise<void>;
    __seek: (t: number) => Promise<void>;
  }
}

function buildScene(c: SceneCtx): Scene {
  const scene = c.layer.scene;
  switch (c.layer.kind) {
    case "intro":
      return buildIntro(c);
    case "outro":
      return buildOutro(c);
    default:
      break;
  }
  if (!scene) throw new Error(`layer ${c.layer.id} has no scene`);
  switch (scene.kind) {
    case "hook":
      return buildHook(c, scene.lines);
    case "repo":
      return buildRepo(c);
    case "browser":
      return buildBrowser(c, scene);
    case "footage":
      return buildFootage(c, scene);
    case "terminal":
      return buildTerminal(c, scene);
    case "stats":
      return buildStats(c, scene);
    case "bars":
      return buildBars(c, scene);
    case "points":
      return buildPoints(c, scene);
    case "quote":
      return buildQuote(c, scene);
    case "scorecard":
      return buildScorecard(c);
    case "verdict":
      return buildVerdict(c);
    case "cta":
      return buildCta(c);
  }
}

async function init(): Promise<void> {
  const plan = window.__PLAN__;
  const L = layoutFor(plan.kind);
  const P = palette(plan.accent);
  await Promise.all(["800 40px Inter", "500 40px Inter", "700 40px Inter", "500 40px 'JetBrains Mono'", "700 40px 'JetBrains Mono'", "800 40px Outfit"].map((f) => document.fonts.load(f)));
  await document.fonts.ready;

  const images: Record<string, HTMLImageElement> = {};
  await Promise.all(
    plan.images.map(async (url) => {
      const img = new Image();
      img.decoding = "sync";
      img.src = url;
      await img.decode();
      images[url] = img;
    }),
  );

  const stage = h("div", `position:relative;width:${L.W}px;height:${L.H}px;overflow:hidden;background:#000`, document.body);
  const layerHost = h("div", "position:absolute;inset:0", stage);
  const items = plan.layers.map((layer: PlanLayer) => {
    const root = h("div", "position:absolute;inset:0;overflow:hidden;display:none", layerHost);
    const bg = buildBackground(root, L, P);
    const scene = buildScene({ plan, L, P, layer, D: layer.end - layer.start + layer.preroll, images });
    root.appendChild(scene.root);
    return { layer, root, bg, scene };
  });
  const fx = buildFx(stage, L, P);
  const overlays: Layer[] = [buildLowerThird(stage, plan, L, P), buildCallout(stage, plan, L, P)];
  if (!L.short) overlays.push(buildTicker(stage, plan, P));
  const finish = buildGrainAndVignette(stage, plan.fps);

  const blank = [...document.images].filter((i) => !i.complete || i.naturalWidth === 0 || !stage.contains(i));
  if (blank.length) throw new Error(`${blank.length} screenshot(s) are missing from the page or not decoded: ${blank.map((i) => i.src).join(", ")}`);

  let visible: number[] = [];
  window.__seek = async (time: number) => {
    const t = Math.min(Math.max(time, 0), plan.total - 1e-6);
    const frame = Math.round(t * plan.fps);
    let cur = 0;
    for (let i = 0; i < items.length; i++) if (need(items[i]).layer.start <= t) cur = i;
    const inc = need(items[cur]);
    const prev = cur > 0 ? need(items[cur - 1]) : null;
    const p = inc.layer.trans && prev ? (t - inc.layer.start) / inc.layer.trans.dur : 1;
    const transitioning = prev !== null && inc.layer.trans !== null && p < 1;
    const next = transitioning && prev ? [cur - 1, cur] : [cur];
    for (const i of visible) if (!next.includes(i)) need(items[i]).root.style.display = "none";
    visible = next;
    resetFx(fx);
    for (const i of next) {
      const it = need(items[i]);
      resetRoot(it.root);
      it.bg.update(t);
      it.scene.update(t - it.layer.start + it.layer.preroll, frame);
    }
    if (transitioning && prev && inc.layer.trans) applyTransition(inc.layer.trans.type, prev.root, inc.root, p, fx, L, P, frame);
    for (const o of overlays) o.update(t);
    finish.update(t);
    await Promise.all(next.map((i) => need(items[i]).scene.settle?.()));
  };
}

document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
window.__ready = init();
