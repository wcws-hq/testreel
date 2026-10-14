import { AnimatePresence, motion, useMotionValue, useReducedMotion, animate } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Verdict } from "../../src/shared/types.ts";
import { Icon } from "./Icon.tsx";

export const VERDICT_COLOR: Record<Verdict, string> = { USE: "var(--use)", WATCH: "var(--watch)", SKIP: "var(--skip)" };

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCopy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <button type="button" className={`btn btn-ghost btn-sm copy ${copied ? "is-copied" : ""}`} onClick={onCopy} aria-label={`${label} to clipboard`}>
      <Icon name={copied ? "check" : "copy"} size={13} />
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

export function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <motion.section className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
      <header className="card-head">
        <h2 className="card-title">{title}</h2>
        {aside ? <div className="card-aside">{aside}</div> : null}
      </header>
      {children}
    </motion.section>
  );
}

export function LiveDot() {
  return <span className="live-dot" aria-hidden="true" />;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function CountUp({ to, decimals = 0, duration = 1.4, delay = 0 }: { to: number; decimals?: number; duration?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const value = useMotionValue(reduce ? to : 0);
  const [text, setText] = useState((reduce ? to : 0).toFixed(decimals));
  useEffect(() => {
    if (reduce) {
      setText(to.toFixed(decimals));
      return;
    }
    const controls = animate(value, to, { duration, delay, ease: EASE_OUT, onUpdate: v => setText(v.toFixed(decimals)) });
    return () => controls.stop();
  }, [to, decimals, duration, delay, reduce, value]);
  return <span className="tnum">{text}</span>;
}

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="content"
          style={{ overflow: "hidden" }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ProgressBar({ pct, label, end }: { pct: number; label?: string; end?: "done" | "failed" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} aria-label={label}>
      <motion.div className={`progress-fill ${end ? `is-${end}` : ""}`} initial={false} animate={{ width: `${clamped}%` }} transition={{ type: "spring", stiffness: 140, damping: 24 }} />
    </div>
  );
}
