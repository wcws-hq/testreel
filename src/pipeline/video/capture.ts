// Frame capture and encode: several Chrome workers render frames of the same page in parallel, a reorder buffer feeds
// them in order to one ffmpeg process that encodes the video and muxes the prepared audio.
import { cpus } from "node:os";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer-core";
import { FFMPEG, cancelled } from "./proc.ts";
import type { VideoPlan } from "./plan.ts";

const CHUNK_FRAMES = 30;

interface CaptureJob {
  plan: VideoPlan;
  htmlFile: string;
  audioFile: string;
  outFile: string;
  chrome: string;
  signal: AbortSignal;
  onProgress(framesDone: number, framesTotal: number): void;
}

export function workerCount(): number {
  return Math.max(1, Math.min(cpus().length - 2, 6));
}

export async function captureAndEncode(job: CaptureJob): Promise<{ frames: number; seconds: number }> {
  const { plan, signal } = job;
  const frames = Math.round(plan.total * plan.fps);
  const chunks = Math.ceil(frames / CHUNK_FRAMES);
  const workers = Math.min(workerCount(), chunks);
  const started = performance.now();

  const ffmpeg = Bun.spawn(
    [
      FFMPEG, "-y", "-v", "error",
      "-f", "image2pipe", "-framerate", String(plan.fps), "-c:v", "mjpeg", "-i", "pipe:0",
      "-i", job.audioFile,
      "-map", "0:v", "-map", "1:a",
      "-vf", "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-r", String(plan.fps),
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-b:a", "192k", "-af", "apad",
      "-movflags", "+faststart", "-t", (frames / plan.fps).toFixed(4),
      job.outFile,
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );
  const ffmpegErr = new Response(ffmpeg.stderr).text();

  const browsers: Browser[] = [];
  let failure: unknown = null;
  const fail = (e: unknown) => {
    failure ??= e;
    wake();
  };
  const abort = () => {
    fail(cancelled());
    ffmpeg.kill();
    for (const b of browsers) b.process()?.kill();
  };
  signal.addEventListener("abort", abort, { once: true });

  let waiters: (() => void)[] = [];
  const wake = () => {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  };
  const nextEvent = () => new Promise<void>((r) => waiters.push(r));

  const ready = new Map<number, Buffer[]>();
  let nextChunk = 0;
  let writeIdx = 0;
  let written = 0;
  let writing: Promise<void> = Promise.resolve();
  const flush = () => {
    writing = writing.then(async () => {
      while (!failure && ready.has(writeIdx)) {
        for (const buf of ready.get(writeIdx) ?? []) ffmpeg.stdin.write(buf);
        await ffmpeg.stdin.flush();
        written += (ready.get(writeIdx) ?? []).length;
        ready.delete(writeIdx);
        writeIdx++;
        job.onProgress(written, frames);
        wake();
      }
    });
    return writing;
  };

  const work = async () => {
    const browser = await puppeteer.launch({
      executablePath: job.chrome,
      headless: true,
      defaultViewport: { width: plan.W, height: plan.H, deviceScaleFactor: 1 },
      args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
    });
    browsers.push(browser);
    if (signal.aborted) throw cancelled();
    const page = await browser.newPage();
    page.on("pageerror", (e) => fail(e));
    await page.goto(pathToFileURL(job.htmlFile).href);
    await page.evaluate(() => window.__ready);
    const cdp = await page.createCDPSession();
    while (!failure) {
      while (!failure && nextChunk - writeIdx >= workers * 3 && nextChunk < chunks) await nextEvent();
      const k = nextChunk++;
      if (k >= chunks || failure) return;
      const out: Buffer[] = [];
      for (let f = k * CHUNK_FRAMES; f < Math.min(frames, (k + 1) * CHUNK_FRAMES); f++) {
        if (failure) return;
        await page.evaluate((t) => window.__seek(t), f / plan.fps);
        const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, optimizeForSpeed: true });
        out.push(Buffer.from(shot.data, "base64"));
      }
      ready.set(k, out);
      await flush();
    }
  };

  try {
    await Promise.all(Array.from({ length: workers }, () => work().catch(fail)));
    if (failure) throw failure;
    await writing;
    await ffmpeg.stdin.end();
    const code = await ffmpeg.exited;
    if (signal.aborted) throw cancelled();
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${(await ffmpegErr).trim().slice(-500)}`);
  } catch (e) {
    ffmpeg.kill();
    throw signal.aborted ? cancelled() : e;
  } finally {
    signal.removeEventListener("abort", abort);
    await Promise.all(browsers.map((b) => b.close().catch(() => b.process()?.kill())));
  }
  return { frames, seconds: (performance.now() - started) / 1000 };
}
