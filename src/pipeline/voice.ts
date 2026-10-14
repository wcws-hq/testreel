// Stage "voice": local Kokoro voices every section, the clips are joined with editorial pacing, loudness is
// normalised, and voice.wav plus timings.json are written per video kind.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "./ctx.ts";
import type { RunCtx, Stage } from "./ctx.ts";
import { MAX_VOICE_SECONDS } from "../shared/types.ts";
import type { Scene, Scripts, SectionTiming, Timings, VideoKind, WordTime } from "../shared/types.ts";
import { FFMPEG, FFPROBE } from "./video/proc.ts";

const KOKORO_SCRIPT = join(import.meta.dir, "python/kokoro.py");
const MAX_SPEED = 1.15;
const MAX_REVOICE_PASSES = 2;
const SAMPLE_RATE = 24000;
const TARGET_LUFS = -16;
const LEAD: Record<VideoKind, number> = { full: 0.6, short: 0.4 };
// after the first section, before a score or verdict section, otherwise
const GAPS: Record<VideoKind, [number, number, number]> = { full: [1.0, 0.9, 0.7], short: [0.55, 0.5, 0.4] };

export const leadIn = (kind: VideoKind): number => LEAD[kind];

export function gapAfter(kind: VideoKind, sections: { scene: Pick<Scene, "kind"> }[], i: number): number {
  const [afterFirst, beforeScore, otherwise] = GAPS[kind];
  if (i === 0) return afterFirst;
  const next = sections[i + 1]?.scene.kind;
  return next === "scorecard" || next === "verdict" ? beforeScore : otherwise;
}

function cancelled(ctx: RunCtx): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

// Runs a binary to completion. Aborting the run kills it.
export async function run(ctx: RunCtx, cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  cancelled(ctx);
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", signal: ctx.signal });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  cancelled(ctx);
  if (code !== 0) throw new Error(`${cmd.split("/").pop()} failed (${code}): ${stderr.trim().split("\n").slice(-4).join(" | ")}`);
  return { stdout, stderr };
}

export async function probeDuration(ctx: RunCtx, file: string): Promise<number> {
  const { stdout } = await run(ctx, FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const secs = Number.parseFloat(stdout);
  if (!Number.isFinite(secs)) throw new Error(`Could not read the duration of ${file}`);
  return secs;
}

// ---- the Kokoro process: one per run, models load once ----

// The recogniser sometimes splits "14,235" or "14.1.2" into "14" ",235" or "14" ".1" ".2". A token that starts with
// punctuation belongs to the word before it, so it is glued on and the word's end moves to the end of the token.
// Clips cached by earlier runs hold the split form, so this is applied whenever timings are assembled.
const CONTINUATION = /^[.,'\u2019%:;!?)\]\-\u2010-\u2014]/;

function mergeSplitWords(words: WordTime[]): WordTime[] {
  const out: WordTime[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && CONTINUATION.test(w.w)) out[out.length - 1] = { w: prev.w + w.w, s: prev.s, e: Math.max(prev.e, w.e) };
    else out.push({ ...w });
  }
  return out;
}

interface ClipInfo { dur: number; words: WordTime[] }
type Reply = { ready: true } | ({ ok: true } & ClipInfo) | { ok: false; error: string };

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
}

class Kokoro {
  private readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly replies: AsyncGenerator<string>;
  private stderrTail = "";

  private constructor(private readonly ctx: RunCtx) {
    const { python, model, voices } = ctx.config.kokoro;
    const proc = Bun.spawn([python, KOKORO_SCRIPT, model, voices], { stdin: "pipe", stdout: "pipe", stderr: "pipe", signal: ctx.signal });
    this.proc = proc;
    this.replies = readLines(proc.stdout);
    void (async () => {
      for await (const chunk of proc.stderr) this.stderrTail = (this.stderrTail + new TextDecoder().decode(chunk)).slice(-1500);
    })();
  }

  static async start(ctx: RunCtx): Promise<Kokoro> {
    for (const [what, file] of [["Kokoro python", ctx.config.kokoro.python], ["Kokoro model", ctx.config.kokoro.model], ["Kokoro voices", ctx.config.kokoro.voices]] as const) {
      if (!existsSync(file)) throw new Error(`${what} not found at ${file}`);
    }
    ctx.log("voice", "Loading the voice models");
    const worker = new Kokoro(ctx);
    await worker.read();
    return worker;
  }

  private async read(): Promise<Reply> {
    const line = await this.replies.next();
    cancelled(this.ctx);
    if (line.done) throw new Error(`The Kokoro process stopped: ${this.stderrTail.trim().split("\n").slice(-3).join(" | ") || "no output"}`);
    return JSON.parse(line.value) as Reply;
  }

  async voice(out: string, voice: string, text: string, speed: number): Promise<ClipInfo> {
    this.proc.stdin.write(`${JSON.stringify({ out, voice, text, speed })}\n`);
    this.proc.stdin.flush();
    let reply: Reply;
    try {
      reply = await this.read();
    } catch (e) {
      rmSync(`${out}.part.wav`, { force: true });
      throw e;
    }
    if ("ready" in reply) throw new Error("Unexpected reply from the Kokoro process");
    if (!reply.ok) throw new Error(`Kokoro failed: ${reply.error}`);
    return { dur: reply.dur, words: reply.words };
  }

  stop(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// ---- one video kind ----

interface Built { total: number; speech: number; gaps: number }

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

async function normalise(ctx: RunCtx, input: string, output: string): Promise<void> {
  const filter = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const measured = await run(ctx, FFMPEG, ["-hide_banner", "-nostats", "-i", input, "-af", `${filter}:print_format=json`, "-f", "null", "-"]);
  const stats = JSON.parse(measured.stderr.slice(measured.stderr.lastIndexOf("{"), measured.stderr.lastIndexOf("}") + 1)) as Record<string, string>;
  const second = `${filter}:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
  await run(ctx, FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", second, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", output]);
}

async function buildKind(ctx: RunCtx, getWorker: () => Promise<Kokoro>, kind: VideoKind, scripts: Scripts, speed: number): Promise<Built> {
  const sections = scripts[kind].sections;
  const voiceFor = (v: "A" | "B"): string => (v === "B" ? ctx.config.kokoro.voiceB : ctx.config.kokoro.voiceA);
  const cacheDir = join(ctx.config.dataDir, "voice-cache");
  mkdirSync(cacheDir, { recursive: true });

  const clips: ClipInfo[] = [];
  const files: string[] = [];
  for (const [i, s] of sections.entries()) {
    const key = createHash("sha1").update(`${voiceFor(s.voice)}|${speed}|${s.voiceover}`).digest("hex");
    const wav = join(cacheDir, `${key}.wav`);
    const meta = join(cacheDir, `${key}.json`);
    let info: ClipInfo;
    let note = "";
    if (existsSync(wav) && existsSync(meta)) {
      info = JSON.parse(readFileSync(meta, "utf8")) as ClipInfo;
      note = " (cached)";
    } else {
      info = await (await getWorker()).voice(wav, voiceFor(s.voice), s.voiceover, speed);
      writeFileSync(meta, JSON.stringify(info));
    }
    clips.push(info);
    files.push(wav);
    ctx.emit({ kind: "progress", stage: "voice", video: kind, pct: Math.round(((i + 1) / sections.length) * 85), label: `Voiced ${i + 1} of ${sections.length}: ${s.title}${note}` });
  }

  const work = mkdtempSync(join(tmpdir(), "testreel-voice-"));
  try {
    const gapFile = new Map<number, string>();
    const gapPath = async (secs: number): Promise<string> => {
      let file = gapFile.get(secs);
      if (!file) {
        file = join(work, `gap-${secs}.wav`);
        await run(ctx, FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`, "-t", String(secs), "-c:a", "pcm_s16le", file]);
        gapFile.set(secs, file);
      }
      return file;
    };

    const lead = LEAD[kind];
    const entry = (file: string): string => `file '${file.replace(/'/g, "'\\''")}'`;
    const list = [entry(await gapPath(lead))];
    const bounds: { start: number; end: number; speechStart: number; speechEnd: number }[] = [];
    let cursor = lead;
    let gaps = 0;
    for (const [i, clip] of clips.entries()) {
      const gap = i < clips.length - 1 ? gapAfter(kind, sections, i) : 0;
      list.push(entry(files[i] as string));
      if (gap > 0) list.push(entry(await gapPath(gap)));
      const speechStart = cursor;
      const speechEnd = cursor + clip.dur;
      bounds.push({ start: i === 0 ? 0 : speechStart - gapAfter(kind, sections, i - 1) / 2, end: speechEnd + gap / 2, speechStart, speechEnd });
      cursor = speechEnd + gap;
      gaps += gap;
    }
    writeFileSync(join(work, "list.txt"), list.join("\n"));
    ctx.emit({ kind: "progress", stage: "voice", video: kind, pct: 90, label: "Joining and levelling the voice" });
    const joined = join(work, "joined.wav");
    await run(ctx, FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-c:a", "pcm_s16le", joined]);
    const levelled = join(work, "voice.wav");
    await normalise(ctx, joined, levelled);

    const total = round3(await probeDuration(ctx, levelled));
    const timings: Timings = {
      total,
      lead,
      sections: sections.map((s, i): SectionTiming => {
        const b = bounds[i] as (typeof bounds)[number];
        const offset = b.speechStart;
        return {
          id: s.id,
          title: s.title,
          start: round3(b.start),
          end: i === sections.length - 1 ? total : round3(b.end),
          speechStart: round3(b.speechStart),
          speechEnd: round3(b.speechEnd),
          words: mergeSplitWords((clips[i] as ClipInfo).words).map((w) => ({ w: w.w, s: round3(offset + w.s), e: round3(offset + w.e) })),
        };
      }),
    };
    const outDir = ctx.path("voice", kind);
    mkdirSync(outDir, { recursive: true });
    copyFileSync(levelled, join(outDir, "voice.wav"));
    writeJson(join(outDir, "timings.json"), timings);
    return { total, speech: clips.reduce((a, c) => a + c.dur, 0), gaps };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function voiceKind(ctx: RunCtx, getWorker: () => Promise<Kokoro>, kind: VideoKind, scripts: Scripts): Promise<void> {
  const max = MAX_VOICE_SECONDS[kind];
  let speed = ctx.config.kokoro.speed;
  for (let pass = 0; ; pass++) {
    const built = await buildKind(ctx, getWorker, kind, scripts, speed);
    ctx.log("voice", `${kind}: ${built.total.toFixed(1)} s at ${speed}x`);
    if (built.total <= max) break;
    const room = max - 1 - built.gaps - LEAD[kind];
    const wanted = room > 0 ? Math.min(MAX_SPEED, Math.round((speed * built.speech * 100) / room) / 100) : MAX_SPEED;
    if (wanted <= speed + 0.005 || pass >= MAX_REVOICE_PASSES) {
      throw new Error(`The ${kind} voice is ${built.total.toFixed(1)} s, ${(built.total - max).toFixed(1)} s over the ${max} s limit even at ${speed}x. Shorten the ${kind} script.`);
    }
    ctx.log("voice", `${kind} is ${(built.total - max).toFixed(1)} s over the ${max} s limit, voicing again at ${wanted}x`);
    speed = wanted;
  }
  ctx.emit({ kind: "progress", stage: "voice", video: kind, pct: 100, label: "Voice ready" });
  ctx.emit({ kind: "artifact", name: "voice", video: kind });
}

export const voiceStage: Stage = async (ctx) => {
  const scripts = readJson<Scripts>(ctx.path("scripts.json"));
  let worker: Kokoro | undefined;
  const getWorker = async (): Promise<Kokoro> => (worker ??= await Kokoro.start(ctx));
  try {
    for (const kind of ["full", "short"] as const) await voiceKind(ctx, getWorker, kind, scripts);
  } finally {
    worker?.stop();
  }
};
