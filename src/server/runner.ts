// Runs the pipeline for one run at a time (Docker, Chrome workers and Kokoro all want the whole machine),
// persists every state change and event, and fans events out to live subscribers.
import type { RunCtx, Stage } from "../pipeline/ctx.ts";
import { captureStage } from "../pipeline/capture.ts";
import { packageStage } from "../pipeline/meta.ts";
import { renderStage } from "../pipeline/video/index.ts";
import { triageStage } from "../pipeline/triage.ts";
import { repoStage } from "../pipeline/repo.ts";
import { killSandboxes, sandboxStage } from "../pipeline/sandbox.ts";
import { scoreStage } from "../pipeline/score.ts";
import { thumbnailsStage } from "../pipeline/thumbnails.ts";
import { scriptStage } from "../pipeline/writer.ts";
import { voiceStage } from "../pipeline/voice.ts";
import { uploadVideo, youtubeStatus } from "../pipeline/youtube.ts";
import { STAGES, type EmitEvent, type Run, type RunEvent, type StageId } from "../shared/types.ts";
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";

const STAGE_FNS: Record<StageId, Stage> = {
  repo: repoStage,
  triage: triageStage,
  sandbox: sandboxStage,
  score: scoreStage,
  capture: captureStage,
  script: scriptStage,
  voice: voiceStage,
  render: renderStage,
  thumbnails: thumbnailsStage,
  package: packageStage,
};
const TEST_ONLY: StageId[] = ["triage", "sandbox", "score"];

type Listener = (ev: RunEvent) => void;

export class Runner {
  private active: { id: string; abort: AbortController } | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private seqs = new Map<string, number>();

  constructor(private config: Config, private store: Store) {}

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  // A server restart kills the pipeline: runs left "running" become failed so they can be retried, and orphaned containers go.
  async recover(): Promise<void> {
    for (const run of this.store.list()) {
      if (run.status !== "running" && run.status !== "queued") continue;
      const stage = run.stage;
      if (stage) run.stages[stage] = { ...run.stages[stage], state: "failed", error: "The server restarted during this stage." };
      run.status = "failed";
      run.error = "The server restarted while this run was in progress. Retry to continue from where it stopped.";
      this.store.save(run);
    }
    await killSandboxes();
  }

  subscribe(id: string, fn: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private push(id: string, e: EmitEvent): void {
    const seq = this.seqs.get(id) ?? this.store.events(id).length;
    this.seqs.set(id, seq + 1);
    const ev = { ...e, seq, t: Date.now() } as RunEvent;
    this.store.appendEvent(id, ev);
    for (const fn of this.listeners.get(id) ?? []) fn(ev);
  }

  start(run: Run): void {
    if (this.active) throw new Error("A run is already active.");
    const abort = new AbortController();
    this.active = { id: run.id, abort };
    void this.execute(run, abort).finally(() => {
      this.active = null;
    });
  }

  cancel(id: string): boolean {
    if (this.active?.id !== id) return false;
    this.active.abort.abort();
    return true;
  }

  // Drops in-memory state of a deleted run.
  forget(id: string): void {
    this.listeners.delete(id);
    this.seqs.delete(id);
  }

  retry(id: string): Run {
    const run = this.store.get(id);
    if (!run || (run.status !== "failed" && run.status !== "cancelled")) throw new Error("Only a failed or cancelled run can be retried.");
    if (this.active) throw new Error("A run is already active.");
    for (const s of STAGES) if (run.stages[s].state === "failed" || run.stages[s].state === "running") run.stages[s] = { state: "pending" };
    delete run.error;
    delete run.endedAt;
    run.status = "queued";
    this.store.save(run);
    this.start(run);
    return run;
  }

  private setStatus(run: Run, status: Run["status"], error?: string): void {
    run.status = status;
    if (error) run.error = error;
    if (status === "done" || status === "failed" || status === "cancelled") run.endedAt = Date.now();
    this.store.save(run);
    this.push(run.id, error ? { kind: "run", status, error } : { kind: "run", status });
  }

  private setStage(run: Run, stage: StageId, state: Run["stages"][StageId]["state"], error?: string): void {
    const prev = run.stages[stage];
    const now = Date.now();
    run.stages[stage] = { ...prev, state, ...(state === "running" ? { startedAt: now } : { endedAt: now }), ...(error ? { error } : {}) };
    run.stage = stage;
    this.store.save(run);
    this.push(run.id, error ? { kind: "stage", stage, state, detail: error } : { kind: "stage", stage, state });
  }

  private async execute(run: Run, abort: AbortController): Promise<void> {
    const dir = this.store.dir(run.id);
    const ctx: RunCtx = {
      run,
      dir,
      config: this.config,
      signal: abort.signal,
      emit: e => this.push(run.id, e),
      log: (stage, text) => this.push(run.id, { kind: "log", stage, text }),
      path: (...p) => `${dir}/${p.join("/")}`,
    };
    this.setStatus(run, "running");
    for (const stage of STAGES) {
      const state = run.stages[stage].state;
      if (state === "done" || state === "skipped") continue;
      if (run.mode === "explain" && TEST_ONLY.includes(stage)) {
        this.setStage(run, stage, "skipped");
        continue;
      }
      this.setStage(run, stage, "running");
      try {
        await STAGE_FNS[stage](ctx);
        if (abort.signal.aborted) throw new Error("cancelled");
        this.setStage(run, stage, "done");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (abort.signal.aborted) {
          this.setStage(run, stage, "failed", "Cancelled");
          this.setStatus(run, "cancelled");
          await killSandboxes();
        } else {
          this.setStage(run, stage, "failed", message);
          this.setStatus(run, "failed", message);
        }
        return;
      }
    }
    this.setStatus(run, "done");
    if (run.autoUpload) await this.autoUpload(ctx);
  }

  // Auto-upload is always private: publishing stays a deliberate click in the UI.
  private async autoUpload(ctx: RunCtx): Promise<void> {
    const yt = await youtubeStatus(this.config);
    if (!yt.connected) {
      ctx.log("package", "Auto upload skipped: YouTube is not connected.");
      return;
    }
    for (const kind of ["full", "short"] as const) {
      try {
        const rec = await uploadVideo(ctx.dir, this.config, kind, { privacy: "private" });
        ctx.log("package", `Uploaded the ${kind === "full" ? "long video" : "Short"} as private: ${rec.url}`);
      } catch (e) {
        ctx.log("package", `Upload of the ${kind === "full" ? "long video" : "Short"} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.push(ctx.run.id, { kind: "run", status: "done" });
  }
}
