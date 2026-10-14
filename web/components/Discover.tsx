import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Discovery, TrendingPeriod } from "../../src/shared/types.ts";
import { api } from "../api.ts";
import { Icon } from "./Icon.tsx";
import { Spinner } from "./common.tsx";

const PERIODS: { value: TrendingPeriod; label: string; gained: string }[] = [
  { value: "daily", label: "Today", gained: "today" },
  { value: "weekly", label: "This week", gained: "this week" },
];
const POLL_MS = 2000;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function Discover({ onPick }: { onPick: (url: string) => void }) {
  const [period, setPeriod] = useState<TrendingPeriod>("weekly");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    let timer: number | undefined;
    setDiscovery(null);
    setError(null);
    const tick = (): void => {
      api
        .discover(period)
        .then(d => {
          if (!current) return;
          setDiscovery(d);
          if (d.status === "running") timer = window.setTimeout(tick, POLL_MS);
        })
        .catch((e: unknown) => current && setError(e instanceof Error ? e.message : String(e)));
    };
    tick();
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [period, attempt]);

  const gained = PERIODS.find(p => p.value === period)?.gained ?? "";
  const failure = error ?? (discovery?.status === "failed" ? (discovery.error ?? "The scan failed") : null);

  return (
    <section className="discover" aria-labelledby="discover-title">
      <div className="discover-head">
        <div>
          <h2 id="discover-title" className="section-title">
            Trending, and runnable
          </h2>
          <p className="discover-sub">GitHub trending repos that passed the same check a run starts with. The rest are left out.</p>
        </div>
        <div className="seg seg-sm" role="radiogroup" aria-label="Trending period">
          {PERIODS.map(p => (
            <button key={p.value} type="button" role="radio" aria-checked={period === p.value} className={`seg-item ${period === p.value ? "is-on" : ""}`} onClick={() => setPeriod(p.value)}>
              {period === p.value ? <motion.span layoutId="discover-thumb" className="seg-thumb" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
              <span className="seg-label">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {discovery?.status === "running" || (!discovery && !failure) ? (
        <p className="discover-progress" role="status">
          <Spinner />
          {discovery && discovery.total > 0 ? `Checked ${discovery.scanned} of ${discovery.total} trending repos, ${discovery.found.length} can be run so far` : "Reading GitHub trending"}
        </p>
      ) : null}

      {failure ? (
        <div className="notice notice-fail" role="alert">
          <Icon name="alert" size={16} />
          <span>
            {failure}{" "}
            <button type="button" className="link" onClick={() => setAttempt(n => n + 1)}>
              Try again
            </button>
          </span>
        </div>
      ) : null}

      {discovery?.status === "done" ? <p className="discover-progress">Checked {discovery.total} trending repos, {discovery.found.length} can be run.</p> : null}

      <ul className="discover-list">
        <AnimatePresence initial={false}>
          {discovery?.found.map(c => (
            <motion.li key={c.fullName} layout="position" className="discover-row" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <div className="discover-main">
                <a className="discover-name" href={c.url} target="_blank" rel="noreferrer">
                  {c.fullName}
                </a>
                <p className="discover-summary">{c.summary}</p>
                <p className="discover-meta">
                  <span className="discover-kind">{c.kind}</span>
                  {c.language ? <span>{c.language}</span> : null}
                  <span>
                    <Icon name="star" size={12} /> {compact.format(c.stars)}
                  </span>
                  <span className="discover-gain">
                    +{compact.format(c.starsGained)} {gained}
                  </span>
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(c.url)}>
                Use this repo
                <Icon name="arrow" size={13} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
