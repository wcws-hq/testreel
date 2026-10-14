import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { STAGE_LABEL } from "../../src/shared/types.ts";
import { api } from "../api.ts";
import { useNow } from "../hooks/useData.ts";
import { useRunLive } from "../hooks/useRunLive.ts";
import { mergeStages } from "../lib/stages.ts";
import { ActivityLog } from "./ActivityLog.tsx";
import { Icon } from "./Icon.tsx";
import { Results } from "./Results.tsx";
import { RunHeader } from "./RunHeader.tsx";
import { SandboxPanel } from "./SandboxPanel.tsx";
import { ScoreReveal } from "./ScoreReveal.tsx";
import { ScriptPreview } from "./ScriptPreview.tsx";
import { StageRail } from "./StageRail.tsx";
import { UploadPanel } from "./UploadPanel.tsx";
import { TriageCard } from "./TriageCard.tsx";
import { Section } from "./common.tsx";

const UPLOAD_WATCH_MS = 5 * 60_000;
const UPLOAD_POLL_MS = 5000;

export function RunPage({ id }: { id: string }) {
  const { detail, loadError, live, connection, refresh, patchMeta, addUpload } = useRunLive(id);
  const run = detail?.run;
  const status = live.status ?? run?.status;
  const active = status === "running" || status === "queued";
  const now = useNow(active, 500);
  const stages = useMemo(() => mergeStages(detail, live), [detail, live]);

  const score = live.score ?? detail?.score;
  const metaKinds = detail ? (["full", "short"] as const).filter(k => detail.meta[k]).length : 0;
  const awaitingUpload =
    run !== undefined && run.autoUpload && status === "done" && metaKinds > (detail?.uploads.length ?? 0) && Date.now() - (run.endedAt ?? 0) < UPLOAD_WATCH_MS;

  useEffect(() => {
    if (!awaitingUpload) return;
    const timer = window.setInterval(() => void refresh(), UPLOAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [awaitingUpload, refresh]);

  useEffect(() => {
    document.title = run ? `${run.owner}/${run.name} - Testreel` : "Testreel";
    return () => {
      document.title = "Testreel";
    };
  }, [run]);

  if (loadError) {
    return (
      <div className="empty-state">
        <Icon name="alert" size={22} />
        <p>{loadError}</p>
        <a className="btn" href="#/">
          Back to all runs
        </a>
      </div>
    );
  }

  const failedStage = stages.find(s => s.state === "failed");
  const failureMessage = live.error ?? run?.error ?? failedStage?.error;
  const refused = status === "failed" && failedStage?.id === "triage";
  const finished = status === "done";
  const sandboxStage = stages.find(s => s.id === "sandbox");
  const elapsedMs = run ? (active ? now : (run.endedAt ?? now)) - run.createdAt : 0;

  const onCancel = async (): Promise<void> => {
    await api.cancel(id);
    await refresh();
  };
  const onRetry = async (): Promise<void> => {
    await api.retry(id);
    await refresh();
  };

  const triageCard = detail?.triage?.runnable ? <TriageCard key="triage" triage={detail.triage} /> : null;
  const sandbox =
    run?.mode === "test" && sandboxStage && !refused ? (
      <SandboxPanel key="sandbox" runId={id} steps={live.steps} shots={live.shots} metrics={live.metrics} log={detail?.log} container={live.container} stageState={sandboxStage.state} startOpen={!finished} now={now} />
    ) : run?.mode === "explain" ? (
      <Section key="explain" title="Explain only">
        <p className="prose">Nothing was installed or run for this video. The script describes the project from its README and repository page and never says it was tested.</p>
      </Section>
    ) : null;

  const sections: ReactNode[] = finished
    ? [
        detail ? <Results key="results" detail={detail} onMeta={patchMeta} /> : null,
        detail ? <UploadPanel key="upload" detail={detail} onUploaded={addUpload} /> : null,
        score ? <ScoreReveal key="score" score={score} /> : null,
        triageCard,
        sandbox,
        detail?.scripts ? <ScriptPreview key="script" scripts={detail.scripts} /> : null,
        <ActivityLog key="log" lines={live.logs} running={false} />,
      ]
    : [
        triageCard,
        sandbox,
        score ? <ScoreReveal key="score" score={score} /> : null,
        detail?.scripts ? <ScriptPreview key="script" scripts={detail.scripts} /> : null,
        <ActivityLog key="log" lines={live.logs} running={active} />,
      ];

  return (
    <div className="run">
      <RunHeader run={run} repo={detail?.repo} status={status} elapsedMs={elapsedMs} connection={connection} onCancel={onCancel} onRetry={onRetry} refused={refused} />

      <AnimatePresence>
        {refused ? (
          <motion.div className="banner banner-refused" role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Icon name="alert" size={18} />
            <div>
              <strong>Testreel did not run this repo</strong>
              {failureMessage ? <p className="banner-reason">{failureMessage}</p> : null}
              <p className="banner-note">Testreel only runs ordinary apps that deploy without keys or GPUs.</p>
              <a className="btn btn-sm" href="#/">
                Try another repo
              </a>
            </div>
          </motion.div>
        ) : status === "failed" || status === "cancelled" ? (
          <motion.div className={`banner banner-${status}`} role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Icon name={status === "failed" ? "alert" : "x"} size={18} />
            <div>
              <strong>
                {status === "failed" ? (failedStage ? `Failed while ${STAGE_LABEL[failedStage.id].toLowerCase()}` : "This run failed") : "This run was cancelled"}
              </strong>
              {status === "failed" && failureMessage ? <p>{failureMessage}</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="run-layout">
        <aside className="run-rail">
          <StageRail stages={stages} progress={live.progress} now={now} />
        </aside>
        <div className="run-main">{sections}</div>
      </div>
    </div>
  );
}
