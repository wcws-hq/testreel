// On-disk run store: <dataDir>/runs/<id>/{run.json, events.jsonl, ...stage outputs}
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../pipeline/ctx.ts";
import { STAGES, type Triage, type FinalMeta, type Mode, type Run, type RunDetail, type RunEvent, type RepoInfo, type Score, type Scripts, type TestLog, type UploadRecord, type VideoKind } from "../shared/types.ts";
import type { Config } from "./config.ts";

export class Store {
  readonly runsDir: string;

  constructor(config: Config) {
    this.runsDir = join(config.dataDir, "runs");
    mkdirSync(this.runsDir, { recursive: true });
  }

  dir(id: string): string {
    return join(this.runsDir, id);
  }

  create(repo: { url: string; owner: string; name: string }, mode: Mode, autoUpload: boolean): Run {
    const id = `${repo.owner}-${repo.name}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const stages = Object.fromEntries(STAGES.map(s => [s, { state: "pending" }])) as Run["stages"];
    const run: Run = { id, repoUrl: repo.url, owner: repo.owner, name: repo.name, mode, autoUpload, status: "queued", stage: null, stages, createdAt: Date.now() };
    mkdirSync(this.dir(id), { recursive: true });
    this.save(run);
    return run;
  }

  save(run: Run): void {
    writeFileSync(join(this.dir(run.id), "run.json"), JSON.stringify(run, null, 2));
  }

  get(id: string): Run | null {
    const f = join(this.dir(id), "run.json");
    return existsSync(f) ? readJson<Run>(f) : null;
  }

  list(): Run[] {
    return readdirSync(this.runsDir)
      .map(id => this.get(id))
      .filter((r): r is Run => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Deletes the run folder: renders, thumbnails, screenshots, recordings, logs, everything. Returns false when there is no such run.
  remove(id: string): boolean {
    if (!/^[a-z0-9-]+$/.test(id) || !this.get(id)) return false;
    rmSync(this.dir(id), { recursive: true, force: true });
    return true;
  }

  appendEvent(id: string, ev: RunEvent): void {
    appendFileSync(join(this.dir(id), "events.jsonl"), JSON.stringify(ev) + "\n");
  }

  events(id: string): RunEvent[] {
    const f = join(this.dir(id), "events.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as RunEvent);
  }

  private optional<T>(id: string, rel: string): T | undefined {
    const f = join(this.dir(id), rel);
    return existsSync(f) ? readJson<T>(f) : undefined;
  }

  meta(id: string, kind: VideoKind): FinalMeta | undefined {
    return this.optional<FinalMeta>(id, `final/${kind}/meta.json`);
  }

  saveMeta(id: string, meta: FinalMeta): void {
    writeFileSync(join(this.dir(id), `final/${meta.kind}/meta.json`), JSON.stringify(meta, null, 2));
  }

  detail(id: string): RunDetail | null {
    const run = this.get(id);
    if (!run) return null;
    const detail: RunDetail = {
      run,
      meta: {},
      uploads: this.optional<UploadRecord[]>(id, "uploads.json") ?? [],
      files: { video: {}, thumbs: {} },
    };
    const repo = this.optional<RepoInfo>(id, "repo.json");
    const triage = this.optional<Triage>(id, "triage.json");
    if (triage) detail.triage = triage;
    const log = this.optional<TestLog>(id, "test/log.json");
    const score = this.optional<Score>(id, "score.json");
    const scripts = this.optional<Scripts>(id, "scripts.json");
    if (repo) detail.repo = repo;
    if (log) detail.log = log;
    if (score) detail.score = score;
    if (scripts) detail.scripts = scripts;
    for (const kind of ["full", "short"] as const) {
      const meta = this.meta(id, kind);
      if (meta) detail.meta[kind] = meta;
      if (existsSync(join(this.dir(id), `final/${kind}/video.mp4`))) detail.files.video[kind] = `final/${kind}/video.mp4`;
      const thumbs = [1, 2, 3].map(n => `final/${kind}/thumb-${n}.jpg`).filter(p => existsSync(join(this.dir(id), p)));
      if (thumbs.length) detail.files.thumbs[kind] = thumbs;
    }
    return detail;
  }
}
