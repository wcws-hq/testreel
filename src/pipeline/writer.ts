// Stage "script": asks the gateway for the long script and the Short, checks both in code and sends every
// problem back to the model until the script is clean. Nothing is written unless both scripts pass.
import { existsSync, readdirSync } from "node:fs";
import { chat, parseJsonObject, readJson, writeJson } from "./ctx.ts";
import type { RunCtx, Stage } from "./ctx.ts";
import { gapAfter, leadIn } from "./voice.ts";
import type { Mode, RepoInfo, Scene, Score, Script, Scripts, Section, TestLog, Triage, VideoKind } from "../shared/types.ts";

const WORDS_PER_SEC = 2.6;
const PAUSE_SEC = 0.7;
const BEAT_SEC = 0.35;
const MAX_RETRIES = 3;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MARKER = /\s*\[(pause|beat)\]\s*/gi;

interface Limits { words: [number, number]; sections: [number, number]; maxEstimate: number; sectionWords: [number, number] }
const LIMITS: Record<VideoKind, Limits> = {
  full: { words: [950, 1300], sections: [11, 16], maxEstimate: 560, sectionWords: [18, 170] },
  short: { words: [110, 135], sections: [5, 7], maxEstimate: 55, sectionWords: [8, 40] },
};

interface Material {
  mode: Mode;
  repo: RepoInfo;
  log?: TestLog;
  score?: Score;
  pageShots: string[];
  sandboxShots: string[];
  triage?: Triage;
}

function listImages(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => IMAGE.test(f)).sort() : [];
}

function loadMaterial(ctx: RunCtx): Material {
  const log = ctx.path("test/log.json");
  const score = ctx.path("score.json");
  const triage = ctx.path("triage.json");
  const m: Material = {
    mode: ctx.run.mode,
    repo: readJson<RepoInfo>(ctx.path("repo.json")),
    pageShots: listImages(ctx.path("shots")),
    sandboxShots: listImages(ctx.path("test/shots")).map((f) => `t-${f}`),
  };
  if (m.mode === "test") {
    if (!existsSync(log) || !existsSync(score) || !existsSync(triage)) throw new Error("Test mode needs triage.json, test/log.json and score.json before the script can be written");
    m.log = readJson<TestLog>(log);
    m.score = readJson<Score>(score);
    m.triage = readJson<Triage>(triage);
  }
  return m;
}

// ---- text helpers ----

function spokenWords(text: string): string[] {
  return text.replace(MARKER, " ").split(/\s+/).filter(Boolean);
}

function speechSeconds(voiceover: string): number {
  const pauses = voiceover.match(/\[pause\]/gi)?.length ?? 0;
  const beats = voiceover.match(/\[beat\]/gi)?.length ?? 0;
  return spokenWords(voiceover).length / WORDS_PER_SEC + pauses * PAUSE_SEC + beats * BEAT_SEC;
}

function estimateSeconds(kind: VideoKind, sections: Pick<Section, "voiceover" | "scene">[]): number {
  let t = leadIn(kind);
  sections.forEach((s, i) => {
    t += speechSeconds(s.voiceover);
    if (i < sections.length - 1) t += gapAfter(kind, sections, i);
  });
  return t;
}

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim();

function asString(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u2014\u2013]/g, ", ").replace(/\s+/g, " ").trim() : "";
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString).filter(Boolean) : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---- numbers that may be spoken or shown ----

const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?(?!\w|\.\d)/g;
const FREE_UP_TO = 5;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
}

function buildFacts(m: Material): number[] {
  const { readme: _readme, ...repoFacts } = m.repo;
  const corpus = [JSON.stringify(repoFacts), m.repo.readme];
  const facts: number[] = [];
  if (m.log && m.score) {
    corpus.push(JSON.stringify(m.log), JSON.stringify(m.score), JSON.stringify(m.triage));
    facts.push(m.log.totalSecs, m.log.totalSecs / 60, m.log.steps.length, m.log.shots.length, m.log.recordings.length, m.log.metrics.length);
    const passed = m.log.steps.filter((s) => s.exit === 0).length;
    facts.push(passed, m.log.steps.length - passed);
    for (const s of m.log.steps) facts.push(s.secs, s.n);
    facts.push(m.log.steps.reduce((a, s) => a + s.secs, 0), 10);
  }
  for (const c of corpus) facts.push(...numbersIn(c));
  return facts;
}

function isGrounded(n: number, facts: number[]): boolean {
  if (Number.isInteger(n) && n >= 0 && n <= FREE_UP_TO) return true;
  return facts.some((f) => {
    const forms = [f, Math.round(f), Math.floor(f), Math.round(f * 10) / 10];
    if (f >= 1000) forms.push(Math.round(f / 1000), Math.floor(f / 1000), Math.round(f / 100) / 10, Math.floor(f / 100) / 10);
    if (f >= 1_000_000) forms.push(Math.round(f / 1_000_000), Math.round(f / 100_000) / 10);
    return forms.some((x) => Math.abs(x - n) < 1e-9);
  });
}

// ---- validation ----

const SCENES_TEST = ["hook", "repo", "browser", "footage", "terminal", "stats", "bars", "points", "quote", "scorecard", "verdict", "cta"];
const SCENES_EXPLAIN = ["hook", "repo", "browser", "stats", "points", "quote", "cta"];
const HYPE = /you won'?t believe|shocking|mind[- ]?blowing|insane|game[- ]?changer|guarantee|get rich|miracle|secret they/i;
const NOT_TESTED = /\b(?:not|n'?t|never)\s+(?:been\s+)?(?:tested|run|tried|try|test|installed)\b|\buntested\b/i;
const TESTED_CLAIM = /\b(?:tested|tried|ran|benchmark(?:ed)?|hands-on|verdict|scorecard|installed it)\b/i;
const FIRST_PERSON = /\bI\b|\bI['\u2019](?:m|ve|d|ll)\b|\b[Mm]y\b|\b[Mm]e\b|\bmyself\b/;
const FIRST_CLAUSE_END = /[.!?,;:]|\[(?:pause|beat)\]/;

const SUBTITLES = /\b(?:captions?|subtitles?)\b/i;
const UNMEASURED_CLAIMS: Record<string, RegExp> = {
  tests: /\btests? (?:pass|passed|passing|failed|failing)\b|\ball (?:the )?tests\b|\btest suite\b/i,
  audit: /\bvulnerabilit\w*|\bnpm audit\b|\bsecurity audit\b/i,
  memory: /\bmemory (?:use|usage|footprint)\b|\bmegabytes of (?:memory|ram)\b/i,
};

class Errors {
  readonly list: string[] = [];
  add(where: string, msg: string): void {
    this.list.push(`${where}: ${msg}`);
  }
}

function checkNumbers(text: string, where: string, facts: number[], errs: Errors): void {
  for (const n of numbersIn(text)) {
    if (!isGrounded(n, facts)) errs.add(where, `the number ${n} is not in the repo, log or score data. Use only numbers from the material`);
  }
}

function readScene(raw: unknown, where: string, m: Material, facts: number[], errs: Errors): Scene | null {
  if (!isRecord(raw)) {
    errs.add(where, "scene must be an object with a kind");
    return null;
  }
  const kind = asString(raw.kind);
  const allowed = m.mode === "test" ? SCENES_TEST : SCENES_EXPLAIN;
  if (!allowed.includes(kind)) {
    errs.add(where, `scene kind "${kind}" is not allowed in ${m.mode} mode. Allowed: ${allowed.join(", ")}`);
    return null;
  }
  switch (kind) {
    case "repo":
    case "scorecard":
    case "verdict":
    case "cta":
      return { kind };
    case "hook": {
      const lines = asStringList(raw.lines);
      if (lines.length < 1 || lines.length > 3) errs.add(where, "hook needs 1 to 3 lines");
      if (lines.some((l) => l.length > 36)) errs.add(where, "hook lines must be at most 36 characters each");
      return { kind, lines };
    }
    case "browser": {
      const shot = asString(raw.shot);
      if (!m.pageShots.includes(shot) && !m.sandboxShots.includes(shot)) {
        const have = [...m.pageShots, ...m.sandboxShots];
        errs.add(where, `shot "${shot}" does not exist. Available: ${have.length ? have.join(", ") : "none (do not use browser scenes)"}`);
      }
      const scene: Scene = { kind, shot };
      const caption = asString(raw.caption);
      if (caption.length > 90) errs.add(where, "browser caption must be at most 90 characters");
      if (caption) scene.caption = caption;
      if (raw.focus !== undefined) {
        if (raw.focus === "top" || raw.focus === "middle" || raw.focus === "bottom") scene.focus = raw.focus;
        else errs.add(where, 'browser focus must be "top", "middle" or "bottom"');
      }
      return scene;
    }
    case "footage": {
      const recording = asString(raw.recording);
      const have = (m.log?.recordings ?? []).map((r) => r.file);
      if (!have.includes(recording)) errs.add(where, `recording "${recording}" does not exist. Available: ${have.length ? have.join(", ") : "none (do not use footage scenes)"}`);
      const scene: Scene = { kind, recording };
      const caption = asString(raw.caption);
      if (caption.length > 60) errs.add(where, "footage caption must be at most 60 characters");
      if (caption) scene.caption = caption;
      return scene;
    }
    case "terminal": {
      const steps = Array.isArray(raw.steps) ? raw.steps.filter((n): n is number => typeof n === "number") : [];
      const known = new Set((m.log?.steps ?? []).map((s) => s.n));
      if (steps.length < 1 || steps.length > 3) errs.add(where, "terminal needs 1 to 3 step numbers");
      for (const n of steps) if (!known.has(n)) errs.add(where, `terminal step ${n} is not in the log. Real steps: ${[...known].join(", ")}`);
      return { kind, steps };
    }
    case "stats": {
      const items = Array.isArray(raw.items) ? raw.items.filter(isRecord) : [];
      if (items.length < 2 || items.length > 4) errs.add(where, "stats needs 2 to 4 items");
      const out: { label: string; value: number | string; suffix?: string }[] = [];
      for (const it of items) {
        const label = asString(it.label);
        const value = typeof it.value === "number" ? it.value : asString(it.value);
        if (!label || label.length > 24 || value === "") errs.add(where, "each stat needs a label of at most 24 characters and a value");
        checkNumbers(String(value), `${where} stat "${label}"`, facts, errs);
        const item: { label: string; value: number | string; suffix?: string } = { label, value };
        const suffix = asString(it.suffix);
        if (suffix) item.suffix = suffix;
        out.push(item);
      }
      return { kind, items: out };
    }
    case "bars": {
      const title = asString(raw.title);
      const items = Array.isArray(raw.items) ? raw.items.filter(isRecord) : [];
      if (!title) errs.add(where, "bars needs a title");
      if (items.length < 2 || items.length > 6) errs.add(where, "bars needs 2 to 6 items");
      const measured = [m.log?.totalSecs ?? 0, ...(m.log?.steps.map((s) => s.secs) ?? []), ...(m.log?.metrics.flatMap((x) => (typeof x.value === "number" ? [x.value] : [])) ?? [])];
      const out: { label: string; value: number; max?: number; unit?: string }[] = [];
      for (const it of items) {
        const label = asString(it.label);
        const value = typeof it.value === "number" ? it.value : Number.NaN;
        if (!label || !(value > 0)) errs.add(where, "each bar needs a label and a value above 0");
        else if (!measured.some((s) => Math.abs(s - value) <= 0.06)) errs.add(where, `bar "${label}" value ${value} is not a measured metric value, a step duration or the total from the log`);
        const item: { label: string; value: number; max?: number; unit?: string } = { label, value };
        if (typeof it.max === "number" && it.max > 0) item.max = it.max;
        const unit = asString(it.unit);
        if (unit) item.unit = unit;
        out.push(item);
      }
      return { kind, title, items: out };
    }
    case "points": {
      const title = asString(raw.title);
      const items = asStringList(raw.items);
      if (!title) errs.add(where, "points needs a title");
      if (items.length < 2 || items.length > 5) errs.add(where, "points needs 2 to 5 items");
      if (items.some((i) => i.length > 90)) errs.add(where, "each point must be at most 90 characters");
      checkNumbers(items.join(" "), where, facts, errs);
      return { kind, title, items };
    }
    default: {
      const text = asString(raw.text);
      if (!text || text.length > 160) errs.add(where, "quote needs text of at most 160 characters");
      const scene: Scene = { kind: "quote", text };
      const attribution = asString(raw.attribution);
      if (attribution) scene.attribution = attribution;
      return scene;
    }
  }
}

function readSection(raw: unknown, i: number, kind: VideoKind, m: Material, facts: number[], errs: Errors): Section | null {
  const where = `section ${i + 1}`;
  if (!isRecord(raw)) {
    errs.add(where, "must be an object");
    return null;
  }
  const id = asString(raw.id);
  const title = asString(raw.title);
  const voiceover = asString(raw.voiceover).replace(/^(?:\s*\[(?:pause|beat)\])+|(?:\[(?:pause|beat)\]\s*)+$/gi, "").trim();
  if (!id) errs.add(where, "missing id");
  if (!title || title.length > 40) errs.add(where, "title is required and must be at most 40 characters");
  if (/[\[\]]/.test(voiceover.replace(MARKER, " "))) errs.add(where, "voiceover may only contain the markers [pause] and [beat] in square brackets");
  if (/[`*_#<>{}|\\]|https?:\/\/|www\./i.test(voiceover.replace(MARKER, " "))) errs.add(where, "voiceover must be plain speech: no URLs, code, markdown or symbols like ` * _ # < >");
  const words = spokenWords(voiceover).length;
  const [lo, hi] = LIMITS[kind].sectionWords;
  if (words < lo || words > hi) errs.add(where, `voiceover has ${words} words, it must have ${lo} to ${hi}`);
  if (!/[.!?]["')\u201d]?$/.test(voiceover)) errs.add(where, "every voiceover must end with a complete sentence (a full stop, question mark or exclamation mark)");
  checkNumbers(voiceover, where, facts, errs);
  if (/\bstep (?:\d+|one|two|three)\b|\b(?:the|this|a) (?:test )?log\b/i.test(voiceover)) errs.add(where, "do not mention step numbers or the log, viewers cannot see them. Describe what the command did");
  const scene = readScene(raw.scene, `${where} scene`, m, facts, errs);
  if (!scene) return null;
  const section: Section = { id, title, voice: "A", voiceover, scene };
  const callout = asString(raw.callout);
  if (callout) {
    if (callout.length > 30) errs.add(where, "callout must be at most 30 characters");
    if (!` ${plain(voiceover.replace(MARKER, " "))} `.includes(` ${plain(callout)} `)) errs.add(where, `callout "${callout}" must appear word for word in the voiceover`);
    checkNumbers(callout, `${where} callout`, facts, errs);
    section.callout = callout;
  }
  return section;
}

function readSections(raw: unknown, kind: VideoKind, m: Material, facts: number[], errs: Errors): Section[] {
  const list = Array.isArray(raw) ? raw : [];
  const [min, max] = m.mode === "explain" && kind === "full" ? [9, LIMITS.full.sections[1]] : LIMITS[kind].sections;
  if (list.length < min || list.length > max) errs.add("sections", `${list.length} sections, it must be ${min} to ${max}`);
  const sections = list.map((s, i) => readSection(s, i, kind, m, facts, errs)).filter((s): s is Section => s !== null);
  const ids = sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errs.add("sections", "section ids must be unique");
  return sections;
}

function checkStructure(sections: Section[], kind: VideoKind, m: Material, errs: Errors): void {
  const kinds = sections.map((s) => s.scene.kind);
  if (kinds[0] !== "hook") errs.add("section 1", "the first scene must be a hook");
  if (kind === "full") {
    if (kinds[kinds.length - 1] !== "cta") errs.add("last section", "the last scene must be cta");
    if (!kinds.includes("repo")) errs.add("sections", "the script needs a repo scene for the repo intro");
  }
  if (m.mode === "test") {
    if (kind === "full") {
      if (!kinds.includes("scorecard")) errs.add("sections", "a full test script needs a scorecard scene");
      if (kinds.filter((k) => k === "terminal").length < 1) errs.add("sections", "a full test script needs a terminal scene for the real deploy commands");
      if (!kinds.includes("bars")) errs.add("sections", "a full test script needs a bars scene built from measured values");
    }
    const recs = m.log?.recordings ?? [];
    const used = sections.flatMap((s) => (s.scene.kind === "footage" ? [s.scene.recording] : []));
    const reused = [...new Set(used.filter((r, i) => used.indexOf(r) !== i))];
    if (reused.length) errs.add("footage scenes", `recording ${reused.join(", ")} is used in more than one scene. Use each recording in only one scene`);
    if (kind === "short" ? used.length !== Math.min(1, recs.length) : used.length < Math.min(2, recs.length)) {
      errs.add("footage scenes", kind === "short" ? "a Short needs exactly one footage scene with the most compelling recording (none if there are no recordings)" : "the full script must use the recordings in footage scenes, at least 2 when there are that many");
    }
    if (kind === "full") {
      for (const s of sections) {
        if (s.scene.kind !== "footage") continue;
        const file = s.scene.recording;
        const rec = recs.find((r) => r.file === file);
        if (!rec) continue;
        const est = speechSeconds(s.voiceover);
        const lo = Math.round(rec.secs * 0.6 * WORDS_PER_SEC);
        const hi = Math.round(Math.max(rec.secs * 1.5, 10) * WORDS_PER_SEC);
        if (est < rec.secs * 0.6) errs.add(`section "${s.title}"`, `the narration is about ${est.toFixed(0)} s but the recording ${file} runs ${rec.secs} s. Write at least ${lo} words describing what is visibly happening`);
        else if (est > Math.max(rec.secs * 1.5, 10)) errs.add(`section "${s.title}"`, `the narration is about ${est.toFixed(0)} s but the recording ${file} runs only ${rec.secs} s. Write at most ${hi} words`);
      }
    }
    if (!kinds.includes("verdict")) errs.add("sections", "a test script needs a verdict scene");
    const steps = sections.flatMap((s) => (s.scene.kind === "terminal" ? s.scene.steps : []));
    const repeated = [...new Set(steps.filter((n, i) => steps.indexOf(n) !== i))];
    if (repeated.length) errs.add("terminal scenes", `step ${repeated.join(", ")} is used in more than one terminal scene. Use each step in only one scene`);
    for (const s of sections) {
      if (s.scene.kind === "scorecard" && !["works", "quality", "effort", "speed"].every((w) => s.voiceover.toLowerCase().includes(w))) {
        errs.add(`section "${s.title}"`, "a scorecard scene must be narrated by reading the four scores: works, quality, effort and speed");
      }
      if (s.scene.kind === "verdict" && m.score && !new RegExp(`\\b${m.score.verdict}\\b`, "i").test(s.voiceover)) {
        errs.add(`section "${s.title}"`, `a verdict scene must say the verdict word ${m.score.verdict}`);
      }
    }
  } else {
    for (const bad of ["footage", "terminal", "scorecard", "verdict"]) if (kinds.includes(bad as Scene["kind"])) errs.add("sections", `explain mode must not use a ${bad} scene`);
  }
  if (kind === "short") {
    const n = spokenWords((sections[0]?.voiceover ?? "").split(FIRST_CLAUSE_END)[0] ?? "").length;
    if (n > 7) errs.add("section 1", `the first phrase has ${n} words. A Short hook must land in the first 2 seconds, so the first phrase (up to the first comma, full stop or marker) must be 7 words or fewer`);
  }
}

function checkHonesty(script: Script, sections: Section[], kind: VideoKind, m: Material, errs: Errors): void {
  const spoken = sections.map((s) => s.voiceover).join(" ");
  if (FIRST_PERSON.test(JSON.stringify(script))) errs.add("script", "do not write in the first person (I, me, my) in the titles, description or voiceover. Say we, or talk about the video or the project");
  const aboutCaptions = SUBTITLES.test(`${m.repo.fullName} ${m.repo.description}`);
  if (!aboutCaptions) {
    const texts: string[] = [];
    JSON.stringify(sections.map((s) => [s.voiceover, s.callout, s.scene]), (_k, v: unknown) => (typeof v === "string" ? (texts.push(v), v) : v));
    const hit = texts.join("\n").match(SUBTITLES);
    if (hit) errs.add("script", `never mention captions or subtitles ("${hit[0]}"), the platform adds them`);
  }
  if (m.mode === "explain") {
    if (!NOT_TESTED.test(spoken)) errs.add("voiceover", "explain mode must say plainly that the project was not tested for this video");
    const claims = JSON.stringify(script).replace(/battle[- ]tested|\b(?:not|never|n'?t)\s+(?:been\s+)?(?:tested|run|tried)\b|\buntested\b/gi, " ").match(TESTED_CLAIM);
    if (claims) errs.add("script", `explain mode must never claim testing, but the text contains "${claims[0]}"`);
  } else {
    for (const [id, re] of Object.entries(UNMEASURED_CLAIMS)) {
      if (!(m.log?.metrics ?? []).some((x) => x.id === id) && re.test(spoken)) errs.add("voiceover", `the narration talks about ${id} results but no ${id} metric was measured. Say it was not measured instead, or remove it`);
    }
    if (kind === "full" && !(/container/i.test(spoken) && /automated|agent/i.test(spoken))) {
      errs.add("voiceover", "the full script must say once, plainly, that an automated agent ran the test in a fresh throwaway container");
    }
  }
}

function checkMetadata(raw: Record<string, unknown>, m: Material, errs: Errors): Omit<Script, "type" | "sections"> {
  const titles = asStringList(raw.titles);
  if (titles.length !== 3 || new Set(titles).size !== 3) errs.add("titles", "give exactly 3 different titles");
  for (const t of titles) {
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (t.length > 70) errs.add("titles", `"${t}" is ${t.length} characters, the limit is 70`);
    if (/\p{Extended_Pictographic}/u.test(t)) errs.add("titles", `"${t}" contains an emoji`);
    if (letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.4) errs.add("titles", `"${t}" has too many capital letters`);
    if (HYPE.test(t)) errs.add("titles", `"${t}" uses clickbait wording`);
  }
  const thumbs = asStringList(raw.thumbnailTexts).map((t) => t.toUpperCase());
  if (thumbs.length !== 3) errs.add("thumbnailTexts", "give exactly 3 options");
  for (const t of thumbs) {
    if (t.length > 20 || t.split(/\s+/).length > 4) errs.add("thumbnailTexts", `"${t}" must be 1 to 4 words and at most 20 characters`);
    if (HYPE.test(t)) errs.add("thumbnailTexts", `"${t}" uses clickbait wording`);
  }
  const description = typeof raw.description === "string" ? raw.description.replace(/[\u2014\u2013]/g, ", ").replace(/[ \t]+\n/g, "\n").trim() : "";
  const lines = description.split("\n").map((l) => l.trim());
  if (!lines[0] || !lines[1] || lines[0].length > 120 || lines[1].length > 120) errs.add("description", "the first two lines are the hook shown before 'show more'. Write two non-empty lines of at most 120 characters, then a blank line");
  if (!description.toLowerCase().includes(m.repo.url.toLowerCase())) errs.add("description", `it must list the repo link ${m.repo.url}`);
  if (m.repo.homepage && !description.includes(m.repo.homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""))) errs.add("description", `it must list the homepage ${m.repo.homepage}`);
  if (/#\w/.test(description)) errs.add("description", "no hashtags in the description, they are added later");
  if (/^\s*\d{1,2}:\d{2}/m.test(description)) errs.add("description", "no chapter timestamps, they are added later");
  if (description.length > 3500) errs.add("description", "keep it under 3500 characters");
  const tags = [...new Set(asStringList(raw.tags).map((t) => t.replace(/[<>,]/g, "")))];
  const tagChars = tags.reduce((a, t) => a + t.length + 1, 0);
  if (tags.length < 8) errs.add("tags", "give at least 8 relevant tags");
  if (tagChars > 450) errs.add("tags", `the tags total ${tagChars} characters, the limit is 450`);
  const hashtags = asStringList(raw.hashtags).map((h) => `#${h.replace(/[^A-Za-z0-9_]/g, "")}`);
  if (hashtags.length !== 3 || hashtags.some((h) => h.length < 3)) errs.add("hashtags", "give exactly 3 hashtags");
  const pinnedComment = asString(raw.pinnedComment);
  if (!pinnedComment.endsWith("?")) errs.add("pinnedComment", "write a question that invites replies");
  return { titles, description, tags, hashtags, thumbnailTexts: thumbs, pinnedComment };
}

function validate(reply: string, kind: VideoKind, m: Material, facts: number[]): Script | string[] {
  let raw: unknown;
  try {
    raw = parseJsonObject<unknown>(reply);
  } catch (e) {
    return [`the reply was not one valid JSON object (${e instanceof Error ? e.message : String(e)})`];
  }
  if (!isRecord(raw)) return ["the reply must be one JSON object"];
  const errs = new Errors();
  const meta = checkMetadata(raw, m, errs);
  const sections = readSections(raw.sections, kind, m, facts, errs);
  checkStructure(sections, kind, m, errs);
  const words = sections.reduce((a, s) => a + spokenWords(s.voiceover).length, 0);
  const [lo, hi] = LIMITS[kind].words;
  if (words < lo || words > hi) errs.add("length", `the voiceovers have ${words} words in total, they must have ${lo} to ${hi}`);
  const est = estimateSeconds(kind, sections);
  if (est > LIMITS[kind].maxEstimate) errs.add("length", `the estimated voice time is ${est.toFixed(0)} s, the limit is ${LIMITS[kind].maxEstimate} s. Cut words or [pause] markers`);
  const script: Script = { type: kind, ...meta, sections };
  checkHonesty(script, sections, kind, m, errs);
  return errs.list.length ? errs.list : script;
}

// ---- prompts ----

const VOICE_RULES = `Voice and wording:
- Write for the ear, like a clear, dry, specific YouTuber talking to one person. Short sentences mixed with a few longer ones, contractions, plain words.
- No hype words, no em-dashes, no emojis, no filler. Never say "game changer", "revolutionary" or "you won't believe".
- [pause] (0.7 s) goes after the hook, before a key result and before the verdict. [beat] (0.35 s) is for light emphasis. At most one marker per two sentences, never at the start or end of a section.
- The voiceover is read by a text to speech model. No URLs, no code, no file paths, no symbols, no markdown. Say things the way a person says them aloud (write "version four point five", not "v4.5.2"; do not read out commands, describe them).
- Write numbers as digits (for example "3.7 seconds", "452 tests") so they can be checked. Write numbers over 999 with commas ("80,789 stars") or as "about 80 thousand". Every number you write MUST come from the material. Never round to a number that is not there.
- One narrator. Never use "I", "me" or "my"; say "we" or talk about the video itself.`;

const OUTPUT_FORMAT = `Reply with ONE JSON object and nothing else (no code fences):
{
 "titles": [3 strings],
 "thumbnailTexts": [3 strings],
 "description": "string with newlines",
 "tags": [strings],
 "hashtags": [3 strings],
 "pinnedComment": "string",
 "sections": [{ "id": "s1", "title": "short chapter title", "voiceover": "text", "callout": "optional phrase copied word for word from the voiceover", "scene": {...} }]
}
Scene shapes (use exactly these):
{"kind":"hook","lines":["1 to 3 short kinetic lines, at most 36 characters each, the last one is accented"]}
{"kind":"repo"} an animated card of the repo (name, stars, language, description)
{"kind":"browser","shot":"<an available shot name>","caption":"optional, at most 90 chars","focus":"top|middle|bottom"}
{"kind":"footage","recording":"<an available recording file name>","caption":"optional short label, at most 60 chars, not a sentence of narration"} plays the real screen recording of the app being used
{"kind":"terminal","steps":[1 to 3 real step numbers from the log]} replays those commands with their real output
{"kind":"stats","items":[{"label":"at most 24 chars","value":42,"suffix":"optional"}]} 2 to 4 count-up numbers
{"kind":"bars","title":"...","items":[{"label":"...","value":3.7,"unit":"s"}]} 2 to 6 bars, values must be real measured metric values, step durations or the total
{"kind":"points","title":"...","items":["2 to 5 items, at most 90 chars each"]}
{"kind":"quote","text":"at most 160 chars, taken from the README","attribution":"optional"}
{"kind":"scorecard"} four animated gauges from the score
{"kind":"verdict"} the big verdict from the score
{"kind":"cta"} outro with a subscribe prompt`;

const METADATA_RULES = `Metadata:
- titles: 3 different options, at most 70 characters, specific and curiosity-driven but truthful. Use real numbers or findings. No ALL CAPS words for emphasis, no emojis, no clickbait lies.
- thumbnailTexts: 3 options, 1 to 4 words each, at most 20 characters, UPPERCASE, punchy, truthful.
- description: line 1 and line 2 are the hook (each at most 120 characters, they are all viewers see before "show more"), then a blank line, then a short factual summary, then the source links (the repo URL, and the homepage if there is one). No chapters, no hashtags. Do NOT write an AI voice disclosure, it is added automatically.
- tags: 10 to 18 relevant tags, at most 450 characters in total including one separator each. No spam, no unrelated popular terms.
- hashtags: exactly 3 single-word hashtags.
- pinnedComment: one specific question about the project that invites replies.
- Never make medical, financial, legal or security guarantees, or any claim that is not in the material.`;

const TEST_HONESTY = `Honesty rules (test mode):
- The app was really deployed and used in a fresh throwaway container by an automated agent. Everything you state about what happened must come from the metrics, the recordings, the log, the score, the triage summary or the repo data in the material. Every number, duration, exit code, count and name must be real.
- Metrics are the measured facts (install time, boot time, tests, flows, and so on). Quote them as measured. pass false means that check failed, say so. pass null is informational.
- For a footage scene you only know what its description (shows) and the nearby command output say is on screen. Describe that, nothing more. Never invent buttons, screens, text, speed or behaviour you cannot see in the material.
- Never claim anything was run, installed, opened or checked unless the material shows it. If something was not exercised, say so (the score limitations list what was not). A failure or "could not run" is a valid, honest result: report it plainly.
- Show failures as they are. Do not hide a non-zero exit or a failing test.
- Terminal scenes use real step numbers (the n field of each step) and the narration must describe what that step really did and printed. Footage scenes use a real recording file name from the material, each at most once.
- Never mention captions or subtitles in any text, the platform adds them.
- Do not write "I". Say what happened in the container ("the install took 3.7 seconds"). Viewers see a terminal or the recording, not the log. Never say "step 6" or "the log". Say "the install command", "the second run" and so on. Use each step number in only one terminal scene.
- A scorecard scene is narrated by reading all four scores (works, quality, effort, speed) and the average. A verdict scene is narrated by saying the verdict word.`;

const EXPLAIN_HONESTY = `Honesty rules (explain mode):
- This video is a README walkthrough. NOTHING was installed, run or tested, so never write "tested", "tried", "ran", "we installed", "benchmark", "hands-on", "verdict" or "score", and never describe results.
- Attribute claims to the project ("the README says", "the project describes itself as"). Use only facts in the repo data and the README.
- Say plainly, once in the full video and once in the Short, that the project was not tested for this video.
- Do not use footage, terminal, bars, scorecard or verdict scenes.`;

const OUTLINE: Record<Mode, Record<VideoKind, string>> = {
  test: {
    full: `Write the LONG VIDEO script. 11 to 16 sections, 950 to 1300 spoken words in total (the voice speaks about 2.6 words per second, so this is 6 to 9 minutes; [pause] and [beat] add time on top). Each section 18 to 170 words. This is a hands-on tester's video: the app was really deployed and really used, and the viewer watches the real screen recordings. Follow this arc, one or more sections per beat:
1. Cold open (hook scene, 30 to 50 words): tease the real measured result or the real wow or failure. No greetings.
2. Repo intro (repo scene): what the project is, who makes it, stars and language. Say once, plainly, that an automated agent deployed and tested it in a fresh throwaway container that is deleted afterwards.
3. What it claims (browser scene of the README, or points): what the README promises.
4. Deploy (terminal scene with the real install and start commands): narrate the measured numbers (install time, boot time) from the metrics.
5. Using it (one footage scene per recording, in the order of their afterStep): narrate what is visibly happening in that recording, as it plays, using only what its description and the nearby command output show. Each narration must have about the number of words in narrationWords so it fits the recording. Never use a recording twice. If there are no recordings, say plainly that nothing could be recorded and use terminal scenes instead.
6. The wow or fail moment: say it plainly and specifically, tied to a real recording or metric. If the app broke, that is the moment; report it straight. No invented drama.
7. The control (terminal, footage or points): a known good versus a known bad input, only if the flows or log show one. Otherwise say honestly that no control was run.
8. The repo's own tests (stats, points or terminal): only if a tests metric exists. Use its real numbers and pass or fail. If it does not exist, say the tests were not run.
9. The numbers (bars scene): values copied from the measured metrics, step durations or total (install, boot, tests and so on, only values that exist).
10. One real limitation (points or quote): the most important thing that failed, did not run or was not measured. Use the score limitations.
11. Scorecard (scorecard scene): read the four scores and the average.
12. Verdict (verdict scene): the verdict word and one honest sentence on who should use it.
13. Subscribe-style outro (cta scene, last section): short and warm, invite the viewer to say what to test next.`,
    short: `Write the SHORT script (vertical, under 56 seconds). 5 to 7 sections, 110 to 135 spoken words in total, each 8 to 40 words, at most 2 [pause] markers in all. The first phrase (up to the first comma, full stop or marker) must be at most 7 words so the hook lands in the first 2 seconds. First section is a hook scene on the real result. Then one quick deploy beat (stats or terminal scene with measured numbers), then exactly ONE footage scene using the single most compelling recording (the wow or the fail), narrated as it plays, then the verdict scene with the real result in one sentence. Other allowed scenes: repo, browser, stats. A scorecard scene only if the narration reads all four scores, which a Short rarely has room for. Make the last sentence echo the wording of the hook so the video reads well on a loop, but it must be a complete sentence. No cta scene. If there are no recordings, use no footage scene.`,
  },
  explain: {
    full: `Write the LONG VIDEO script. 9 to 13 sections, 950 to 1300 spoken words in total (the voice speaks about 2.6 words per second; [pause] and [beat] add time on top). Each section 18 to 170 words. Follow this arc:
1. Hook (hook scene, 30 to 50 words): the problem the project solves or the most interesting fact in the README. No greetings.
2. Repo intro (repo scene): what it is, who makes it, stars and language.
3. What problem it solves (browser scene of the README or points).
4. How it works, from the README (one to three sections using browser, points or stats scenes).
5. How to get started, as the README describes it (browser or points scene, do not read commands aloud).
6. Who it is for.
7. Tradeoffs and things to watch (points or quote), taken from the README and repo data such as license, activity, open issues.
8. An honest statement that the project was not tested for this video.
9. Subscribe-style outro (cta scene, last section): invite the viewer to say what to test next.`,
    short: `Write the SHORT script (vertical, under 56 seconds). 5 to 7 sections, 110 to 135 spoken words in total, each 8 to 40 words, at most 2 [pause] markers in all. The first phrase (up to the first comma, full stop or marker) must be at most 7 words so the hook lands in the first 2 seconds. Use hook, repo, browser, stats and points scenes. First section is a hook scene. Say once that the project was not tested for this video. End with a payoff: the one thing worth remembering. Make the last sentence echo the wording of the hook so the video reads well on a loop, but it must be a complete sentence. No cta scene.`,
  },
};

function describeShots(m: Material): unknown {
  const captions = new Map((m.log?.shots ?? []).map((s) => [`t-${s.file}`, s.caption]));
  return {
    pageCaptures: m.pageShots.map((file) => ({
      file,
      shows: file === "repo-top.png" ? "top of the GitHub repo page"
        : file === "repo-readme.png" ? "the README"
        : file === "repo-readme-2.png" ? "further down the README"
        : file === "repo-files.png" ? "the file tree"
        : file === "homepage.png" ? "the project homepage"
        : "a page capture",
    })),
    sandboxShots: m.sandboxShots.map((file) => ({ file, caption: captions.get(file) ?? "" })),
  };
}

function describeMaterial(m: Material, kind: VideoKind): string {
  const readme = m.repo.readme.slice(0, kind === "full" ? 7000 : 3000);
  const { readme: _readme, ...repo } = m.repo;
  const body: Record<string, unknown> = { mode: m.mode, repo, readme, shots: describeShots(m) };
  if (m.log && m.score) {
    const outLen = kind === "full" ? 700 : 300;
    body.log = {
      tool: m.log.tool,
      totalSecs: m.log.totalSecs,
      agentSummary: m.log.agentSummary,
      steps: m.log.steps.map((s) => ({ n: s.n, cmd: s.cmd.slice(0, 260), note: s.note, exit: s.exit, secs: s.secs, out: s.out.slice(0, outLen) })),
    };
    body.score = m.score;
    body.triage = m.triage;
    body.metrics = m.log.metrics;
    body.recordings = m.log.recordings.map((r) => {
      const entry: Record<string, unknown> = { file: r.file, shows: r.caption, secs: r.secs, afterStep: r.afterStep };
      if (kind === "full") entry.narrationWords = [Math.round(r.secs * WORDS_PER_SEC * 0.7), Math.round(r.secs * WORDS_PER_SEC * 1.2)];
      return entry;
    });
  }
  return JSON.stringify(body);
}

function systemPrompt(m: Material): string {
  return `You write scripts and YouTube metadata for a faceless channel about open-source developer tools. The voice is a local text to speech model, so the script is read aloud.
${m.mode === "test" ? TEST_HONESTY : EXPLAIN_HONESTY}
${VOICE_RULES}
${METADATA_RULES}
${OUTPUT_FORMAT}`;
}

async function writeOne(ctx: RunCtx, kind: VideoKind, m: Material, facts: number[]): Promise<Script> {
  const label = kind === "full" ? "long video" : "Short";
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt(m) },
    { role: "user", content: `${OUTLINE[m.mode][kind]}\n\nMaterial (JSON):\n${describeMaterial(m, kind)}` },
  ];
  let errors: string[] = [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ctx.emit({ kind: "progress", stage: "script", video: kind, pct: 10 + attempt * 20, label: attempt === 0 ? `Writing the ${label} script` : `Fixing the ${label} script (try ${attempt + 1})` });
    const reply = await chat(ctx.config, messages, 9000, ctx.signal);
    const result = validate(reply, kind, m, facts);
    if (!Array.isArray(result)) {
      ctx.log("script", `${label}: ${spokenWords(result.sections.map((s) => s.voiceover).join(" ")).length} words, about ${estimateSeconds(kind, result.sections).toFixed(0)} s, ${result.sections.length} sections${attempt ? `, accepted on try ${attempt + 1}` : ""}`);
      return result;
    }
    errors = result;
    ctx.log("script", `${label}: ${errors.length} problems (${errors[0]?.slice(0, 110)}), asking for a fix`);
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: `The script has problems. Fix every one and reply with the complete corrected JSON object only.\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}` });
  }
  throw new Error(`The ${label} script still had problems after ${MAX_RETRIES} fixes: ${errors.slice(0, 6).join("; ")}`);
}

export const scriptStage: Stage = async (ctx) => {
  const m = loadMaterial(ctx);
  const facts = buildFacts(m);
  const [full, short] = await Promise.all([writeOne(ctx, "full", m, facts), writeOne(ctx, "short", m, facts)]);
  const scripts: Scripts = { full, short };
  writeJson(ctx.path("scripts.json"), scripts);
  ctx.emit({ kind: "progress", stage: "script", pct: 100, label: "Scripts written" });
  ctx.emit({ kind: "artifact", name: "scripts" });
};
