// Screen recordings in the render: decode to frames the page can swap deterministically, and find where the action is.
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG, spawnCollect } from "./proc.ts";
import { FPS, type Crop, type FocusKey } from "./plan.ts";
import { FOOTAGE_SIZE } from "./runtime/times.ts";

const SAMPLE_FPS = 8;
const GRID = { w: 192, h: 108 };
const CHANGED = 24; // gray levels a pixel must move between samples to count as action
const MIN_CHANGED = 54; // pixels (of 20736); less than that is a blinking cursor, not action
const BACKDROP_TOLERANCE = 5; // gray levels away from the page background that still count as background
const CONTENT_SHARE = 0.3; // a pixel belongs to the app when it differs from the background in at least this share of the samples
const CROP_MARGIN = 0.05; // of the app's size, added on every side

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

const bump = (counts: number[] | Uint16Array, i: number): void => {
  counts[i] = (counts[i] ?? 0) + 1;
};

// The page background is the most common gray along the border of the picture; the app is whatever differs from it
// for a good part of the recording, so a narrow app centred on a plain page is found as one box.
function findCrop(raw: Uint8Array, samples: number): Crop {
  const px = GRID.w * GRID.h;
  const border = (p: number): boolean => p % GRID.w < 2 || p % GRID.w >= GRID.w - 2 || p < 2 * GRID.w || p >= px - 2 * GRID.w;
  const levels = new Array<number>(64).fill(0);
  for (let i = 0; i < samples; i++) {
    for (let p = 0; p < px; p++) if (border(p)) bump(levels, (raw[i * px + p] ?? 0) >> 2);
  }
  const bg = levels.indexOf(Math.max(...levels)) * 4 + 2;
  const seen = new Uint16Array(px);
  for (let i = 0; i < samples; i++) {
    for (let p = 0; p < px; p++) if (Math.abs((raw[i * px + p] ?? 0) - bg) > BACKDROP_TOLERANCE) bump(seen, p);
  }
  const colHits = new Array<number>(GRID.w).fill(0);
  const rowHits = new Array<number>(GRID.h).fill(0);
  for (let p = 0; p < px; p++) {
    if ((seen[p] ?? 0) >= samples * CONTENT_SHARE) {
      bump(colHits, p % GRID.w);
      bump(rowHits, Math.floor(p / GRID.w));
    }
  }
  const span = (hits: number[]): [number, number] | null => {
    const first = hits.findIndex((n) => n >= 2);
    const last = hits.findLastIndex((n) => n >= 2);
    return first < 0 ? null : [first, last + 1];
  };
  const xs = span(colHits);
  const ys = span(rowHits);
  if (!xs || !ys) return { x: 0, y: 0, w: 1, h: 1 };
  const w = (xs[1] - xs[0]) / GRID.w;
  const h = (ys[1] - ys[0]) / GRID.h;
  const x0 = Math.max(0, xs[0] / GRID.w - w * CROP_MARGIN);
  const y0 = Math.max(0, ys[0] / GRID.h - h * CROP_MARGIN);
  const x1 = Math.min(1, xs[1] / GRID.w + w * CROP_MARGIN);
  const y1 = Math.min(1, ys[1] / GRID.h + h * CROP_MARGIN);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// One pass over tiny gray samples. Where pixels change between samples is where the camera should look, and how widely
// they change decides how far to zoom (smoothed, so the camera glides). Where the app sits on its page is the crop.
export async function analyseFootage(file: string, signal: AbortSignal): Promise<{ focus: FocusKey[]; crop: Crop }> {
  const raw = await spawnCollect(FFMPEG, ["-v", "error", "-i", file, "-an", "-vf", `fps=${SAMPLE_FPS},scale=${GRID.w}:${GRID.h}:flags=area,format=gray`, "-f", "rawvideo", "-"], signal);
  const px = GRID.w * GRID.h;
  const samples = Math.floor(raw.length / px);
  if (samples === 0) throw new Error(`no frames could be read from ${file}`);
  const keys: FocusKey[] = [{ t: 0, u: 0.5, v: 0.5, z: 1 }];
  let u = 0.5;
  let v = 0.5;
  let z = 1;
  for (let i = 1; i < samples; i++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < px; p++) {
      if (Math.abs((raw[i * px + p] ?? 0) - (raw[(i - 1) * px + p] ?? 0)) > CHANGED) {
        xs.push(p % GRID.w);
        ys.push(Math.floor(p / GRID.w));
      }
    }
    if (xs.length >= MIN_CHANGED) {
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const size = Math.max((percentile(xs, 0.9) - percentile(xs, 0.1) + 1) / GRID.w, (percentile(ys, 0.9) - percentile(ys, 0.1) + 1) / GRID.h);
      const alpha = 0.07 + 0.08 * Math.min(xs.length / 540, 1);
      u += ((percentile(xs, 0.5) + 0.5) / GRID.w - u) * alpha;
      v += ((percentile(ys, 0.5) + 0.5) / GRID.h - v) * alpha;
      z += (Math.min(1.5, Math.max(1, 0.3 / Math.max(size, 0.05))) - z) * alpha;
    }
    if (i % 2 === 0) keys.push({ t: i / SAMPLE_FPS, u: +u.toFixed(4), v: +v.toFixed(4), z: +z.toFixed(4) });
  }
  return { focus: keys, crop: findCrop(raw, samples) };
}

// Decodes the first `max` frames at the video frame rate into dir/00001.jpg, 00002.jpg, ... and returns how many exist.
export async function extractFrames(file: string, dir: string, max: number, signal: AbortSignal): Promise<number> {
  mkdirSync(dir, { recursive: true });
  const { w, h } = FOOTAGE_SIZE;
  const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
  await spawnCollect(FFMPEG, ["-v", "error", "-i", file, "-an", "-vf", `fps=${FPS},${scale}`, "-frames:v", String(max), "-q:v", "4", join(dir, "%05d.jpg")], signal);
  const count = readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;
  if (count === 0) throw new Error(`no frames could be decoded from ${file}`);
  return count;
}
