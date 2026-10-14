// Docker plumbing for the sandbox stage: the CLI wrapper, command execution inside the container, the disk-use watchdog and the cleanup after a run.
// Everything here only ever touches containers named testreel-* and images this module saw being created.
import type { RunCtx } from "./ctx.ts";

export const CONTAINER_PREFIX = "testreel-";
export const PORT_RANGE = "18000-18009";
export const HOME = "/home/node";
export const APP_DIR = `${HOME}/app`;

const OUT_HEAD = 1200;
const OUT_TAIL = 1800;
const CAPTURE_EDGE = 20000; // raw characters kept from each end of a command's output while it streams
const DISK_POLL_MS = 4000;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

interface DockerResult {
  code: number;
  text: string;
  timedOut: boolean;
}

interface DockerOptions {
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

// Runs the docker CLI, merging stdout and stderr. Keeps only the head and tail of very long output.
export async function docker(args: string[], o: DockerOptions = {}): Promise<DockerResult> {
  const spawnOpts: Parameters<typeof Bun.spawn>[1] = { stdout: "pipe", stderr: "pipe", stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]) };
  if (o.signal) spawnOpts.signal = o.signal;
  const proc = Bun.spawn(["docker", ...args], spawnOpts) as Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">;
  let head = "";
  let tail = "";
  let dropped = 0;
  let pending = "";
  let timedOut = false;
  const timer = o.timeoutMs ? setTimeout(() => ((timedOut = true), proc.kill()), o.timeoutMs) : undefined;

  const feed = (t: string): void => {
    if (head.length < CAPTURE_EDGE) {
      const room = CAPTURE_EDGE - head.length;
      head += t.slice(0, room);
      t = t.slice(room);
    }
    if (t) {
      tail += t;
      if (tail.length > CAPTURE_EDGE) {
        dropped += tail.length - CAPTURE_EDGE;
        tail = tail.slice(-CAPTURE_EDGE);
      }
    }
  };
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const dec = new TextDecoder();
    for await (const chunk of stream) {
      const t = dec.decode(chunk, { stream: true });
      feed(t);
      if (o.onLine) {
        pending += t;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const l of lines) o.onLine(l);
      }
    }
  };
  try {
    await Promise.all([drain(proc.stdout), drain(proc.stderr), proc.exited]);
  } finally {
    clearTimeout(timer);
  }
  if (o.onLine && pending) o.onLine(pending);
  const text = dropped > 0 ? `${head}\n[... ${dropped} characters of output skipped ...]\n${tail}` : head + tail;
  return { code: proc.exitCode ?? 137, text, timedOut };
}

// Terminal output as a person would see it: no colour codes, progress bars collapsed to their last state, head and tail only.
export function tidy(raw: string): string {
  const text = raw
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.replace(/\r+$/, "").split("\r").pop() ?? "")
    .join("\n")
    .trim();
  if (text.length <= OUT_HEAD + OUT_TAIL) return text;
  return `${text.slice(0, OUT_HEAD)}\n[... ${text.length - OUT_HEAD - OUT_TAIL} characters trimmed ...]\n${text.slice(-OUT_TAIL)}`;
}

export interface ExecResult {
  code: number; // 124 when the command was stopped for running too long
  raw: string; // head and tail of the output, untouched
  secs: number;
  timedOut: boolean;
}

// Runs a bash script (piped to `bash -s`, so heredocs work) in the container as user node. Killed after `limitSecs`.
export async function containerExec(name: string, script: string, limitSecs: number, signal: AbortSignal, cwd = HOME): Promise<ExecResult> {
  const ts = Date.now();
  const r = await docker(["exec", "-i", "-u", "node", "-w", cwd, name, "bash", "-c", `timeout -k 5 ${limitSecs} bash -s 2>&1`], {
    stdin: `${script}\n`,
    signal,
    timeoutMs: (limitSecs + 10) * 1000,
  });
  const timedOut = r.timedOut || r.code === 124 || r.code === 137;
  return { code: timedOut ? 124 : r.code, raw: r.text, secs: Math.round((Date.now() - ts) / 100) / 10, timedOut };
}

export async function ensureImage(ctx: RunCtx): Promise<boolean> {
  const image = ctx.config.sandboxImage;
  if ((await docker(["image", "inspect", image], { signal: ctx.signal })).code === 0) return false;
  ctx.log("sandbox", `Image ${image} not found, building it (first run only)`);
  const res = await docker(
    ["build", "--progress=plain", "-t", image, "-f", `${ctx.config.appDir}/docker/sandbox.Dockerfile`, `${ctx.config.appDir}/docker`],
    {
      signal: ctx.signal,
      onLine: (l) => {
        const line = l.replace(ANSI, "").trim();
        if (line) ctx.log("sandbox", line.slice(0, 200));
      },
    },
  );
  if (ctx.signal.aborted) throw new Error("cancelled");
  if (res.code !== 0) throw new Error(`Building the sandbox image failed (exit ${res.code}). Is Docker running?`);
  ctx.log("sandbox", `Image ${image} is ready`);
  return true;
}

// Force-removes every sandbox container (and its anonymous volumes) this app may have left behind.
export async function killSandboxes(): Promise<void> {
  const ps = await docker(["ps", "-a", "--format", "{{.Names}}"]);
  const names = ps.text.split("\n").map((n) => n.trim()).filter((n) => n.startsWith(CONTAINER_PREFIX));
  if (names.length > 0) await docker(["rm", "-fv", ...names]);
}

// Bytes the container has written to its own layer (what a runaway install would fill), or null when it cannot be read.
async function containerDiskBytes(name: string): Promise<number | null> {
  const r = await docker(["container", "inspect", "--size", "-f", "{{.SizeRw}}", name]);
  const n = Number(r.text.trim());
  return r.code === 0 && Number.isFinite(n) ? n : null;
}

// Polls the container's disk use; calls onExceed once when it passes the cap. Returns a stop function that also gives the last reading.
export function watchDisk(name: string, capBytes: number, onExceed: (bytes: number) => void): () => number {
  let stopped = false;
  let last = 0;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      const bytes = await containerDiskBytes(name);
      if (stopped) return;
      if (bytes !== null) {
        last = bytes;
        if (bytes > capBytes) return onExceed(bytes);
      }
      await Bun.sleep(DISK_POLL_MS);
    }
  };
  void loop();
  return () => ((stopped = true), last);
}

export async function danglingImageIds(): Promise<Set<string>> {
  const r = await docker(["images", "--filter", "dangling=true", "--format", "{{.ID}}"]);
  return new Set(r.text.split("\n").map((l) => l.trim()).filter(Boolean));
}

// Removes the container with its volumes. When the run built the sandbox image, also drops the build cache and the untagged
// images that build left behind (never the tagged sandbox image, never dangling images that existed before the run).
// Returns the megabytes freed that could be measured.
export async function cleanUp(name: string, lastDiskBytes: number, builtImage: boolean, danglingBefore: Set<string>): Promise<number> {
  const size = (await containerDiskBytes(name)) ?? lastDiskBytes;
  await docker(["rm", "-fv", name]);
  let freed = size;
  if (builtImage) {
    await docker(["builder", "prune", "-f"]);
    const fresh = [...(await danglingImageIds())].filter((id) => !danglingBefore.has(id));
    if (fresh.length > 0) await docker(["image", "rm", ...fresh]);
  }
  return Math.round(freed / 1e6);
}
