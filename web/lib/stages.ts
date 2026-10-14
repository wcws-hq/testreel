import { STAGES, type RunDetail, type StageId, type StageState } from "../../src/shared/types.ts";
import type { LiveState } from "./liveState.ts";

export const STAGE_SHORT: Record<StageId, string> = {
  repo: "Repo",
  sandbox: "Sandbox",
  triage: "Triage",
  score: "Score",
  capture: "Screens",
  script: "Script",
  voice: "Voice",
  render: "Render",
  thumbnails: "Thumbnails",
  package: "Package",
};

export interface StageView {
  id: StageId;
  state: StageState;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
  error?: string;
}

// Live events win over the last fetched snapshot because they are never older.
export function mergeStages(detail: RunDetail | null, live: LiveState): StageView[] {
  return STAGES.map(id => {
    const fetched = detail?.run.stages[id];
    const seen = live.stages[id];
    return {
      id,
      state: seen?.state ?? fetched?.state ?? "pending",
      startedAt: seen?.startedAt ?? fetched?.startedAt,
      endedAt: seen?.endedAt ?? fetched?.endedAt,
      detail: seen?.detail,
      error: fetched?.error,
    };
  });
}
