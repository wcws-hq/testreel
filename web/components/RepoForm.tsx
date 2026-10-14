import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Health, Mode, RepoCheck } from "../../src/shared/types.ts";
import { api, ApiError } from "../api.ts";
import { blockingChecks } from "../lib/health.ts";
import { parseRepoUrl } from "../lib/repoUrl.ts";
import { runHref } from "../hooks/useRoute.ts";
import { Icon } from "./Icon.tsx";
import { Spinner } from "./common.tsx";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "test", label: "Test it in Docker", hint: "Deploys the repo in a throwaway container, uses it for real while recording the screen, then scores what it measured." },
  { value: "explain", label: "Explain only", hint: "Reads the README and the repo page. Nothing is run and nothing is claimed as tested." },
];

type CheckState = { status: "idle" } | { status: "checking" } | { status: "done"; result: RepoCheck } | { status: "error"; message: string };

interface Props {
  health: Health | null;
  mode: Mode;
  onMode: (mode: Mode) => void;
  autoUpload: boolean;
  onAutoUpload: (value: boolean) => void;
  value: string;
  onValue: (value: string) => void;
}

export function RepoForm({ health, mode, onMode, autoUpload, onAutoUpload, value, onValue }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; runId?: string } | null>(null);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  const parsed = useMemo(() => parseRepoUrl(value), [value]);
  const url = parsed?.url ?? null;
  const touched = value.trim().length > 0;
  const blockers = health ? blockingChecks(health, mode, autoUpload) : [];
  // Only a finished check that says no blocks a test run. A check that could not be made does not: the run triages again anyway.
  const refused = mode === "test" && check.status === "done" && !check.result.runnable;
  const canSubmit = parsed !== null && health !== null && blockers.length === 0 && !refused && !submitting;

  useEffect(() => {
    if (!url) {
      setCheck({ status: "idle" });
      return;
    }
    setCheck({ status: "checking" });
    let current = true;
    const timer = window.setTimeout(() => {
      api
        .check(url)
        .then(result => current && setCheck({ status: "done", result }))
        .catch((e: unknown) => current && setCheck({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    }, 450);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [url]);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!parsed || !canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const run = await api.createRun(parsed.url, mode, autoUpload);
      location.hash = runHref(run.id);
    } catch (err) {
      setFailure({ message: err instanceof Error ? err.message : String(err), runId: err instanceof ApiError ? err.coveredRunId : undefined });
      setSubmitting(false);
    }
  };

  let helper = "";
  if (health && parsed && blockers.length > 0) helper = `Fix ${blockers.map(b => b.label).join(", ")} to start.`;

  return (
    <form className="repo-form" onSubmit={e => void onSubmit(e)} noValidate>
      <label className={`field ${touched ? (parsed ? "is-valid" : "is-invalid") : ""}`}>
        <span className="field-icon">
          <Icon name="github" size={20} />
        </span>
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repo"
          aria-label="GitHub repository URL"
          value={value}
          onChange={e => {
            onValue(e.target.value);
            setFailure(null);
          }}
        />
        <span className="field-status" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {parsed ? (
              <motion.span key="ok" className="recognised" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <Icon name="check" size={14} />
                <span className="recognised-owner">{parsed.owner}</span>
                <span className="recognised-slash">/</span>
                <span className="recognised-name">{parsed.name}</span>
              </motion.span>
            ) : touched ? (
              <motion.span key="bad" className="unrecognised" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                Not a GitHub repo URL
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>
      </label>

      {check.status !== "idle" ? (
        <p className={`repo-check ${check.status === "done" ? (check.result.runnable ? "is-yes" : "is-no") : check.status === "error" ? "is-error" : ""}`} role="status">
          {check.status === "checking" ? (
            <>
              <Spinner /> Checking whether Testreel can run this repo
            </>
          ) : check.status === "error" ? (
            <>
              <Icon name="alert" size={15} /> Could not check ahead of time ({check.message}). The run checks again when it starts.
            </>
          ) : check.result.runnable ? (
            <>
              <Icon name="check" size={15} /> Testreel can run this {check.result.kind}. {check.result.summary}
            </>
          ) : (
            <>
              <Icon name="x" size={15} /> {check.result.reason}
              {mode === "explain" ? " Explain only still works for it." : ""}
            </>
          )}
        </p>
      ) : null}

      <div className="form-row">
        <div className="seg" role="radiogroup" aria-label="Mode">
          {MODES.map(m => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} className={`seg-item ${mode === m.value ? "is-on" : ""}`} onClick={() => onMode(m.value)}>
              {mode === m.value ? <motion.span layoutId="seg-thumb" className="seg-thumb" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
              <span className="seg-label">{m.label}</span>
            </button>
          ))}
        </div>

        <button type="button" role="switch" aria-checked={autoUpload} className={`switch ${autoUpload ? "is-on" : ""}`} onClick={() => onAutoUpload(!autoUpload)}>
          <span className="switch-track">
            <motion.span className="switch-knob" animate={{ x: autoUpload ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 34 }} />
          </span>
          <span>Upload automatically when ready</span>
        </button>

        <button type="submit" className="glow-btn" disabled={!canSubmit}>
          <span className="glow-btn-inner">
            {submitting ? <Spinner /> : null}
            {submitting ? "Starting" : "Start run"}
            {submitting ? null : <Icon name="arrow" size={16} />}
          </span>
        </button>
      </div>

      <p className="mode-hint">{MODES.find(m => m.value === mode)?.hint}</p>
      {helper ? <p className="form-helper">{helper}</p> : null}

      <AnimatePresence>
        {failure ? (
          <motion.div className="notice notice-fail" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Icon name="alert" size={16} />
            <span>
              {failure.message}
              {failure.runId ? (
                <>
                  {" "}
                  <a className="link" href={runHref(failure.runId)}>
                    Open the active run
                  </a>
                </>
              ) : null}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </form>
  );
}
