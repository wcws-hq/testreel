// Pure scene timing shared by the page (to draw) and the sound designer (to place ticks and hits).
// Times are local to a layer (seconds since its start). Nothing here touches the DOM.
import type { TestStep } from "../../../shared/types.ts";
import type { PlanLayer } from "../plan.ts";
import { need } from "./ease.ts";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const STOP: Record<string, true> = { with: true, that: true, this: true, from: true, your: true, have: true, will: true, into: true, when: true, then: true, than: true, they: true, them: true, their: true, there: true, what: true, which: true };

// Layer-local time = timeline time - layer.start + layer.preroll; this is the inverse.
export const timeAt = (layer: PlanLayer, local: number): number => layer.start - layer.preroll + local;

// Footage: the recording is decoded to numbered JPEG frames at the video frame rate, one per rendered frame.
export const FOOTAGE_SIZE = { w: 1600, h: 900 };
export const FOOTAGE_LEAD = 0.6; // layer-local second at which recording time 0 is shown
export const footageFrameUrl = (dir: string, index: number): string => `${dir}/${String(index + 1).padStart(5, "0")}.jpg`;

export function localWords(layer: PlanLayer): { w: string; s: number; e: number }[] {
  return layer.words.map((x) => ({ w: x.w, s: x.s - layer.start + layer.preroll, e: x.e - layer.start + layer.preroll }));
}

// Keeps a list of times increasing with at least `gap` between neighbours and nothing earlier than `min`.
function spread(times: number[], gap: number, min: number): number[] {
  const out: number[] = [];
  for (const t of times) out.push(Math.max(t, min, (out.at(-1) ?? -Infinity) + gap));
  return out;
}

// When each list item should appear: on the first distinctive word of the item in the narration, evenly spread otherwise.
export function pointTimes(items: string[], layer: PlanLayer): number[] {
  const words = localWords(layer);
  const ss = layer.speechStart - layer.start + layer.preroll;
  const se = Math.max(layer.speechEnd - layer.start + layer.preroll, ss + 1);
  let cursor = 0;
  const raw = items.map((item, i) => {
    const tokens = item.split(/\s+/).map(norm).filter((t) => t.length >= 4 && !STOP[t]);
    for (let k = cursor; k < words.length; k++) {
      const word = need(words[k]);
      const spoken = norm(word.w);
      if (tokens.some((t) => spoken === t || (t.length >= 6 && spoken.startsWith(t.slice(0, 5))))) {
        cursor = k + 1;
        return word.s - 0.25;
      }
    }
    return ss + ((se - ss) * i) / Math.max(items.length, 1);
  });
  return spread(raw, 0.7, 0.5);
}

const GAUGE_WORDS: string[][] = [["works", "work", "working", "worked"], ["quality"], ["effort", "setup"], ["speed", "fast", "slow", "quickly"]];

export function gaugeTimes(layer: PlanLayer): number[] {
  const words = localWords(layer);
  const ss = layer.speechStart - layer.start + layer.preroll;
  const se = Math.max(layer.speechEnd - layer.start + layer.preroll, ss + 2);
  let cursor = 0;
  const raw = GAUGE_WORDS.map((names, i) => {
    for (let k = cursor; k < words.length; k++) {
      const word = need(words[k]);
      if (names.includes(norm(word.w))) {
        cursor = k + 1;
        return word.s - 0.3;
      }
    }
    return ss + ((se - ss) * i) / 4;
  });
  return spread(raw, 0.5, 0.4);
}

// Reveal time of each quote word, spread over the narration weighted by word length.
export function quoteTimes(text: string, layer: PlanLayer): number[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const ss = layer.speechStart - layer.start + layer.preroll + 0.1;
  const se = Math.max(layer.speechEnd - layer.start + layer.preroll - 0.4, ss + 1);
  const weights = parts.map((p) => p.length + 2);
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => {
    const t = ss + ((se - ss) * acc) / sum;
    acc += w;
    return t;
  });
}

export const STATS_ENTER = (i: number): number => 0.3 + i * 0.16;
export const STATS_COUNT_START = (i: number): number => 0.5 + i * 0.16;
export const STATS_COUNT_SECONDS = 1.2;

export const GAUGE_FILL_SECONDS = 1.1;
export const VERDICT_HIT = 0.25;

// ---- terminal ----
export interface TermRow {
  kind: "note" | "cmd" | "out" | "more" | "status" | "prompt"; // prompt = the idle shell prompt after the last step
  text: string;
  step: number; // index into the replayed steps
  at: number; // local second the row starts to appear
  typeSeconds: number; // cmd rows only
  key: boolean; // output line worth highlighting
  exit: number;
  secs: number;
}
export interface TermStepSpan { n: number; cmd: string; exit: number; secs: number; start: number; end: number; typeStart: number; typeEnd: number }
interface TermPlan { rows: TermRow[]; spans: TermStepSpan[] }

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const KEY_LINE = /(\bpass(ed|ing)?\b|\bok\b|success|installed|\bdone\b|\bfail(ed|ing|ure)?\b|\berror\b|enoent|\bwarn(ing)?\b|\d+ (files?|packages?|tests?)|exit code|found \d+|\bv?\d+\.\d+\.\d+\b)/i;

function clip(s: string, cols: number): string {
  const t = s.replace(/\t/g, "  ").replace(ANSI, "").replace(/\r/g, "").trimEnd();
  return t.length > cols ? `${t.slice(0, cols - 3)}...` : t;
}

function pickOutput(out: string, cols: number, maxRows: number): { text: string; key: boolean; more: boolean }[] {
  const lines = out.split("\n").map((l) => l.replace(ANSI, "").trimEnd()).filter((l) => l.trim().length > 0);
  const row = (l: string) => ({ text: clip(l, cols), key: KEY_LINE.test(l), more: false });
  if (lines.length <= maxRows) return lines.map(row);
  const head = lines.slice(0, 3);
  const tail = lines.slice(-2);
  const middle = lines.slice(3, -2).filter((l) => KEY_LINE.test(l)).slice(0, Math.max(0, maxRows - 7));
  const hidden = lines.length - head.length - tail.length - middle.length;
  return [...head.map(row), { text: `... ${hidden} more lines`, key: false, more: true }, ...middle.map(row), ...tail.map(row)];
}

export function planTerminal(steps: TestStep[], layer: PlanLayer, cols: number, maxOutRows: number): TermPlan {
  const D = layer.end - layer.start + layer.preroll;
  const words = localWords(layer).map((w) => w.s);
  const prepared = steps.map((s) => {
    const cmd = s.cmd.replace(/\s+/g, " ").trim();
    const shown = cmd.length > cols * 2 - 6 ? `${cmd.slice(0, cols * 2 - 9)}...` : cmd;
    const wrapped = shown.length > cols - 2 ? [shown.slice(0, cols - 2), shown.slice(cols - 2)] : [shown];
    return { step: s, cmd: wrapped, out: pickOutput(s.out, cols, maxOutRows), note: clip(s.note ? `# ${s.note}` : "", cols) };
  });
  const natural = prepared.map((p) => 1.1 + p.cmd.join("").length / 36 + Math.min(2.4, 0.25 + p.out.length * 0.09));
  const lead = 0.45;
  const available = Math.max(D - lead - 0.7, 1);
  const sum = natural.reduce((a, b) => a + b, 0);
  const starts: number[] = [];
  let acc = lead;
  natural.forEach((n) => {
    starts.push(acc);
    acc += (n / sum) * available;
  });
  // Each step begins on a spoken word when one is close, so the picture changes with the narration.
  const snapped = starts.map((s, i) => {
    if (i === 0) return s;
    const near = words.reduce((best, w) => (Math.abs(w - s) < Math.abs(best - s) ? w : best), Infinity);
    return Math.abs(near - s) <= 0.5 ? near : s;
  });
  const fixed: number[] = [];
  snapped.forEach((s, i) => fixed.push(i === 0 ? s : Math.max(s, need(fixed[i - 1]) + 0.8)));

  const rows: TermRow[] = [];
  const spans: TermStepSpan[] = [];
  prepared.forEach((p, i) => {
    const start = need(fixed[i]);
    const end = fixed[i + 1] ?? D;
    const span = end - start;
    const typeSeconds = Math.min(Math.max(p.cmd.join("").length / 38, 0.35), span * 0.4);
    const typeStart = start + (p.note ? 0.3 : 0.1);
    const outStart = typeStart + typeSeconds + 0.2;
    const outSeconds = Math.min(Math.max(p.out.length * 0.09, 0.2), span * 0.4);
    const base = { step: i, typeSeconds: 0, key: false, exit: p.step.exit, secs: p.step.secs };
    if (p.note) rows.push({ ...base, kind: "note", text: p.note, at: start });
    p.cmd.forEach((line, k) => rows.push({ ...base, kind: "cmd", text: line, at: typeStart + (k * typeSeconds) / p.cmd.length, typeSeconds: typeSeconds / p.cmd.length }));
    p.out.forEach((o, k) => {
      const at = outStart + (outSeconds * k) / Math.max(p.out.length, 1);
      rows.push({ ...base, kind: o.more ? "more" : "out", text: o.text, at, key: o.key });
    });
    rows.push({ ...base, kind: "status", text: "", at: outStart + outSeconds + 0.1 });
    spans.push({ n: p.step.n, cmd: p.cmd.join(""), exit: p.step.exit, secs: p.step.secs, start, end, typeStart, typeEnd: typeStart + typeSeconds });
  });
  const lastAt = Math.max(...rows.map((r) => r.at));
  rows.push({ kind: "prompt", text: "", step: prepared.length, at: lastAt + 0.35, typeSeconds: 0, key: false, exit: 0, secs: 0 });
  return { rows, spans };
}
