import { motion } from "motion/react";
import { useState } from "react";
import { STAGE_LABEL, type Run } from "../../src/shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { useFinishedDetail, useNow } from "../hooks/useData.ts";
import { runHref } from "../hooks/useRoute.ts";
import { timeAgo } from "../lib/format.ts";
import { Spinner } from "./common.tsx";
import { Icon } from "./Icon.tsx";
import { StatusChip, VerdictTag } from "./StatusChip.tsx";

// A trash button that asks once before it acts. `text` set gives a labelled button, otherwise an icon.
function ConfirmDelete({ label, text, onConfirm }: { label: string; text?: string; onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (busy) return <Spinner />;
  if (!asking) {
    return (
      <button type="button" className={`btn btn-ghost btn-sm run-delete ${text ? "" : "is-icon"}`} aria-label={label} title={label} onClick={() => setAsking(true)}>
        <Icon name="trash" size={14} />
        {text}
      </button>
    );
  }
  return (
    <span className="confirm-delete">
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          setBusy(true);
          void onConfirm().finally(() => {
            setBusy(false);
            setAsking(false);
          });
        }}
      >
        Delete
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

function RunCard({ run, index, now, onDelete }: { run: Run; index: number; now: number; onDelete: (id: string) => Promise<void> }) {
  const finished = run.status === "done";
  const detail = useFinishedDetail(run.id, run.status === "done" || run.status === "failed");
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = finished && !thumbFailed;
  const score = detail?.score;

  return (
    <motion.li
      className="run-card-wrap"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * Math.min(index, 8), duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <a className="run-card" href={runHref(run.id)}>
        <div className="run-thumb">
          {showThumb ? (
            <img src={fileUrl(run.id, "final/full/thumb-1.jpg")} alt="" loading="lazy" onError={() => setThumbFailed(true)} />
          ) : (
            <div className="run-thumb-empty">
              <span className="run-thumb-initial">{run.name.slice(0, 1).toUpperCase()}</span>
              {run.status === "running" && run.stage ? <span className="run-thumb-stage">{STAGE_LABEL[run.stage]}</span> : null}
            </div>
          )}
          {score ? (
            <span className="run-thumb-verdict">
              <VerdictTag verdict={score.verdict} average={score.average} />
            </span>
          ) : null}
        </div>
        <div className="run-body">
          <div className="run-title">
            <span className="run-owner">{run.owner}/</span>
            {run.name}
          </div>
          <div className="run-meta">
            <StatusChip status={run.status} />
            <span className="run-mode">{run.mode === "test" ? "Docker test" : "Explain"}</span>
            <span className="run-time">
              <Icon name="clock" size={12} />
              {timeAgo(run.createdAt, now)}
            </span>
          </div>
        </div>
      </a>
      <div className="run-card-actions">
        <ConfirmDelete label={`Delete ${run.owner}/${run.name} and all its files`} onConfirm={() => onDelete(run.id)} />
      </div>
    </motion.li>
  );
}

export function RunCards({ runs, error, onChanged }: { runs: Run[] | null; error: string | null; onChanged: () => void }) {
  const now = useNow(true, 30_000);
  const [failure, setFailure] = useState<string | null>(null);
  if (error) return <p className="notice notice-fail">Could not load recent runs: {error}</p>;
  if (!runs) return null;
  if (runs.length === 0) return <p className="empty">No runs yet. Paste a repo above to make the first one.</p>;

  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    setFailure(null);
    try {
      await action();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
    onChanged();
  };

  return (
    <>
      <div className="runs-toolbar">
        <span>
          {runs.length} {runs.length === 1 ? "run" : "runs"}. Deleting removes the run's videos, thumbnails, recordings and logs from this machine. Videos already on YouTube stay there.
        </span>
        <ConfirmDelete label="Delete all runs and their files" text="Delete all" onConfirm={() => attempt(() => api.deleteAllRuns())} />
      </div>
      {failure ? <p className="notice notice-fail">{failure}</p> : null}
      <ul className="run-grid">
        {runs.map((run, i) => (
          <RunCard key={run.id} run={run} index={i} now={now} onDelete={id => attempt(() => api.deleteRun(id))} />
        ))}
      </ul>
    </>
  );
}
