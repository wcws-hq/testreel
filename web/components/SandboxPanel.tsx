import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Metric, StageState, TestLog } from "../../src/shared/types.ts";
import { fileUrl } from "../api.ts";
import { seconds } from "../lib/format.ts";
import type { LiveShot, SandboxStep } from "../lib/liveState.ts";
import { Icon } from "./Icon.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { Collapse, LiveDot } from "./common.tsx";
import { MetricChips } from "./Metrics.tsx";

const COLLAPSED_LINES = 10;
const FRESH_MS = 4000;
const LONG_COMMAND_CHARS = 320;
const LONG_COMMAND_LINES = 4;

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

function TypedCommand({ text, animate }: { text: string; animate: boolean }) {
  const [count, setCount] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const perTick = Math.max(1, Math.ceil(text.length / 36));
    const timer = window.setInterval(() => {
      setCount(c => {
        if (c + perTick >= text.length) window.clearInterval(timer);
        return Math.min(text.length, c + perTick);
      });
    }, 26);
    return () => window.clearInterval(timer);
  }, [text, animate]);
  return <>{text.slice(0, count)}</>;
}

function Output({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const clean = useMemo(() => text.replace(ANSI, "").replace(/\s+$/, ""), [text]);
  const lines = useMemo(() => clean.split("\n"), [clean]);
  if (clean.length === 0) return <p className="out-empty">No output</p>;
  const long = lines.length > COLLAPSED_LINES;
  return (
    <div className={`out ${long && !expanded ? "is-collapsed" : ""}`}>
      <pre>{long && !expanded ? lines.slice(0, COLLAPSED_LINES).join("\n") : clean}</pre>
      {long ? (
        <button type="button" className="out-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? "Collapse output" : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
}

function Step({ step, now, isLast, running }: { step: SandboxStep; now: number; isLast: boolean; running: boolean }) {
  const waiting = step.cmd !== undefined && step.exit === undefined && running && isLast;
  const fresh = step.cmdAt !== undefined && step.out === undefined && now - step.cmdAt < FRESH_MS;
  const elapsed = step.cmdAt ? Math.max(0, (now - step.cmdAt) / 1000) : 0;
  const [cmdOpen, setCmdOpen] = useState(false);
  const longCmd = step.cmd !== undefined && (step.cmd.length > LONG_COMMAND_CHARS || step.cmd.split("\n").length > LONG_COMMAND_LINES);
  return (
    <motion.li className="step" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
      <span className="step-n tnum">{String(step.n).padStart(2, "0")}</span>
      <div className="step-body">
        {step.note ? (
          <p className="step-note">
            <span className="step-note-tag">Agent</span>
            {step.note}
          </p>
        ) : null}
        {step.cmd !== undefined ? (
          <div className="step-cmd">
            <span className="prompt">$</span>
            <div className="step-cmd-text">
              <code className={longCmd && !cmdOpen ? "is-clamped" : ""}>
                <TypedCommand text={step.cmd} animate={fresh} />
                {waiting ? <span className="caret" /> : null}
              </code>
              {longCmd ? (
                <button type="button" className="out-toggle" onClick={() => setCmdOpen(v => !v)}>
                  {cmdOpen ? "Collapse command" : "Show full command"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {step.exit !== undefined ? (
          <div className="step-chips">
            <span className={`pill ${step.exit === 0 ? "pill-ok" : "pill-fail"}`}>exit {step.exit}</span>
            {step.secs !== undefined ? <span className="pill tnum">{seconds(step.secs)}</span> : null}
          </div>
        ) : waiting ? (
          <div className="step-chips">
            <span className="pill pill-live tnum">
              <LiveDot /> running {seconds(elapsed)}
            </span>
          </div>
        ) : null}
        {step.out !== undefined ? <Output text={step.out} /> : null}
      </div>
    </motion.li>
  );
}

export interface SandboxPanelProps {
  runId: string;
  steps: SandboxStep[];
  shots: LiveShot[];
  metrics: Metric[];
  log: TestLog | undefined;
  container: { name: string; running: boolean } | undefined;
  stageState: StageState;
  startOpen: boolean;
  now: number;
}

function fromLog(log: TestLog): { steps: SandboxStep[]; shots: LiveShot[] } {
  return {
    steps: log.steps.map(s => ({ n: s.n, note: s.note, cmd: s.cmd, out: s.out, exit: s.exit, secs: s.secs })),
    shots: log.shots.map(s => ({ file: s.file, caption: s.caption, afterStep: s.afterStep })),
  };
}

export function SandboxPanel({ runId, steps, shots, metrics, log, container, stageState, startOpen, now }: SandboxPanelProps) {
  const running = stageState === "running";
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? startOpen;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [detached, setDetached] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);

  const view = steps.length > 0 || !log ? { steps, shots } : fromLog(log);
  const items = view.shots.map(s => ({ key: `shot-${s.file}`, src: fileUrl(runId, `test/shots/${s.file}`), caption: s.caption }));
  // Logs written before measured results and recordings existed lack both arrays.
  const shownMetrics = metrics.length > 0 || !log ? metrics : (log.metrics ?? []);
  const recordings = log?.recordings ?? [];
  const totalSecs = view.steps.reduce((sum, s) => sum + (s.secs ?? 0), 0);

  useEffect(() => {
    const el = feed.current;
    const inner = el?.firstElementChild;
    if (!el || !inner || !running) return;
    const follow = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(inner);
    return () => follow.disconnect();
  }, [running, open]);

  const onScroll = (): void => {
    const el = feed.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (el.scrollTop < lastTop.current - 1) stick.current = false;
    else if (nearBottom) stick.current = true;
    lastTop.current = el.scrollTop;
    setDetached(!stick.current);
  };

  const jumpToLatest = (): void => {
    const el = feed.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
  };

  return (
    <motion.section className="card terminal-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <header className="card-head">
        <button type="button" className="card-toggle" onClick={() => setChoice(!open)} aria-expanded={open}>
          <Icon name="chevron" size={14} className={`chev ${open ? "is-open" : ""}`} />
          <h2 className="card-title">
            <Icon name="terminal" size={16} /> Sandbox
          </h2>
        </button>
        <div className="card-aside terminal-meta">
          {container ? (
            <span className={`pill ${container.running && running ? "pill-live" : ""}`}>
              {container.running && running ? <LiveDot /> : null}
              <span className="mono">{container.name}</span>
            </span>
          ) : null}
          {view.steps.length > 0 ? (
            <span className="pill tnum">
              {view.steps.length} commands, {seconds(totalSecs)}
            </span>
          ) : null}
        </div>
      </header>
      <MetricChips metrics={shownMetrics} />

      <Collapse open={open}>
        <div className="terminal">
          <div className="terminal-feed" ref={feed} onScroll={onScroll} tabIndex={0} aria-label="Sandbox activity" aria-live="off">
            <div>
              {view.steps.length === 0 ? (
                <div className="terminal-empty">
                  {running ? (
                    <>
                      <span className="caret" /> Starting the container
                    </>
                  ) : stageState === "pending" ? (
                    "The sandbox starts after the repo has been read."
                  ) : (
                    "No commands were recorded."
                  )}
                </div>
              ) : (
                <ol className="steps">
                  <AnimatePresence initial={false}>
                    {view.steps.map((s, i) => (
                      <Step key={s.n} step={s} now={now} isLast={i === view.steps.length - 1} running={running} />
                    ))}
                  </AnimatePresence>
                </ol>
              )}
            </div>
          </div>
          <AnimatePresence>
            {detached && running ? (
              <motion.button type="button" className="jump btn btn-sm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} onClick={jumpToLatest}>
                Jump to latest
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>

        {items.length > 0 ? (
          <div className="filmstrip" aria-label="Screenshots taken by the agent">
            <div className="filmstrip-head">
              <Icon name="image" size={14} /> Screenshots
              <span className="muted tnum">{items.length}</span>
            </div>
            <ul className="filmstrip-row">
              <AnimatePresence initial={false}>
                {items.map((item, i) => (
                  <motion.li key={item.key} initial={{ opacity: 0, scale: 0.92, x: 16 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                    <button type="button" className="shot" onClick={() => setLightbox(i)} aria-label={`Enlarge: ${item.caption}`}>
                      <motion.img layoutId={item.key} src={item.src} alt="" loading="lazy" />
                      <span className="shot-caption">{item.caption}</span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        ) : null}

        {recordings.length > 0 ? (
          <div className="filmstrip" aria-label="Screen recordings of the app">
            <div className="filmstrip-head">
              <Icon name="video" size={14} /> Recordings
              <span className="muted tnum">{recordings.length}</span>
            </div>
            <ul className="filmstrip-row">
              {recordings.map(r => (
                <li key={r.file} className="rec">
                  <video className="rec-video" src={fileUrl(runId, `test/rec/${r.file}`)} controls muted preload="metadata" playsInline />
                  <span className="shot-caption">
                    {r.caption} <span className="tnum">({seconds(r.secs)})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Collapse>
      <Lightbox items={items} index={lightbox} onChange={setLightbox} />
    </motion.section>
  );
}
