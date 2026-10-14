import type { Metric, RunEvent, RunStatus, Score, StageId, StageState, VideoKind } from "../../src/shared/types.ts";

export interface StageLive {
  state: StageState;
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}
export interface SandboxStep {
  n: number;
  note?: string;
  cmd?: string;
  cmdAt?: number;
  out?: string;
  exit?: number;
  secs?: number;
}
export interface LiveShot {
  file: string;
  caption: string;
  afterStep: number;
}
export interface LogLine {
  seq: number;
  t: number;
  stage: StageId;
  text: string;
}
export interface ProgressInfo {
  pct: number;
  label: string;
  end?: "done" | "failed";
}
export interface LiveState {
  lastSeq: number;
  status?: RunStatus;
  error?: string;
  stages: Partial<Record<StageId, StageLive>>;
  logs: LogLine[];
  progress: Partial<Record<`${StageId}:${VideoKind | "all"}`, ProgressInfo>>;
  container?: { name: string; running: boolean };
  steps: SandboxStep[];
  shots: LiveShot[];
  metrics: Metric[];
  score?: Score;
}

export const emptyLive: LiveState = { lastSeq: -1, stages: {}, logs: [], progress: {}, steps: [], shots: [], metrics: [] };

const MAX_LOG_LINES = 600;

function upsertStep(steps: SandboxStep[], n: number, patch: Partial<SandboxStep>): SandboxStep[] {
  const i = steps.findIndex(s => s.n === n);
  if (i === -1) return [...steps, { n, ...patch }].sort((a, b) => a.n - b.n);
  return steps.map((s, k) => (k === i ? { ...s, ...patch } : s));
}

export function reduceEvent(state: LiveState, ev: RunEvent): LiveState {
  if (ev.seq <= state.lastSeq) return state;
  const next: LiveState = { ...state, lastSeq: ev.seq };
  switch (ev.kind) {
    case "stage": {
      const prev = state.stages[ev.stage];
      const live: StageLive = { state: ev.state, detail: ev.detail };
      if (ev.state === "running") live.startedAt = ev.t;
      else {
        live.startedAt = prev?.startedAt;
        live.endedAt = ev.t;
      }
      next.stages = { ...state.stages, [ev.stage]: live };
      if (ev.state === "done" || ev.state === "failed") {
        const label = ev.stage === "sandbox" ? `${state.steps.length} commands` : ev.stage === "script" ? "Written" : "Ready";
        next.progress = Object.fromEntries(
          Object.entries(state.progress).map(([key, info]) => {
            if (!key.startsWith(`${ev.stage}:`) || !info) return [key, info];
            return [key, ev.state === "done" ? { pct: 100, label, end: "done" } : { ...info, end: "failed" }];
          }),
        );
      }
      if (ev.state === "running") {
        next.progress = Object.fromEntries(Object.entries(state.progress).filter(([key]) => !key.startsWith(`${ev.stage}:`)));
        if (ev.stage === "sandbox") {
          next.steps = [];
          next.shots = [];
          next.metrics = [];
        }
        if (ev.stage === "score") next.score = undefined;
      }
      return next;
    }
    case "log":
      next.logs = [...state.logs, { seq: ev.seq, t: ev.t, stage: ev.stage, text: ev.text }].slice(-MAX_LOG_LINES);
      return next;
    case "progress":
      if (state.stages[ev.stage]?.state === "done" || state.stages[ev.stage]?.state === "failed") return next;
      next.progress = { ...state.progress, [`${ev.stage}:${ev.video ?? "all"}`]: { pct: ev.pct, label: ev.label } };
      return next;
    case "sandbox":
      next.container = { name: ev.container, running: ev.phase === "start" };
      return next;
    case "agent-note":
      next.steps = upsertStep(state.steps, ev.n, { note: ev.text });
      return next;
    case "cmd":
      next.steps = upsertStep(state.steps, ev.n, { cmd: ev.cmd, cmdAt: ev.t });
      return next;
    case "cmd-out":
      next.steps = upsertStep(state.steps, ev.n, { out: ev.out, exit: ev.exit, secs: ev.secs });
      return next;
    case "metric":
      next.metrics = [...state.metrics.filter(m => m.id !== ev.metric.id), ev.metric];
      return next;
    case "shot":
      next.shots = [...state.shots, { file: ev.file, caption: ev.caption, afterStep: state.steps.at(-1)?.n ?? 0 }];
      return next;
    case "score":
      next.score = ev.score;
      return next;
    case "run":
      next.status = ev.status;
      next.error = ev.error;
      return next;
    case "artifact":
      return next;
  }
}
