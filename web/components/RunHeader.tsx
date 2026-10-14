import { useState } from "react";
import type { RepoInfo, Run, RunStatus } from "../../src/shared/types.ts";
import { clock, compactNumber } from "../lib/format.ts";
import type { Connection } from "../hooks/useRunLive.ts";
import { Icon } from "./Icon.tsx";
import { StatusChip } from "./StatusChip.tsx";
import { Spinner } from "./common.tsx";

interface Props {
  run: Run | undefined;
  repo: RepoInfo | undefined;
  status: RunStatus | undefined;
  elapsedMs: number;
  connection: Connection;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  refused: boolean; // triage refused the repo, so running it again cannot change the answer
}

export function RunHeader({ run, repo, status, elapsedMs, connection, onCancel, onRetry, refused }: Props) {
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const act = async (kind: "cancel" | "retry", fn: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const active = status === "running" || status === "queued";

  return (
    <header className="run-header">
      <a className="back" href="#/">
        <Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> All runs
      </a>
      <div className="run-header-main">
        <div className="run-identity">
          {repo?.ownerAvatar ? <img className="avatar" src={repo.ownerAvatar} alt="" width={44} height={44} /> : <span className="avatar avatar-empty" />}
          <div>
            <h1 className="run-name">
              {run ? (
                <>
                  <span className="run-owner">{run.owner}/</span>
                  {run.name}
                </>
              ) : (
                <span className="skeleton" style={{ width: 220, height: 28, display: "inline-block" }} />
              )}
            </h1>
            <div className="run-facts">
              {status ? <StatusChip status={status} /> : null}
              {run ? <span className="pill">{run.mode === "test" ? "Docker test" : "Explain only"}</span> : null}
              {run?.autoUpload ? <span className="pill">Auto upload</span> : null}
              {repo ? (
                <>
                  <span className="fact tnum">
                    <Icon name="star" size={13} /> {compactNumber(repo.stars)}
                  </span>
                  {repo.language ? <span className="fact">{repo.language}</span> : null}
                  {repo.license ? <span className="fact">{repo.license}</span> : null}
                </>
              ) : null}
              <span className="fact tnum" title="Time since the run started">
                <Icon name="clock" size={13} /> {clock(elapsedMs / 1000)}
              </span>
              {connection === "reconnecting" && active ? <span className="pill pill-warn">Reconnecting to the live feed</span> : null}
            </div>
          </div>
        </div>
        <div className="run-actions">
          {active ? (
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void act("cancel", onCancel)}>
              {busy === "cancel" ? <Spinner size={13} /> : <Icon name="x" size={14} />} Cancel run
            </button>
          ) : null}
          {(status === "failed" && !refused) || status === "cancelled" ? (
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void act("retry", onRetry)}>
              {busy === "retry" ? <Spinner size={13} /> : <Icon name="refresh" size={14} />} Retry
            </button>
          ) : null}
        </div>
      </div>
      {repo?.description ? <p className="run-desc">{repo.description}</p> : null}
      <div className="run-sweep" aria-hidden="true">
        {active ? <span /> : null}
      </div>
    </header>
  );
}
