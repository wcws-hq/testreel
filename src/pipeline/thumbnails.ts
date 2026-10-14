// thumbnailsStage: three different thumbnails per video kind, drawn as HTML and captured with Chrome.
// 1: giant headline + tilted browser frame + score ring. 2: giant score (or star count) as the hero.
// 3: real terminal output close-up on an accent slab. Everything shown comes from the run's data.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer-core";
import type { RepoInfo, Score, Scripts, TestLog, TestStep, VideoKind } from "../shared/types.ts";
import { readJson, type RunCtx, type Stage } from "./ctx.ts";
import { fontCss } from "./video/page.ts";
import { accentFor } from "./video/plan.ts";
import { lighten, rgba, VERDICT_COLOR } from "./video/runtime/theme.ts";
import { cancelled } from "./video/proc.ts";

declare global {
  interface Window {
    __fitted: Promise<unknown>;
  }
}

const MAX_BYTES = 1_900_000;
const SIZE: Record<VideoKind, { W: number; H: number }> = { full: { W: 1280, H: 720 }, short: { W: 1080, H: 1920 } };

interface Data {
  kind: VideoKind;
  W: number;
  H: number;
  accent: string;
  soft: string;
  repo: RepoInfo;
  name: string;
  tested: boolean;
  score: Score | null;
  steps: TestStep[];
  shot: string | null; // file:// url of the screenshot used in frames
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));
const STAR = '<svg viewBox="0 0 24 24" width="1em" height="1em" style="vertical-align:-0.1em"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';

// Lines for a stacked headline: one word per line up to three words, two per line for four.
function headlineLines(words: string[]): string[] {
  return words.length <= 3 ? words : [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
}

function headline(words: string[], id: string, accent: Data["accent"], soft: string): string {
  const lines = headlineLines(words);
  const last = lines.length - 1;
  return lines.map((l, i) => `<div class="${id}" style="white-space:nowrap;${i === last ? `background:linear-gradient(100deg,${soft},${accent});-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;` : ""}">${esc(l)}</div>`).join("");
}

function ring(d: Data, size: number): string {
  const score = d.score;
  if (!score) return "";
  const vc = VERDICT_COLOR[score.verdict];
  const r = size / 2 - 16;
  const c = 2 * Math.PI * r;
  return `<div style="position:relative;width:${size}px;height:${size}px;filter:drop-shadow(0 0 24px ${rgba(vc, 0.55)})">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="rgba(0,0,0,0.78)" stroke="rgba(255,255,255,0.14)" stroke-width="20"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${vc}" stroke-width="20" stroke-linecap="round" stroke-dasharray="${(c * score.average) / 10} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:900 ${size * 0.4}px Outfit;letter-spacing:-0.03em;color:#fff">${score.average.toFixed(1)}</div></div>`;
}

function verdictPill(d: Data, size: number): string {
  if (!d.score) return "";
  const vc = VERDICT_COLOR[d.score.verdict];
  return `<div style="display:inline-block;font:900 ${size}px Inter;letter-spacing:0.02em;color:#000;background:${vc};padding:${size * 0.2}px ${size * 0.55}px;border-radius:999px;box-shadow:0 0 40px ${rgba(vc, 0.55)}">${d.score.verdict}</div>`;
}

function badge(d: Data, size: number): string {
  return `<div style="display:inline-block;font:700 ${size}px 'JetBrains Mono';letter-spacing:0.14em;color:${d.soft};border:3px solid ${rgba(d.accent, 0.8)};background:${rgba(d.accent, 0.16)};padding:${size * 0.3}px ${size * 0.7}px;border-radius:999px">${d.tested ? "TESTED" : "EXPLAINED"}</div>`;
}

function starChip(d: Data, size: number): string {
  return `<div style="display:inline-block;font:800 ${size}px Inter;color:#fff;border:3px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.07);padding:${size * 0.25}px ${size * 0.6}px;border-radius:999px"><span style="color:${d.soft}">${STAR}</span> ${compact(d.repo.stars)}</div>`;
}

function frame(d: Data, w: number, h: number, extra: string): string {
  const bar = 54;
  const body = d.shot
    ? `<img src="${d.shot}" style="display:block;width:${w}px;height:${h - bar}px;object-fit:cover;object-position:50% 0%">`
    : `<div style="width:${w}px;height:${h - bar}px;background:linear-gradient(160deg,${rgba(d.accent, 0.35)},#000);display:flex;align-items:center;justify-content:center;font:900 ${w * 0.16}px Inter;letter-spacing:-0.04em;color:#fff">${esc(d.name)}</div>`;
  return `<div style="position:absolute;${extra};width:${w}px;height:${h}px;border-radius:26px;overflow:hidden;background:#0b0b0e;border:3px solid ${rgba(d.accent, 0.75)};box-shadow:0 0 0 1px rgba(255,255,255,0.1) inset,0 0 160px ${rgba(d.accent, 0.55)},0 60px 110px rgba(0,0,0,0.75)">
    <div style="height:${bar}px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#12121a;border-bottom:1px solid rgba(255,255,255,0.1)"><i style="width:15px;height:15px;border-radius:50%;background:#ff5f57"></i><i style="width:15px;height:15px;border-radius:50%;background:#febc2e"></i><i style="width:15px;height:15px;border-radius:50%;background:#28c840"></i>
    <span style="margin-left:14px;font:500 22px 'JetBrains Mono';color:rgba(245,245,247,0.6)">${esc(d.repo.fullName)}</span></div>${body}</div>`;
}

// Lines that tell the viewer something: failures, results, counts, status codes. Version banners do not.
const RESULT_LINE = /(\berror\b|\bfail(ed|ing|ure|s)?\b|crash|TypeError|ENOENT|EACCES|denied|not found|\bpass(ed|ing)?\b|\bok\b|success|\b\d+ (asserts?|suites?|tests?|passing|failing|files?|packages?)\b|\b(200|401|403|404|500)\b)/i;
// Shell plumbing and stack frames: true output, but it says nothing on a thumbnail.
const NOISE_LINE = /command not found|^bash: |^\s+at |^node:|^\s*\^+\s*$|nohup/i;
const STRONG_LINE = /TypeError|\berror\b|\bfail(ed|ing|ure|s)?\b|crash|\b\d+ (asserts?|suites?|tests?|passing|failing)\b/i;
const BANNER_LINE = /^\s*v?\d+\.\d+(\.\d+)?\s*$|\bversion\b|^\s*\d+\.\d+\.\d+/i;

// Cuts at a character budget with an ellipsis so no glyph is ever clipped by the box.
function ellipsize(text: string, cols: number): string {
  const t = text.replace(/\t/g, "  ").trimEnd();
  return t.length <= cols ? t : `${t.slice(0, cols - 1).trimEnd()}\u2026`;
}

// Drops leading `export X=...;` and `cd dir &&` so the command line starts with what was actually run.
function shortCommand(cmd: string): string {
  let c = cmd.replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== c; ) {
    prev = c;
    c = c.replace(/^export \S+=\S+;\s*/, "").replace(/^cd \S+ (&&|;)\s*/, "");
  }
  return c;
}

function terminalLines(d: Data, maxLines: number, cols: number): { cmd: string; lines: { text: string; key: boolean }[] } {
  if (!d.tested || !d.steps.length) {
    const lines = d.repo.readme.split("\n").map((l) => l.replace(/<[^>]*>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").trimEnd()).filter((l) => l.trim() && !/^```/.test(l));
    return { cmd: "cat README.md", lines: lines.slice(0, maxLines).map((text) => ({ text: ellipsize(text, cols), key: /^#/.test(text) })) };
  }
  const usable = (s: TestStep) => {
    const keys: Record<string, true> = {};
    return s.out.split("\n").filter((l) => {
      const key = l.replace(/\d+/g, "#").trim().split(/\s+/).slice(0, 2).join(" ");
      if (!key || l.length > 160 || BANNER_LINE.test(l) || NOISE_LINE.test(l) || keys[key]) return false;
      keys[key] = true;
      return true;
    });
  };
  const score = (s: TestStep) => {
    const lines = usable(s);
    return Math.min(lines.filter((l) => RESULT_LINE.test(l)).length, maxLines) + (lines.some((l) => STRONG_LINE.test(l)) ? 4 : 0);
  };
  const best = d.steps.reduce((a, b) => (score(b) > score(a) ? b : a));
  const all = usable(best);
  const results = all.filter((l) => RESULT_LINE.test(l));
  const picked = (results.length >= 2 ? results : all).slice(0, maxLines);
  return { cmd: ellipsize(shortCommand(best.cmd), cols - 2), lines: picked.map((text) => ({ text: ellipsize(text, cols), key: RESULT_LINE.test(text) })) };
}

// Fit script: each headline block shrinks until its widest line and total height fit the box.
const FIT = `function fit(sel,w,h,max,min){var els=[].slice.call(document.querySelectorAll(sel));var c=els[0].parentElement;var lo=min,hi=max;while(hi-lo>1){var m=(lo+hi)>>1;els.forEach(function(e){e.style.fontSize=m+'px'});var ok=c.scrollWidth<=w&&c.getBoundingClientRect().height<=h&&els.every(function(e){return e.scrollWidth<=w});if(ok)lo=m;else hi=m}els.forEach(function(e){e.style.fontSize=lo+'px'})}`;

function page(d: Data, body: string, script: string): string {
  const glow = (x: number, y: number, size: number, alpha: number) => `<div style="position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle,${rgba(d.accent, alpha)} 0%,${rgba(d.accent, 0)} 64%)"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}${fontCss()}
body{width:${d.W}px;height:${d.H}px;position:relative;overflow:hidden;background:#000;font-family:Inter,sans-serif;color:#fff}
.h{font-family:Inter;font-weight:900;letter-spacing:-0.045em;line-height:0.93;text-transform:uppercase;color:#fff;text-shadow:0 10px 50px rgba(0,0,0,0.55)}</style></head><body>
${glow(d.W * 0.72, d.H * 0.35, Math.max(d.W, d.H) * 0.95, 0.5)}${glow(d.W * 0.1, d.H * 0.95, Math.max(d.W, d.H) * 0.6, 0.22)}
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,0.16) 1.6px,transparent 1.8px);background-size:48px 48px;-webkit-mask-image:radial-gradient(ellipse at 60% 40%,#000,transparent 70%)"></div>
${body}<script>${FIT}window.__fitted=Promise.all(["900 40px Inter","800 40px Inter","900 40px Outfit","600 40px 'JetBrains Mono'"].map(function(f){return document.fonts.load(f)})).then(function(){${script}});</script></body></html>`;
}

function variant1(d: Data, words: string[]): string {
  if (d.kind === "full") {
    const fw = 760;
    const fh = 520;
    return page(
      d,
      `<div style="position:absolute;left:54px;top:50px;display:flex;gap:16px;align-items:center">${badge(d, 26)}${starChip(d, 30)}</div>
       <div style="position:absolute;left:54px;top:140px;width:580px;height:470px;display:flex;flex-direction:column;justify-content:center"><div id="hl">${headline(words, "h hl1", d.accent, d.soft)}</div></div>
       <div style="position:absolute;left:690px;top:96px;perspective:2000px;width:650px;height:540px">${frame(d, fw, fh, "left:0;top:0;transform:rotateY(-15deg) rotateX(5deg) rotateZ(1.5deg);transform-origin:0 50%")}</div>
       <div style="position:absolute;left:980px;top:410px;width:240px;display:flex;flex-direction:column;align-items:center;gap:8px">${ring(d, 210)}${verdictPill(d, 34)}</div>`,
      "fit('.hl1',580,470,200,60)",
    );
  }
  return page(
    d,
    `<div style="position:absolute;left:60px;top:200px;display:flex;gap:18px;align-items:center">${badge(d, 30)}${starChip(d, 36)}</div>
     <div style="position:absolute;left:60px;top:300px;width:960px;height:620px;display:flex;flex-direction:column;justify-content:center"><div id="hl">${headline(words, "h hl1", d.accent, d.soft)}</div></div>
     <div style="position:absolute;left:110px;top:980px;perspective:2400px;width:960px;height:600px">${frame(d, 860, 560, "left:0;top:0;transform:rotateY(-12deg) rotateX(5deg) rotateZ(1deg);transform-origin:0 50%")}</div>
     <div style="position:absolute;left:640px;top:1130px;display:flex;flex-direction:column;align-items:center;gap:16px">${ring(d, 300)}${verdictPill(d, 46)}</div>`,
    "fit('.hl1',960,620,300,80)",
  );
}

function variant2(d: Data, words: string[]): string {
  const { W } = d;
  const vc = d.score ? VERDICT_COLOR[d.score.verdict] : d.accent;
  const hero = d.score ? d.score.average.toFixed(1) : compact(d.repo.stars);
  const label = d.score ? "OUT OF 10" : "GITHUB STARS";
  const heroColor = d.score ? vc : "#fff";
  if (d.kind === "full") {
    return page(
      d,
      `<div style="position:absolute;left:40px;top:30px;width:700px;height:520px;display:flex;align-items:center;justify-content:flex-start"><div id="hero" style="font:900 520px Outfit;letter-spacing:-0.06em;line-height:0.85;color:${heroColor};text-shadow:0 0 120px ${rgba(vc, 0.55)};white-space:nowrap">${hero}</div></div>
       <div style="position:absolute;left:56px;top:540px;display:flex;gap:18px;align-items:center"><div style="font:700 30px 'JetBrains Mono';letter-spacing:0.16em;color:rgba(245,245,247,0.7)">${label}</div>${d.score ? verdictPill(d, 38) : starChip(d, 30)}</div>
       <div style="position:absolute;left:760px;top:70px;width:470px;height:470px;display:flex;flex-direction:column;justify-content:center"><div id="hl">${headline(words, "h hl2", d.accent, d.soft)}</div></div>
       <div style="position:absolute;left:760px;top:600px;font:700 34px 'JetBrains Mono';color:rgba(245,245,247,0.75)">${esc(d.repo.fullName)}</div>`,
      "fit('#hero',680,520,520,200);fit('.hl2',470,470,190,56)",
    );
  }
  return page(
    d,
    `<div style="position:absolute;left:40px;top:220px;width:1000px;height:640px;display:flex;align-items:center;justify-content:center"><div id="hero" style="font:900 700px Outfit;letter-spacing:-0.06em;line-height:0.85;color:${heroColor};text-shadow:0 0 140px ${rgba(vc, 0.55)};white-space:nowrap">${hero}</div></div>
     <div style="position:absolute;left:0;width:${W}px;top:880px;display:flex;gap:20px;align-items:center;justify-content:center"><div style="font:700 36px 'JetBrains Mono';letter-spacing:0.16em;color:rgba(245,245,247,0.7)">${label}</div>${d.score ? verdictPill(d, 44) : starChip(d, 36)}</div>
     <div style="position:absolute;left:60px;top:990px;width:960px;height:520px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center"><div id="hl">${headline(words, "h hl2", d.accent, d.soft)}</div></div>
     <div style="position:absolute;left:0;width:${W}px;top:1530px;text-align:center;font:700 38px 'JetBrains Mono';color:rgba(245,245,247,0.75)">${esc(d.repo.fullName)}</div>`,
    `fit('#hero',1000,640,700,260);fit('.hl2',960,520,260,70);document.querySelectorAll('.hl2').forEach(function(e){e.style.textAlign='center'})`,
  );
}

function variant3(d: Data, words: string[]): string {
  const full = d.kind === "full";
  const font = full ? 34 : 50;
  const boxW = full ? 700 : 940;
  const cols = Math.floor((boxW - 6 - 60) / (font * 0.6)) - 1;
  const term = terminalLines(d, full ? 8 : 9, cols);
  const chip = d.tested ? "REAL OUTPUT" : "NOT RUN";
  const lines = term.lines.map((l) => `<div style="white-space:pre;overflow:hidden;color:${l.key ? d.soft : "rgba(245,245,247,0.7)"};${l.key ? `font-weight:800;background:${rgba(d.accent, 0.2)};margin:0 -30px;padding:0 30px;border-left:6px solid ${d.accent}` : ""}">${esc(l.text)}</div>`).join("");
  const termBox = `<div style="width:${boxW}px;border-radius:26px;overflow:hidden;background:#06060a;border:3px solid rgba(255,255,255,0.18);box-shadow:0 0 150px ${rgba(d.accent, 0.45)},0 60px 100px rgba(0,0,0,0.8)">
    <div style="height:${full ? 56 : 70}px;display:flex;align-items:center;gap:10px;padding:0 24px;background:#12121a"><i style="width:16px;height:16px;border-radius:50%;background:#ff5f57"></i><i style="width:16px;height:16px;border-radius:50%;background:#febc2e"></i><i style="width:16px;height:16px;border-radius:50%;background:#28c840"></i></div>
    <div style="padding:26px 30px 30px;font:600 ${font}px/1.38 'JetBrains Mono'"><div style="white-space:pre;overflow:hidden;color:#fff;margin-bottom:10px"><span style="color:${d.accent}">$</span> ${esc(term.cmd)}</div>${lines}</div></div>`;
  const slab = `<div id="hl" style="display:inline-block;background:${d.accent};padding:${full ? "10px 34px 14px" : "14px 40px 18px"};transform:rotate(-2.5deg);box-shadow:0 20px 60px rgba(0,0,0,0.6)">${headlineLines(words).map((l) => `<div class="h hl3" style="color:#000;text-shadow:none;white-space:nowrap">${esc(l)}</div>`).join("")}</div>`;
  const chipEl = `<div style="display:inline-block;font:900 ${full ? 40 : 52}px Inter;color:#000;background:#fff;padding:12px 34px;border-radius:999px;box-shadow:0 0 50px rgba(255,255,255,0.35)">${chip}</div>`;
  if (full) {
    return page(
      d,
      `<div style="position:absolute;left:560px;top:150px;transform:rotate(2deg)">${termBox}</div>
       <div style="position:absolute;left:46px;top:46px;width:620px;height:300px;display:flex;align-items:flex-start">${slab}</div>
       <div style="position:absolute;left:60px;top:560px;display:flex;align-items:center;gap:18px">${chipEl}</div>`,
      "fit('.hl3',560,260,180,56)",
    );
  }
  return page(
    d,
    `<div style="position:absolute;left:70px;top:900px;transform:rotate(1.5deg)">${termBox}</div>
     <div style="position:absolute;left:60px;top:230px;width:960px;height:520px;display:flex;align-items:flex-start;justify-content:flex-start">${slab}</div>
     <div style="position:absolute;right:70px;top:790px">${chipEl}</div>`,
    "fit('.hl3',880,460,260,80)",
  );
}

function pickShot(ctx: RunCtx, scripts: Scripts): string | null {
  for (const kind of ["full", "short"] as const) {
    for (const s of scripts[kind].sections) {
      if (s.scene.kind !== "browser") continue;
      const sandbox = s.scene.shot.startsWith("t-");
      const file = ctx.path(sandbox ? "test/shots" : "shots", sandbox ? s.scene.shot.slice(2) : s.scene.shot);
      if (existsSync(file) && basename(file) === (sandbox ? s.scene.shot.slice(2) : s.scene.shot)) return pathToFileURL(file).href;
    }
  }
  for (const dir of ["shots", "test/shots"]) {
    const full = ctx.path(dir);
    if (!existsSync(full)) continue;
    const first = readdirSync(full).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()[0];
    if (first) return pathToFileURL(join(full, first)).href;
  }
  return null;
}

async function capture(browser: Browser, html: string, d: Data, out: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: d.W, height: d.H, deviceScaleFactor: 1 });
    const dir = mkdtempSync(join(tmpdir(), "testreel-thumb-"));
    const file = join(dir, "t.html");
    writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => window.__fitted);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())).then(() => undefined));
    for (let q = 92; q >= 50; q -= 6) {
      const bytes = await page.screenshot({ type: "jpeg", quality: q });
      if (bytes.byteLength < MAX_BYTES) {
        writeFileSync(`${out}.part`, bytes);
        renameSync(`${out}.part`, out);
        rmSync(dir, { recursive: true, force: true });
        return;
      }
    }
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`thumbnail ${basename(out)} stays above 2 MB even at quality 50`);
  } finally {
    await page.close();
  }
}

export const thumbnailsStage: Stage = async (ctx) => {
  const repo = readJson<RepoInfo>(ctx.path("repo.json"));
  const scripts = readJson<Scripts>(ctx.path("scripts.json"));
  const tested = ctx.run.mode === "test";
  const score = tested ? readJson<Score>(ctx.path("score.json")) : null;
  const log = tested ? readJson<TestLog>(ctx.path("test/log.json")) : null;
  const accent = accentFor(repo.fullName);
  const shot = pickShot(ctx, scripts);
  const browser = await puppeteer.launch({ executablePath: ctx.config.chrome, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"] });
  const kill = () => browser.process()?.kill();
  ctx.signal.addEventListener("abort", kill, { once: true });
  try {
    const kinds: VideoKind[] = ["full", "short"];
    for (const kind of kinds) {
      const script = scripts[kind];
      mkdirSync(ctx.path("final", kind), { recursive: true });
      const data: Data = { kind, ...SIZE[kind], accent, soft: lighten(accent, 0.38), repo, name: repo.fullName.split("/")[1] ?? repo.fullName, tested, score, steps: log?.steps ?? [], shot };
      const builders = [variant1, variant2, variant3];
      for (const [i, build] of builders.entries()) {
        if (ctx.signal.aborted) throw cancelled();
        const text = script.thumbnailTexts[i] ?? script.thumbnailTexts[0];
        if (!text) throw new Error(`the ${kind} script has no thumbnailTexts`);
        ctx.emit({ kind: "progress", stage: "thumbnails", video: kind, pct: Math.round((i / 3) * 100), label: `Thumbnail ${i + 1} of 3` });
        await capture(browser, build(data, text.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 4)), data, ctx.path("final", kind, `thumb-${i + 1}.jpg`));
      }
      ctx.emit({ kind: "progress", stage: "thumbnails", video: kind, pct: 100, label: "Thumbnails ready" });
      ctx.emit({ kind: "artifact", name: "thumbnails", video: kind });
    }
  } catch (e) {
    throw ctx.signal.aborted ? cancelled() : e;
  } finally {
    ctx.signal.removeEventListener("abort", kill);
    await browser.close().catch(kill);
  }
};
