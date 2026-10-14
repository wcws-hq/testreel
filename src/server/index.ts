// Testreel server: API, live event stream, run files, and the web UI (Bun fullstack bundler).
// Bound to 127.0.0.1 only: it starts containers and handles YouTube sign-in.
import { existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { checkRepo, discover } from "../pipeline/check.ts";
import { parseRepoUrl } from "../pipeline/ctx.ts";
import { connectYoutube, disconnectYoutube, uploadVideo, youtubeStatus } from "../pipeline/youtube.ts";
import { TRENDING_PERIODS, type Check, type FinalMeta, type Health, type Mode, type VideoKind } from "../shared/types.ts";
import index from "../../web/index.html";
import { loadConfig } from "./config.ts";
import { Runner } from "./runner.ts";
import { Store } from "./store.ts";

const config = loadConfig();
const store = new Store(config);
const runner = new Runner(config, store);
await runner.recover();

const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Response => json({ error, ...extra }, status);

// A page on another origin must not be able to start runs or uploads through the user's browser.
function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && new URL(origin).host !== req.headers.get("host");
}

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

async function ok(cmd: string[]): Promise<boolean> {
  try {
    return (await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited) === 0;
  } catch {
    return false;
  }
}

async function health(): Promise<Health> {
  const k = config.kokoro;
  const kokoroFiles = [k.python, k.model, k.voices];
  const missing = kokoroFiles.filter(f => !existsSync(f));
  const docker = await ok(["docker", "info"]);
  const yt = await youtubeStatus(config);
  const check = (good: boolean, yes: string, no: string): Check => ({ ok: good, detail: good ? yes : no });
  return {
    docker: check(docker, "Docker is running", "Start Docker Desktop"),
    sandboxImage: check(docker && (await ok(["docker", "image", "inspect", config.sandboxImage])), "Sandbox image is ready", "The sandbox image is built automatically on the first run"),
    ffmpeg: check(await ok(["ffmpeg", "-version"]), "ffmpeg found", "Install ffmpeg: brew install ffmpeg"),
    chrome: check(existsSync(config.chrome), "Chrome found", "Chrome for Testing is missing: bunx puppeteer browsers install chrome"),
    kokoro: check(missing.length === 0, "Local Kokoro voice is ready", `Missing: ${missing.join(", ")}`),
    gateway: check(config.gateway.key !== "" && config.gateway.url !== "" && config.gateway.model !== "", "Model gateway is configured", "Set GATEWAY_URL, GATEWAY_API_KEY and GATEWAY_MODEL in .env"),
    youtube: check(yt.connected, yt.channelTitle ? `Connected as ${yt.channelTitle}` : "Connected", yt.configured ? "Not connected. Videos can still be made." : "No YT_CLIENT_ID and YT_CLIENT_SECRET in .env. Videos can still be made."),
    settingsDir: config.settingsDir,
  };
}

// ---- run files: only rendered outputs and screenshots, never run.json, logs or inputs ----
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png" };
const PUBLIC_PREFIXES = ["final/", "test/shots/", "test/rec/", "shots/"];

function serveFile(req: Request, id: string, rel: string): Response {
  const dir = store.dir(id);
  const target = resolve(dir, rel);
  const type = MIME[extname(rel).toLowerCase()];
  if (!type || !PUBLIC_PREFIXES.some(p => rel.startsWith(p)) || !target.startsWith(dir + sep) || !existsSync(target)) return fail(404, "Not found");
  const size = statSync(target).size;
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (new URL(req.url).searchParams.has("download")) headers["content-disposition"] = `attachment; filename="${rel.split("/").join("-")}"`;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) return new Response(Bun.file(target), { headers: { ...headers, "content-length": String(size) } });
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(Bun.file(target).slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
}

// ---- live events: replay everything stored, then stream; Last-Event-ID resumes ----
function eventStream(req: Request, id: string): Response {
  const enc = new TextEncoder();
  let stop = (): void => {};
  const stream = new ReadableStream({
    start(c) {
      let last = Number(req.headers.get("last-event-id") ?? -1);
      const send = (ev: { seq: number }): void => {
        if (ev.seq <= last) return;
        last = ev.seq;
        c.enqueue(enc.encode(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`));
      };
      const unsubscribe = runner.subscribe(id, send);
      for (const ev of store.events(id)) send(ev);
      const ping = setInterval(() => c.enqueue(enc.encode(": ping\n\n")), 15000);
      stop = () => {
        unsubscribe();
        clearInterval(ping);
      };
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}

const uploading = new Set<string>();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  idleTimeout: 120,
  routes: {
    "/": index,
    "/api/health": async () => json(await health()),
    "/api/check": async req => {
      const repo = parseRepoUrl(new URL(req.url).searchParams.get("repo") ?? "");
      if (!repo) return fail(400, "That is not a GitHub repo URL. Use https://github.com/owner/repo");
      try {
        return json(await checkRepo(config, repo.owner, repo.name));
      } catch (e) {
        return fail(502, e instanceof Error ? e.message : String(e));
      }
    },
    "/api/discover": req => {
      const since = new URL(req.url).searchParams.get("since") ?? "";
      const period = TRENDING_PERIODS.find(p => p === since);
      if (!period) return fail(400, "since must be daily or weekly");
      return json(discover(config, period));
    },
    "/api/runs": {
      GET: () => json(store.list()),
      POST: async req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        const b = await body<{ repo: string; mode: Mode; autoUpload: boolean }>(req);
        const repo = parseRepoUrl(String(b.repo ?? ""));
        if (!repo) return fail(400, "That is not a GitHub repo URL. Use https://github.com/owner/repo");
        if (b.mode !== "test" && b.mode !== "explain") return fail(400, "mode must be test or explain");
        if (runner.activeId) return fail(409, "A run is already in progress. Wait for it to finish or cancel it.", { covered: { runId: runner.activeId } });
        const run = store.create(repo, b.mode, b.autoUpload === true);
        runner.start(run);
        return json(run);
      },
      // Deletes every finished run folder. The active run and runs being uploaded are kept.
      DELETE: req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        let deleted = 0;
        let kept = 0;
        for (const run of store.list()) {
          if (run.id === runner.activeId || [...uploading].some(k => k.startsWith(`${run.id}:`))) {
            kept++;
          } else if (store.remove(run.id)) {
            runner.forget(run.id);
            deleted++;
          }
        }
        return json({ deleted, kept });
      },
    },
    "/api/runs/:id": {
      GET: req => json(store.detail(req.params.id) ?? { error: "Run not found" }, store.get(req.params.id) ? 200 : 404),
      DELETE: req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        const id = req.params.id;
        if (id === runner.activeId) return fail(409, "This run is in progress. Cancel it first.");
        if ([...uploading].some(k => k.startsWith(`${id}:`))) return fail(409, "This run is being uploaded. Wait for the upload to finish.");
        if (!store.remove(id)) return fail(404, "Run not found");
        runner.forget(id);
        return json({ deleted: 1 });
      },
    },
    "/api/runs/:id/events": (req, srv) => {
      if (!store.get(req.params.id)) return fail(404, "Run not found");
      srv.timeout(req, 0);
      return eventStream(req, req.params.id);
    },
    "/api/runs/:id/cancel": {
      POST: req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        if (!runner.cancel(req.params.id)) return fail(409, "This run is not active");
        return json({ cancelling: true });
      },
    },
    "/api/runs/:id/retry": {
      POST: req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        try {
          return json(runner.retry(req.params.id));
        } catch (e) {
          return fail(409, e instanceof Error ? e.message : String(e));
        }
      },
    },
    "/api/runs/:id/files/*": req => serveFile(req, req.params.id, decodeURIComponent(new URL(req.url).pathname.split("/files/")[1] ?? "")),
    "/api/runs/:id/thumbnail": {
      POST: async req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        const b = await body<{ kind: VideoKind; index: number }>(req);
        const meta = b.kind ? store.meta(req.params.id, b.kind) : undefined;
        if (!meta) return fail(404, "No finished video of that kind");
        if (!Number.isInteger(b.index) || !b.index || b.index < 1 || b.index > 3) return fail(400, "index must be 1, 2 or 3");
        const next: FinalMeta = { ...meta, thumbnail: b.index };
        store.saveMeta(req.params.id, next);
        return json(next);
      },
    },
    "/api/runs/:id/title": {
      POST: async req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        const b = await body<{ kind: VideoKind; title: string }>(req);
        const meta = b.kind ? store.meta(req.params.id, b.kind) : undefined;
        if (!meta) return fail(404, "No finished video of that kind");
        const title = String(b.title ?? "").trim();
        if (!title || title.length > 100) return fail(400, "A title is 1 to 100 characters");
        const next: FinalMeta = { ...meta, title };
        store.saveMeta(req.params.id, next);
        return json(next);
      },
    },
    "/api/runs/:id/upload": {
      POST: async (req, srv) => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        srv.timeout(req, 0);
        const id = req.params.id;
        const b = await body<{ kind: VideoKind; privacy: "private" | "unlisted" | "public"; publishAt: string }>(req);
        if (!b.kind || !store.meta(id, b.kind)) return fail(404, "No finished video of that kind");
        if (b.privacy !== "private" && b.privacy !== "unlisted" && b.privacy !== "public") return fail(400, "privacy must be private, unlisted or public");
        const opts: { privacy: "private" | "unlisted" | "public"; publishAt?: string } = { privacy: b.privacy };
        if (b.publishAt) {
          if (!(Date.parse(b.publishAt) > Date.now())) return fail(400, "The publish time must be in the future");
          opts.publishAt = new Date(b.publishAt).toISOString();
        }
        const existing = store.detail(id)?.uploads.find(u => u.kind === b.kind);
        if (existing) return fail(409, `Already uploaded: ${existing.url}`);
        const key = `${id}:${b.kind}`;
        if (uploading.has(key)) return fail(409, "This upload is already running");
        uploading.add(key);
        try {
          return json(await uploadVideo(store.dir(id), config, b.kind, opts));
        } catch (e) {
          return fail(502, e instanceof Error ? e.message : String(e));
        } finally {
          uploading.delete(key);
        }
      },
    },
    "/api/youtube": async () => json(await youtubeStatus(config)),
    "/api/youtube/connect": {
      POST: async req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        try {
          const { url, done } = await connectYoutube(config);
          done.catch(() => {});
          return json({ url });
        } catch (e) {
          return fail(400, e instanceof Error ? e.message : String(e));
        }
      },
    },
    "/api/youtube/disconnect": {
      POST: async req => {
        if (crossSite(req)) return fail(403, "Cross-site request refused");
        await disconnectYoutube(config);
        return json(await youtubeStatus(config));
      },
    },
  },
  fetch: () => fail(404, "Not found"),
  development: process.env.NODE_ENV !== "production",
});

console.log(`Testreel running at http://127.0.0.1:${server.port}`);
console.log(`Settings from ${config.settingsDir}, data in ${config.dataDir}`);
