// Child process helpers shared by the render and sound modules. Every process dies with the abort signal.
export const FFMPEG = Bun.which("ffmpeg") ?? "ffmpeg";
export const FFPROBE = Bun.which("ffprobe") ?? "ffprobe";

export function cancelled(): Error {
  return new Error("cancelled");
}

// Runs a command to completion and returns its stdout. Rejects with the tail of stderr on failure, "cancelled" on abort.
export async function spawnCollect(cmd: string, args: string[], signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) throw cancelled();
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const kill = () => proc.kill();
  signal.addEventListener("abort", kill, { once: true });
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b)), new Response(proc.stderr).text(), proc.exited]);
    if (signal.aborted) throw cancelled();
    if (code !== 0) throw new Error(`${cmd} exited ${code}: ${err.trim().slice(-400)}`);
    return out;
  } finally {
    signal.removeEventListener("abort", kill);
  }
}

export async function probeSeconds(file: string, signal: AbortSignal): Promise<number> {
  const out = await spawnCollect(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], signal);
  const seconds = Number.parseFloat(new TextDecoder().decode(out));
  if (!Number.isFinite(seconds)) throw new Error(`could not read the duration of ${file}`);
  return seconds;
}
