import { AnimatePresence, motion } from "motion/react";
import type { Health, Mode } from "../../src/shared/types.ts";
import { CHECKS } from "../lib/health.ts";
import { Icon } from "./Icon.tsx";
import { Spinner } from "./common.tsx";

interface Props {
  health: Health | null;
  error: string | null;
  checking: boolean;
  mode: Mode;
  autoUpload: boolean;
  onRecheck: () => void;
}

export function HealthChips({ health, error, checking, mode, autoUpload, onRecheck }: Props) {
  if (!health) {
    return (
      <div className="health" aria-live="polite">
        {error ? (
          <p className="health-fail">
            <Icon name="alert" size={14} /> Could not reach the Testreel server: {error}
          </p>
        ) : (
          <p className="muted small">
            <Spinner size={12} /> Checking this machine
          </p>
        )}
        {error ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRecheck}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const failing = CHECKS.filter(c => !health[c.key].ok);
  return (
    <div className="health" aria-live="polite">
      <ul className="chips" aria-label="System checks">
        {CHECKS.map((c, i) => {
          const check = health[c.key];
          const tone = check.ok ? "ok" : c.needed(mode, autoUpload) ? "fail" : "warn";
          return (
            <motion.li
              key={c.key}
              className={`chip chip-${tone}`}
              title={check.detail}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="chip-dot" />
              {c.label}
            </motion.li>
          );
        })}
        <li>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRecheck} disabled={checking}>
            {checking ? <Spinner size={12} /> : <Icon name="refresh" size={13} />}
            Recheck
          </button>
        </li>
      </ul>
      <AnimatePresence initial={false}>
        {failing.length > 0 ? (
          <motion.ul
            key="hints"
            className="hints"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {failing.map(c => {
              const tone = c.needed(mode, autoUpload) ? "fail" : "warn";
              return (
                <li key={c.key} className={`hint hint-${tone}`}>
                  <strong>{c.label}</strong>
                  <span className="hint-text">
                    <span className="hint-detail">{health[c.key].detail}</span>
                    <span>{c.hint(health.settingsDir)}</span>
                  </span>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
