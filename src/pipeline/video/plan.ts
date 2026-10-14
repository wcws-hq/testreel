// The render plan: everything the in-page runtime needs, resolved to absolute timeline seconds.
// Built once per video from the run's JSON files; the page never reads files and never decides timing on its own.
import { hashString, need, rng } from "./runtime/ease.ts";
import { FOOTAGE_LEAD, footageFrameUrl } from "./runtime/times.ts";
import { MAX_FULL_SECONDS, MAX_SHORT_SECONDS, TIMELINE } from "../../shared/types.ts";
import type { RepoInfo, Scene, Score, Script, TestLog, TestStep, Timings, VideoKind } from "../../shared/types.ts";

export const FPS = 30;

export type TransitionType = "whip" | "zoom" | "wipe" | "push" | "iris" | "glitch" | "blur";
export const TRANSITION_SECONDS: Record<TransitionType, number> = { whip: 0.5, zoom: 0.55, wipe: 0.55, push: 0.55, iris: 0.6, glitch: 0.4, blur: 0.5 };

// Six vivid accents that read well on black. Green, amber and red are deliberately absent: they belong to verdicts.
const ACCENTS = ["#4C8DFF", "#7B7BFF", "#A66BFF", "#E85CF0", "#FF5FAE", "#22D3EE"];

export function accentFor(fullName: string): string {
  return need(ACCENTS[hashString(fullName.toLowerCase()) % ACCENTS.length]);
}

export interface PlanWord { w: string; s: number; e: number }
// Where the camera looks while the recording plays: t = seconds into the recording, u/v = focus point (0..1), z = extra zoom (1 = fit the crop).
export interface FocusKey { t: number; u: number; v: number; z: number }
// The part of the recording picture that is the app itself (normalized 0..1), found by comparing against the page background.
export interface Crop { x: number; y: number; w: number; h: number }
export type FootageScene = { kind: "footage"; dir: string; frames: number; secs: number; address: string; label?: string; focus: FocusKey[]; crop: Crop };
export type ResolvedScene =
  | Exclude<Scene, { kind: "terminal" } | { kind: "browser" } | { kind: "footage" }>
  | { kind: "terminal"; steps: TestStep[] }
  | { kind: "browser"; src: string; address: string; caption?: string; focus: "top" | "middle" | "bottom" }
  | FootageScene;

export interface PlanLayer {
  id: string;
  title: string;
  kind: ResolvedScene["kind"] | "intro" | "outro";
  scene: ResolvedScene | null;
  start: number; // timeline second where local time 0 begins (the incoming transition starts here)
  end: number; // start of the next layer, or the end of the video
  preroll: number; // seconds added to local time so the scene is already animating while the transition reveals it
  speechStart: number;
  speechEnd: number;
  words: PlanWord[];
  trans: { type: TransitionType; dur: number } | null;
  callout: { text: string; start: number; end: number } | null;
}

export interface PlanChapter { title: string; start: number; end: number }

export interface VideoPlan {
  kind: VideoKind;
  W: number;
  H: number;
  fps: number;
  total: number;
  accent: string;
  tested: boolean;
  channel: string;
  repo: {
    fullName: string; owner: string; name: string; url: string; description: string; stars: number; forks: number; openIssues: number;
    language: string | null; license: string | null; topics: string[]; updated: string; readme: string[];
  };
  score: Score | null;
  layers: PlanLayer[];
  chapters: PlanChapter[];
  lowerThird: { start: number; end: number };
  tickerStart: number;
  tickerEnd: number;
  images: string[]; // asset urls (relative to the page) to decode before the first frame, plus the first frame of every footage scene
}

// A file the page needs next to it: the url the plan uses and where the bytes live.
export interface PlanAsset { url: string; file: string }
// A recording the engine decodes into frames before rendering. `scene.frames` is the most frames the scene can show; the
// engine sets it to what was actually decoded.
export interface PlanFootage { scene: FootageScene; file: string }

export interface PlanInput {
  kind: VideoKind;
  script: Script;
  timings: Timings;
  voiceSeconds: number;
  repo: RepoInfo;
  score: Score | null;
  log: TestLog | null;
  channel: string;
  testedMode: boolean;
  resolveShot: (shot: string) => string; // absolute file path, or throws when the file is missing
  resolveFootage: (recording: string) => { file: string; secs: number; focus: FocusKey[]; crop: Crop }; // absolute file path and measured facts, or throws when the recording is missing
  appAddress: string | null; // where the tested app listens (e.g. localhost:18000/), null for command line tools
}

// Scenes start animating this long before their layer starts being visible, so a transition never reveals an empty scene.
const PREROLL = 0.35;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function relativeDate(iso: string): string {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  if (Number.isNaN(days)) return "";
  if (days < 1) return "updated today";
  if (days < 45) return `updated ${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 700) return `updated ${Math.round(days / 30)} months ago`;
  return `updated ${Math.round(days / 365)} years ago`;
}

function readmeLines(readme: string): string[] {
  return readme
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((l) => l.replace(/^\s*```.*$/, "").replace(/[*_`]/g, "").trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(0, 60)
    .map((l) => (l.length > 96 ? `${l.slice(0, 95)}...` : l));
}

function pickTransition(next: PlanLayer["kind"], index: number, seed: number, last: TransitionType | null): TransitionType {
  if (next === "verdict") return "zoom";
  if (next === "outro") return "wipe";
  if (next === "terminal") return "glitch";
  if (next === "cta") return "blur";
  const options = (["whip", "wipe", "push", "iris", "zoom", "blur"] as const).filter((t) => t !== last);
  return need(options[Math.floor(rng(seed + index * 7919)() * options.length)]);
}

function findCallout(text: string, words: PlanWord[]): { start: number; end: number } | null {
  const target = text.split(/\s+/).map(norm).filter(Boolean);
  if (!target.length) return null;
  const spoken = words.map((w) => norm(w.w));
  for (let i = 0; i + target.length <= spoken.length; i++) {
    if (target.every((t, k) => spoken[i + k] === t)) {
      const first = need(words[i]);
      const last = need(words[i + target.length - 1]);
      return { start: first.s - 0.1, end: Math.max(last.e + 1.4, first.s + 2.4) };
    }
  }
  return null;
}

export function buildPlan(input: PlanInput): { plan: VideoPlan; assets: PlanAsset[]; footage: PlanFootage[] } {
  const { kind, script, timings, repo, score, log } = input;
  const short = kind === "short";
  const tl = TIMELINE[kind];
  const total = tl.intro + input.voiceSeconds + tl.tail + tl.outro;
  const max = kind === "full" ? MAX_FULL_SECONDS : MAX_SHORT_SECONDS;
  if (total > max) throw new Error(`${kind} video would run ${total.toFixed(1)} s, over the ${max} s limit`);
  if (timings.sections.length !== script.sections.length) throw new Error(`timings.json has ${timings.sections.length} sections but the ${kind} script has ${script.sections.length}`);

  const seed = hashString(repo.fullName.toLowerCase());
  const voiceEnd = tl.intro + input.voiceSeconds;
  const abs = (w: { w: string; s: number; e: number }): PlanWord => ({ w: w.w, s: w.s + tl.intro, e: w.e + tl.intro });
  const layers: PlanLayer[] = [];
  const assets = new Map<string, PlanAsset>();

  if (tl.intro > 0) {
    layers.push({ id: "intro", title: "Intro", kind: "intro", scene: null, start: 0, end: tl.intro, preroll: 0.1, speechStart: 0, speechEnd: 0, words: [], trans: null, callout: null });
  }

  let lastTrans: TransitionType | null = null;
  const footage: PlanFootage[] = [];
  script.sections.forEach((section, i) => {
    const timing = need(timings.sections[i], `timings for section ${section.id}`);
    const words = timing.words.map(abs);
    const speechStart = timing.speechStart + tl.intro;
    const prev = layers.at(-1);
    let scene: ResolvedScene;
    const raw = section.scene;
    if (raw.kind === "browser") {
      let asset = assets.get(raw.shot);
      if (!asset) {
        asset = { url: `assets/${assets.size}-${raw.shot.replace(/[^\w.-]/g, "_")}`, file: input.resolveShot(raw.shot) };
        assets.set(raw.shot, asset);
      }
      const url = asset.url;
      const testShot = raw.shot.startsWith("t-") ? log?.shots.find((s) => s.file === raw.shot.slice(2)) : undefined;
      scene = { kind: "browser", src: url, address: testShot?.url || repo.fullName, focus: raw.focus ?? "top", ...(raw.caption ? { caption: raw.caption } : {}) };
    } else if (raw.kind === "footage") {
      const rec = input.resolveFootage(raw.recording);
      const clip: FootageScene = { kind: "footage", dir: `footage/${section.id}`, frames: 0, secs: rec.secs, address: input.appAddress ?? repo.fullName, focus: rec.focus, crop: rec.crop, ...(raw.caption ? { label: raw.caption } : {}) };
      footage.push({ scene: clip, file: rec.file });
      scene = clip;
    } else if (raw.kind === "terminal") {
      const steps = raw.steps.map((n) => log?.steps.find((s) => s.n === n)).filter((s): s is TestStep => !!s);
      if (!steps.length) throw new Error(`section ${section.id}: terminal scene refers to steps that are not in test/log.json (${raw.steps.join(", ")})`);
      scene = { kind: "terminal", steps };
    } else {
      if ((raw.kind === "scorecard" || raw.kind === "verdict") && !score) throw new Error(`section ${section.id}: ${raw.kind} scene needs score.json`);
      scene = raw;
    }

    let trans: PlanLayer["trans"] = null;
    let start = 0;
    if (!prev) {
      start = 0;
    } else {
      const type = pickTransition(scene.kind, i, seed, lastTrans);
      const dur = TRANSITION_SECONDS[type];
      if (prev.kind === "intro") {
        trans = { type: "zoom", dur: TRANSITION_SECONDS.zoom };
        start = tl.intro - trans.dur / 2;
      } else {
        trans = { type, dur };
        start = Math.max(speechStart - 0.3 - dur / 2, prev.start + 1.2);
      }
      lastTrans = trans.type;
      prev.end = start;
    }
    const callout = section.callout ? findCallout(section.callout, words) : null;
    layers.push({
      id: section.id,
      title: section.title,
      kind: scene.kind,
      scene,
      start,
      end: total,
      preroll: PREROLL,
      speechStart,
      speechEnd: timing.speechEnd + tl.intro,
      words,
      trans,
      callout: callout && section.callout ? { text: section.callout, ...callout } : null,
    });
  });

  if (tl.outro > 0) {
    const last = need(layers.at(-1));
    const dur = TRANSITION_SECONDS.wipe;
    const start = Math.max(last.start + 1.2, voiceEnd + 0.3);
    last.end = start;
    layers.push({ id: "outro", title: "Outro", kind: "outro", scene: null, start, end: total, preroll: PREROLL, speechStart: start, speechEnd: start, words: [], trans: { type: "wipe", dur }, callout: null });
  }

  // The scene never needs more frames than it shows; a shorter recording ends early and its last frame is held.
  for (const l of layers) {
    if (l.scene?.kind !== "footage") continue;
    const shown = Math.ceil((l.end - l.start + l.preroll - FOOTAGE_LEAD) * FPS);
    l.scene.frames = Math.max(1, Math.min(Math.floor(l.scene.secs * FPS), shown));
  }

  const first = need(layers.find((l) => l.scene));
  const firstCut = first.start + (first.trans?.dur ?? 0) / 2;
  const content = layers.filter((l) => l.scene);
  const chapters: PlanChapter[] = content.map((l, i) => {
    const next = content[i + 1];
    return { title: l.title, start: l.start + (l.trans?.dur ?? 0) / 2, end: next ? next.start + (next.trans?.dur ?? 0) / 2 : voiceEnd + tl.tail };
  });

  const [owner = "", name = repo.fullName] = repo.fullName.split("/");

  const plan: VideoPlan = {
    kind,
    W: short ? 1080 : 1920,
    H: short ? 1920 : 1080,
    fps: FPS,
    total,
    accent: accentFor(repo.fullName),
    tested: input.testedMode,
    channel: input.channel,
    repo: {
      fullName: repo.fullName, owner, name, url: repo.url, description: repo.description, stars: repo.stars, forks: repo.forks, openIssues: repo.openIssues,
      language: repo.language, license: repo.license, topics: repo.topics.slice(0, 5), updated: relativeDate(repo.pushedAt), readme: readmeLines(repo.readme),
    },
    score,
    layers,
    chapters,
    lowerThird: short ? { start: 0.9, end: 4.9 } : { start: firstCut + 0.9, end: firstCut + 6 },
    tickerStart: firstCut + 0.4,
    tickerEnd: tl.outro > 0 ? need(layers.at(-1)).start : total,
    images: [...assets.values()].map((a) => a.url).concat(footage.map((f) => footageFrameUrl(f.scene.dir, 0))),
  };
  return { plan, assets: [...assets.values()], footage };
}
