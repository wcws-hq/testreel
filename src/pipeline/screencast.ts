// Real screen capture of a headless Chrome page: CDP screencast frames are laid on a constant 30 fps grid and piped into ffmpeg,
// which writes H.264 in an mp4 (1920x1080). Used for the web footage and the terminal sessions.
import puppeteer from "puppeteer-core";
import type { Browser, CDPSession, Page } from "puppeteer-core";
import { FFMPEG, probeSeconds } from "./video/proc.ts";
import type { RunCtx } from "./ctx.ts";

export const VIEW = { width: 1920, height: 1080 } as const;
const FPS = 30;

export async function launchChrome(ctx: RunCtx): Promise<Browser> {
  const browser = await puppeteer.launch({
    executablePath: ctx.config.chrome,
    headless: true,
    defaultViewport: { ...VIEW, deviceScaleFactor: 1 },
    args: ["--hide-scrollbars", "--force-device-scale-factor=1", "--disable-features=Translate", "--no-first-run", `--window-size=${VIEW.width},${VIEW.height}`],
  });
  ctx.signal.addEventListener("abort", () => void browser.close().catch(() => undefined), { once: true });
  return browser;
}

interface Frame {
  jpeg: Buffer;
  ts: number; // seconds, from Chrome
}

export class Screencast {
  private ffmpeg: Bun.Subprocess<"pipe", "ignore", "pipe">;
  private cdp: CDPSession;
  private first = 0;
  private prev: Frame | null = null;
  private prevWall = 0;
  private chain: Promise<void> = Promise.resolve();
  private failure = "";
  private finished = false;

  private constructor(cdp: CDPSession, file: string, signal: AbortSignal) {
    this.cdp = cdp;
    this.ffmpeg = Bun.spawn(
      [
        FFMPEG, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-an",
        "-vf", `scale=${VIEW.width}:${VIEW.height}:force_original_aspect_ratio=decrease,pad=${VIEW.width}:${VIEW.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS), "-movflags", "+faststart", file,
      ],
      { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
    );
    signal.addEventListener("abort", () => this.dispose(), { once: true });
    void new Response(this.ffmpeg.stderr).text().then((t) => (this.failure = t.trim()));
  }

  static async start(page: Page, file: string, signal: AbortSignal): Promise<Screencast> {
    if (signal.aborted) throw new Error("cancelled");
    const cdp = await page.createCDPSession();
    const cast = new Screencast(cdp, file, signal);
    cdp.on("Page.screencastFrame", (ev) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => undefined);
      const ts = ev.metadata.timestamp;
      if (ts !== undefined) cast.push({ jpeg: Buffer.from(ev.data, "base64"), ts });
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 }).catch((e: unknown) => {
      cast.dispose();
      throw e;
    });
    return cast;
  }

  // A frame that lasted from the previous timestamp to this one fills the 30 fps grid between them.
  private push(frame: Frame): void {
    if (this.prev) {
      const end = Math.round((frame.ts - this.first) * FPS);
      const start = Math.round((this.prev.ts - this.first) * FPS);
      this.write(this.prev.jpeg, end - start);
    } else {
      this.first = frame.ts;
    }
    this.prev = frame;
    this.prevWall = performance.now();
  }

  private write(jpeg: Buffer, times: number): void {
    if (times <= 0) return;
    this.chain = this.chain.then(async () => {
      for (let i = 0; i < times; i++) this.ffmpeg.stdin.write(jpeg);
      await this.ffmpeg.stdin.flush();
    }).catch(() => undefined); // a dead ffmpeg is reported by its exit code in stop()
  }

  // Kills ffmpeg if the capture was never finished (an error or a cancel in between); safe to call after stop().
  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    this.ffmpeg.kill(9); // ffmpeg ignores a polite SIGTERM while it waits for frames on stdin
  }

  // Stops the capture, lets ffmpeg finish and returns the length of the video in seconds.
  async stop(file: string, signal: AbortSignal): Promise<number> {
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
    if (this.prev) this.write(this.prev.jpeg, Math.max(1, Math.round(((performance.now() - this.prevWall) / 1000) * FPS)));
    await this.chain;
    await this.ffmpeg.stdin.end();
    const code = await this.ffmpeg.exited;
    this.finished = true;
    if (signal.aborted) throw new Error("cancelled");
    if (code !== 0 || !this.prev) throw new Error(`ffmpeg could not write the recording: ${this.failure.slice(-300) || "no frames were captured"}`);
    return Math.round((await probeSeconds(file, signal)) * 10) / 10;
  }
}
