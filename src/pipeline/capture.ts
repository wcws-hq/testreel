// Stage "capture": 1920x1080 dark-mode screenshots of the GitHub page and the project homepage, saved to shots/.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import type { RepoInfo } from "../shared/types.ts";
import { readJson } from "./ctx.ts";
import type { Stage } from "./ctx.ts";

const VIEW = { width: 1920, height: 1080 };
const SHOT_NAMES = ["repo-top.png", "repo-readme.png", "repo-readme-2.png", "repo-files.png", "homepage.png"];
const FILES_BELOW_TOP_SHOT = VIEW.height * 0.6; // the file tree only gets its own shot when the top shot does not already show it
const README_SECOND_SHOT_MIN = VIEW.height * 1.6; // README height that justifies a second shot further down
const MIN_LUMA_STDDEV = 4; // below this a screenshot counts as blank

// Clicks away cookie and consent banners, then waits for fonts and the images near the viewport.
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const answer = /^(accept( all)?( cookies)?|reject( all)?( cookies)?|decline|got it|dismiss|no thanks|i agree|agree|ok|okay|close)$/i;
    const containers = document.querySelectorAll<HTMLElement>(
      '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i],[aria-label*="consent" i]',
    );
    for (const box of containers) {
      for (const b of box.querySelectorAll<HTMLElement>("button,a[role=button]")) {
        if (answer.test((b.textContent ?? "").trim())) {
          b.click();
          break;
        }
      }
    }
    await document.fonts.ready;
    const near = [...document.images].filter((img) => {
      const r = img.getBoundingClientRect();
      return !img.complete && r.bottom > -200 && r.top < innerHeight + 200;
    });
    await Promise.all(
      near.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.onload = img.onerror = () => resolve();
            setTimeout(resolve, 5000);
          }),
      ),
    );
  });
  await Bun.sleep(500);
}

// Decodes the PNG inside Chrome (no network, no page CSP involved) and measures how much the pixels vary.
async function isBlank(page: Page, png: Uint8Array): Promise<boolean> {
  const stddev = await page.evaluate(async (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const w = 96;
    const h = 54;
    const g = new OffscreenCanvas(w, h).getContext("2d");
    if (!g) return 0;
    g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      sum += y;
      sq += y * y;
    }
    const n = w * h;
    return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
  }, Buffer.from(png).toString("base64"));
  return stddev < MIN_LUMA_STDDEV;
}

export const captureStage: Stage = async (ctx) => {
  const repo = readJson<RepoInfo>(ctx.path("repo.json"));
  const dir = ctx.path("shots");
  mkdirSync(dir, { recursive: true });
  for (const f of SHOT_NAMES) rmSync(`${dir}/${f}`, { force: true });

  const browser: Browser = await puppeteer.launch({
    executablePath: ctx.config.chrome,
    headless: true,
    defaultViewport: VIEW,
    args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  });
  const onAbort = () => void browser.close();
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  const saved: string[] = [];

  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

    const keep = async (name: string): Promise<void> => {
      const png = await page.screenshot({ type: "png" });
      if (await isBlank(page, png)) {
        ctx.log("capture", `${name} looked blank, dropped`);
        return;
      }
      writeFileSync(`${dir}/${name}`, png);
      saved.push(name);
      ctx.log("capture", `Saved ${name}`);
    };
    const scrollTo = async (y: number): Promise<void> => {
      await page.evaluate((to: number) => {
        window.scrollTo({ top: to, behavior: "instant" });
      }, y);
      await settle(page);
    };
    // Page-relative top of the first element matching a selector, or null.
    const topOf = (selector: string): Promise<number | null> =>
      page.evaluate((s: string) => {
        const el = document.querySelector(s);
        return el ? el.getBoundingClientRect().top + window.scrollY : null;
      }, selector);

    ctx.emit({ kind: "progress", stage: "capture", pct: 5, label: "Opening the repo page" });
    await page.goto(repo.url, { waitUntil: "networkidle2", timeout: 45000 });
    await settle(page);
    await keep("repo-top.png");

    const readmeSel = "article.markdown-body, #readme";
    await page.waitForSelector(readmeSel, { timeout: 10000 }).catch(() => null);
    const readmeTop = await topOf(readmeSel);
    if (readmeTop !== null) {
      ctx.emit({ kind: "progress", stage: "capture", pct: 30, label: "Capturing the README" });
      const readmeHeight = await page.evaluate((s: string) => document.querySelector(s)?.getBoundingClientRect().height ?? 0, readmeSel);
      await scrollTo(Math.max(0, readmeTop - 90));
      await keep("repo-readme.png");
      if (readmeHeight > README_SECOND_SHOT_MIN) {
        await scrollTo(Math.max(0, readmeTop - 90) + VIEW.height - 160);
        await keep("repo-readme-2.png");
      }
    } else {
      ctx.log("capture", "No README block found on the page");
    }

    const filesTop = await topOf('table[aria-labelledby="folders-and-files"], [data-testid="repo-file-tree"], .js-navigation-container[role=grid]');
    if (filesTop !== null && filesTop > FILES_BELOW_TOP_SHOT) {
      await scrollTo(filesTop - 110);
      await keep("repo-files.png");
    }

    if (repo.homepage && new URL(repo.homepage).hostname !== "github.com") {
      ctx.emit({ kind: "progress", stage: "capture", pct: 70, label: "Opening the project homepage" });
      try {
        const res = await page.goto(repo.homepage, { waitUntil: "networkidle2", timeout: 30000 });
        if (res && res.status() < 400) {
          await settle(page);
          await keep("homepage.png");
        } else {
          ctx.log("capture", `Homepage answered ${res?.status() ?? "nothing"}, skipped`);
        }
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        ctx.log("capture", `Homepage not reachable (${e instanceof Error ? e.message.split("\n")[0] : String(e)}), skipped`);
      }
    }
  } catch (e) {
    if (ctx.signal.aborted) throw new Error("cancelled");
    if (!saved.includes("repo-top.png")) throw new Error(`Could not capture the repo page: ${e instanceof Error ? e.message : String(e)}`);
    ctx.log("capture", `Stopped early: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
    await browser.close();
  }

  if (ctx.signal.aborted) throw new Error("cancelled");
  if (saved.length === 0) throw new Error("No usable screenshots were captured");
  ctx.emit({ kind: "progress", stage: "capture", pct: 100, label: `${saved.length} screenshots saved` });
};
