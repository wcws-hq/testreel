// Stage "package": checks the finished video and thumbnails, builds the chapters and the final description,
// and writes final/<kind>/meta.json, which is what the upload sends.
import { existsSync } from "node:fs";
import { readJson, writeJson } from "./ctx.ts";
import type { RunCtx, Stage } from "./ctx.ts";
import { probeDuration } from "./voice.ts";
import { MAX_FULL_SECONDS, MAX_SHORT_SECONDS, TIMELINE } from "../shared/types.ts";
import type { Chapter, FinalMeta, Mode, Scripts, Timings, VideoKind } from "../shared/types.ts";

const MIN_CHAPTER_SECONDS = 10;
const MIN_CHAPTERS = 3;
const MAX_SECONDS: Record<VideoKind, number> = { full: MAX_FULL_SECONDS, short: MAX_SHORT_SECONDS };

const DISCLOSURE: Record<Mode, string> = {
  test: "The voice in this video is AI-generated. Hands-on testing was done by an automated agent in a throwaway container.",
  explain: "The voice in this video is AI-generated. The project was not tested for this video.",
};

function clock(secs: number): string {
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

// YouTube needs the first chapter at 0:00, at least 3 chapters, and every chapter at least 10 s long (the last one too).
function buildChapters(timings: Timings, durationSec: number): Chapter[] {
  const chapters: Chapter[] = [];
  for (const [i, s] of timings.sections.entries()) {
    const t = i === 0 ? 0 : Math.round(s.start + TIMELINE.full.intro);
    const previous = chapters[chapters.length - 1];
    if (previous && t - previous.t < MIN_CHAPTER_SECONDS) continue;
    if (i > 0 && durationSec - t < MIN_CHAPTER_SECONDS) continue;
    chapters.push({ t, title: s.title });
  }
  return chapters.length >= MIN_CHAPTERS ? chapters : [];
}

async function packageKind(ctx: RunCtx, kind: VideoKind, scripts: Scripts): Promise<void> {
  const dir = ctx.path("final", kind);
  const video = `${dir}/video.mp4`;
  const missing = [video, ...[1, 2, 3].map((n) => `${dir}/thumb-${n}.jpg`)].filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`The ${kind} video is not ready, missing: ${missing.map((f) => f.slice(dir.length + 1)).join(", ")}`);

  const durationSec = Math.round((await probeDuration(ctx, video)) * 10) / 10;
  if (durationSec > MAX_SECONDS[kind]) throw new Error(`The ${kind} video is ${durationSec} s, over the ${MAX_SECONDS[kind]} s limit`);

  const script = scripts[kind];
  const title = script.titles[0];
  if (!title) throw new Error(`The ${kind} script has no title`);
  const chapters = kind === "full" ? buildChapters(readJson<Timings>(ctx.path("voice/full/timings.json")), durationSec) : [];
  const hashtags = kind === "short" ? [...script.hashtags, "#Shorts"] : script.hashtags;
  const description = [
    script.description.trim(),
    ...(chapters.length ? [["Chapters", ...chapters.map((c) => `${clock(c.t)} ${c.title}`)].join("\n")] : []),
    DISCLOSURE[ctx.run.mode],
    hashtags.join(" "),
  ].join("\n\n");

  const meta: FinalMeta = {
    kind,
    title,
    titles: script.titles,
    description,
    tags: script.tags,
    hashtags: script.hashtags,
    thumbnailTexts: script.thumbnailTexts,
    thumbnail: 1,
    pinnedComment: script.pinnedComment,
    durationSec,
    chapters,
  };
  writeJson(`${dir}/meta.json`, meta);
  ctx.emit({ kind: "artifact", name: "meta", video: kind });
}

export const packageStage: Stage = async (ctx) => {
  const scripts = readJson<Scripts>(ctx.path("scripts.json"));
  for (const [i, kind] of (["full", "short"] as const).entries()) {
    ctx.emit({ kind: "progress", stage: "package", video: kind, pct: i * 50, label: `Packaging the ${kind === "full" ? "long video" : "Short"}` });
    await packageKind(ctx, kind, scripts);
  }
  ctx.emit({ kind: "progress", stage: "package", pct: 100, label: "Packaged" });
};
