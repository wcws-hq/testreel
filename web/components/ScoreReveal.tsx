import { motion } from "motion/react";
import { useState } from "react";
import type { Score, Verdict } from "../../src/shared/types.ts";
import { CountUp, EASE_OUT, Section, VERDICT_COLOR } from "./common.tsx";
import { MeasuredResults } from "./Metrics.tsx";

type Axis = keyof Score["scores"];

const AXES: { key: Axis; label: string }[] = [
  { key: "works", label: "Works" },
  { key: "quality", label: "Quality" },
  { key: "effort", label: "Effort" },
  { key: "speed", label: "Speed" },
];

const RADIUS = 42;

function toneFor(value: number): string {
  if (value >= 7) return VERDICT_COLOR.USE;
  if (value >= 5) return VERDICT_COLOR.WATCH;
  return VERDICT_COLOR.SKIP;
}

function Gauge({ label, value, reason, index }: { label: string; value: number; reason: string; index: number }) {
  const [open, setOpen] = useState(false);
  const color = toneFor(value);
  const delay = 0.5 + index * 0.18;
  return (
    <div className={`gauge ${open ? "is-open" : ""}`}>
      <div className="gauge-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="gauge-track" cx="50" cy="50" r={RADIUS} pathLength={1} />
          <motion.circle
            className="gauge-arc"
            cx="50"
            cy="50"
            r={RADIUS}
            pathLength={1}
            stroke={color}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: value / 10 }}
            transition={{ duration: 1.5, delay, ease: EASE_OUT }}
            style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 55%, transparent))` }}
          />
        </svg>
        <div className="gauge-value">
          <CountUp to={value} decimals={0} duration={1.5} delay={delay} />
        </div>
      </div>
      <div className="gauge-label">{label}</div>
      <p className={`gauge-reason ${open ? "is-open" : ""}`}>{reason}</p>
      <button type="button" className="gauge-more" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? "Show less" : "Read why"}
      </button>
    </div>
  );
}

function VerdictBadge({ verdict, average }: { verdict: Verdict; average: number }) {
  const color = VERDICT_COLOR[verdict];
  return (
    <div className="verdict" style={{ ["--verdict" as string]: color }}>
      <motion.div className="verdict-halo" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, delay: 1.7, ease: EASE_OUT }} />
      <motion.div className="verdict-ring" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: [0, 1, 1], scale: [0.7, 1.08, 1] }} transition={{ duration: 0.9, delay: 1.6, ease: EASE_OUT }} />
      <motion.div className="verdict-word" initial={{ opacity: 0, scale: 0.6, filter: "blur(12px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ type: "spring", stiffness: 180, damping: 15, delay: 1.7 }}>
        {verdict}
      </motion.div>
      <div className="verdict-avg">
        <CountUp to={average} decimals={1} duration={1.6} delay={0.5} />
        <span> / 10 average</span>
      </div>
    </div>
  );
}

export function ScoreReveal({ score }: { score: Score }) {
  return (
    <Section title="Score">
      <div className="score">
        <VerdictBadge verdict={score.verdict} average={score.average} />
        <div className="score-main">
          <p className="score-line">{score.oneLine}</p>
          <div className="gauges">
            {AXES.map((a, i) => (
              <Gauge key={a.key} label={a.label} value={score.scores[a.key]} reason={score.reasons[a.key]} index={i} />
            ))}
          </div>
        </div>
      </div>
      {/* Runs saved before measured results existed have no metrics array. */}
      {score.metrics?.length > 0 ? <MeasuredResults metrics={score.metrics} /> : null}
      {score.limitations.length > 0 ? (
        <div className="limits">
          <h3 className="mini-title">What this test did not cover</h3>
          <ul>
            {score.limitations.map(l => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
