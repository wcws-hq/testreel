import type { RunStatus, Verdict } from "../../src/shared/types.ts";
import { LiveDot, VERDICT_COLOR } from "./common.tsx";

const STATUS_TEXT: Record<RunStatus, string> = { queued: "Queued", running: "Running", done: "Finished", failed: "Failed", cancelled: "Cancelled" };

export function StatusChip({ status }: { status: RunStatus }) {
  return (
    <span className={`status status-${status}`}>
      {status === "running" ? <LiveDot /> : <span className="status-dot" />}
      {STATUS_TEXT[status]}
    </span>
  );
}

export function VerdictTag({ verdict, average }: { verdict: Verdict; average?: number }) {
  return (
    <span className="verdict-tag" style={{ color: VERDICT_COLOR[verdict], borderColor: `color-mix(in srgb, ${VERDICT_COLOR[verdict]} 45%, transparent)` }}>
      {verdict}
      {average === undefined ? null : <span className="verdict-tag-score tnum">{average.toFixed(1)}</span>}
    </span>
  );
}
