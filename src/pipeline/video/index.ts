// renderStage: builds the long video and the short from scripts.json, voice/<kind>/timings.json and the run's data.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readJson, type RunCtx, type Stage } from "../ctx.ts";
import type { RepoInfo, Score, Scripts, TestLog, Timings, Triage, VideoKind } from "../../shared/types.ts";
import { captureAndEncode, workerCount } from "./capture.ts";
import { analyseFootage, extractFrames } from "./footage.ts";
import { pageHtml, runtimeBundle } from "./page.ts";
import { buildPlan, type Crop, type FocusKey, type PlanInput } from "./plan.ts";
import { cancelled, probeSeconds } from "./proc.ts";
import { mixAudio } from "./sfx.ts";

function shotResolver(ctx: RunCtx): PlanInput["resolveShot"] {
  return (shot) => {
    const sandbox = shot.startsWith("t-");
    const name = sandbox ? shot.slice(2) : shot;
    if (name !== basename(name) || !name) throw new Error(`screenshot name "${shot}" is not a plain file name`);
    const file = sandbox ? ctx.path("test/shots", name) : ctx.path("shots", name);
    if (!existsSync(file)) throw new Error(`screenshot "${shot}" is missing (${sandbox ? "test/shots" : "shots"}/${name})`);
    return file;
  };
}

interface Recording { file: string; secs: number; focus: FocusKey[]; crop: Crop }

// Probes and analyses every recording the script uses, once per file across both videos.
async function prepareRecordings(ctx: RunCtx, script: Scripts[VideoKind], cache: Map<string, Recording>): Promise<PlanInput["resolveFootage"]> {
  for (const section of script.sections) {
    if (section.scene.kind !== "footage" || cache.has(section.scene.recording)) continue;
    const name = section.scene.recording;
    if (name !== basename(name) || !name) throw new Error(`recording name "${name}" is not a plain file name`);
    const file = ctx.path("test/rec", name);
    if (!existsSync(file)) throw new Error(`recording "${name}" is missing (test/rec/${name})`);
    cache.set(name, { file, secs: await probeSeconds(file, ctx.signal), ...(await analyseFootage(file, ctx.signal)) });
  }
  return (name) => {
    const rec = cache.get(name);
    if (!rec) throw new Error(`recording "${name}" was not prepared`);
    return rec;
  };
}

async function renderKind(ctx: RunCtx, kind: VideoKind, scripts: Scripts, recordings: Map<string, Recording>): Promise<void> {
  const progress = (pct: number, label: string) => ctx.emit({ kind: "progress", stage: "render", video: kind, pct, label });
  const tested = ctx.run.mode === "test";
  const voiceFile = ctx.path("voice", kind, "voice.wav");
  const timings = readJson<Timings>(ctx.path("voice", kind, "timings.json"));
  const repo = readJson<RepoInfo>(ctx.path("repo.json"));
  const score = tested ? readJson<Score>(ctx.path("score.json")) : null;
  const log = tested ? readJson<TestLog>(ctx.path("test/log.json")) : null;
  const voiceSeconds = await probeSeconds(voiceFile, ctx.signal);

  const resolveFootage = await prepareRecordings(ctx, scripts[kind], recordings);
  const triageFile = ctx.path("triage.json");
  const triage = tested && existsSync(triageFile) ? readJson<Triage>(triageFile) : null;
  const appAddress = triage?.port ? `localhost:${triage.port}${triage.healthPath ?? "/"}` : null;
  const { plan, assets, footage } = buildPlan({ kind, script: scripts[kind], timings, voiceSeconds, repo, score, log, channel: ctx.config.channelName, testedMode: tested, resolveShot: shotResolver(ctx), resolveFootage, appAddress });

  const work = mkdtempSync(join(tmpdir(), `testreel-${kind}-`));
  try {
    progress(0, "Preparing the page");
    for (const a of assets) {
      const link = join(work, a.url);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(a.file, link);
    }
    for (const f of footage) {
      progress(0, "Decoding the screen recording");
      f.scene.frames = await extractFrames(f.file, join(work, f.scene.dir), f.scene.frames, ctx.signal);
    }
    const htmlFile = join(work, "index.html");
    await Bun.write(htmlFile, pageHtml(plan, await runtimeBundle()));

    progress(0, "Mixing voice and sound design");
    const audioFile = join(work, "audio.wav");
    await mixAudio(plan, voiceFile, plan.layers[0]?.kind === "intro" ? plan.layers[0].end : 0, audioFile, ctx.signal);

    const outFile = join(work, "video.mp4");
    let lastPct = -1;
    let lastAt = 0;
    const started = performance.now();
    const result = await captureAndEncode({
      plan, htmlFile, audioFile, outFile, chrome: ctx.config.chrome, signal: ctx.signal,
      onProgress(done, total) {
        const pct = Math.floor((done / total) * 100);
        const now = performance.now();
        if (pct === lastPct || now - lastAt < 1000) return;
        lastPct = pct;
        lastAt = now;
        progress(pct, `Rendering frame ${done} of ${total} (${(done / ((now - started) / 1000)).toFixed(1)} fps)`);
      },
    });
    if (ctx.signal.aborted) throw cancelled();
    const finalDir = ctx.path("final", kind);
    mkdirSync(finalDir, { recursive: true });
    const part = join(finalDir, "video.mp4.part");
    copyFileSync(outFile, part);
    renameSync(part, join(finalDir, "video.mp4"));
    progress(100, "Rendered");
    ctx.log("render", `${kind}: ${result.frames} frames in ${result.seconds.toFixed(0)} s (${(result.frames / result.seconds).toFixed(1)} fps, ${workerCount()} workers)`);
    ctx.emit({ kind: "artifact", name: "video", video: kind });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const renderStage: Stage = async (ctx) => {
  const scripts = readJson<Scripts>(ctx.path("scripts.json"));
  const recordings = new Map<string, Recording>();
  for (const kind of ["short", "full"] as const) {
    if (ctx.signal.aborted) throw cancelled();
    await renderKind(ctx, kind, scripts, recordings);
  }
};
