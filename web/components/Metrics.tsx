import { motion } from "motion/react";
import type { Metric } from "../../src/shared/types.ts";
import { EASE_OUT } from "./common.tsx";

const TONE: Record<`${boolean}` | "null", { cls: string; word: string }> = {
  true: { cls: "is-pass", word: "Passed" },
  false: { cls: "is-fail", word: "Failed" },
  null: { cls: "is-info", word: "Measured" },
};
const display = (m: Metric): string => `${typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value}${m.unit ? ` ${m.unit}` : ""}`;

// One live chip per measured fact while the sandbox runs.
export function MetricChips({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return null;
  return (
    <ul className="metric-chips" aria-label="Measured so far">
      {metrics.map(m => {
        const tone = TONE[String(m.pass) as keyof typeof TONE];
        return (
          <motion.li key={m.id} className={`metric-chip ${tone.cls}`} title={m.detail} initial={{ opacity: 0, scale: 0.9, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
            <span className="metric-dot" aria-hidden="true" />
            <span className="metric-chip-label">{m.label}</span>
            <span className="metric-chip-value tnum">{display(m)}</span>
            <span className="sr-only">{tone.word}</span>
          </motion.li>
        );
      })}
    </ul>
  );
}

// The numbers the score was computed from, with the plain-language detail behind each.
export function MeasuredResults({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="measured">
      <h3 className="mini-title">Measured results</h3>
      <ul className="measured-grid">
        {metrics.map((m, i) => {
          const tone = TONE[String(m.pass) as keyof typeof TONE];
          return (
            <motion.li key={m.id} className={`measured-card ${tone.cls}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.1 + i * 0.06 }}>
              <div className="measured-head">
                <span className="metric-dot" aria-hidden="true" />
                <span className="measured-label">{m.label}</span>
                <span className="sr-only">{tone.word}</span>
              </div>
              <div className="measured-value tnum">{display(m)}</div>
              <p className="measured-detail">{m.detail}</p>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
