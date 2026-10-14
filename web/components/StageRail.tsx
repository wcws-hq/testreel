import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { STAGE_LABEL, type VideoKind } from "../../src/shared/types.ts";
import { clock, seconds } from "../lib/format.ts";
import type { LiveState } from "../lib/liveState.ts";
import { STAGE_SHORT, type StageView } from "../lib/stages.ts";
import { Icon } from "./Icon.tsx";
import { ProgressBar } from "./common.tsx";

const KIND_LABEL: Record<VideoKind | "all", string> = { full: "Long video", short: "Short", all: "" };

function duration(stage: StageView, now: number): string {
  if (!stage.startedAt) return "";
  const secs = ((stage.endedAt ?? now) - stage.startedAt) / 1000;
  return secs >= 100 ? clock(secs) : seconds(secs);
}

function Node({ state }: { state: StageView["state"] }) {
  return (
    <span className={`rail-node rail-node-${state}`}>
      {state === "done" ? <Icon name="check" size={12} strokeWidth={2.6} /> : null}
      {state === "failed" ? <Icon name="x" size={12} strokeWidth={2.6} /> : null}
      {state === "running" ? <span className="rail-pulse" /> : null}
      {state === "skipped" ? <span className="rail-dash" /> : null}
    </span>
  );
}

interface Props {
  stages: StageView[];
  progress: LiveState["progress"];
  now: number;
}

export function StageRail({ stages, progress, now }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const current = stages.find(s => s.state === "running")?.id;

  useEffect(() => {
    const scroller = list.current?.parentElement;
    const row = list.current?.querySelector<HTMLElement>("[aria-current]");
    if (!scroller || !row || scroller.scrollWidth <= scroller.clientWidth) return;
    const offset = row.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    scroller.scrollTo({ left: offset - 28, behavior: "smooth" });
  }, [current]);

  return (
    <ol className="rail" aria-label="Pipeline stages" ref={list}>
      {stages.map((stage, i) => {
        const bars = (["all", "full", "short"] as const).flatMap(kind => {
          const info = progress[`${stage.id}:${kind}`];
          return info ? [{ kind, ...info }] : [];
        });
        const next = stages[i + 1];
        const linked = stage.state === "done" || stage.state === "skipped";
        return (
          <li key={stage.id} className={`rail-row rail-${stage.state}`} aria-current={stage.state === "running" ? "step" : undefined}>
            <div className="rail-track" aria-hidden="true">
              <Node state={stage.state} />
              {next ? (
                <span className="rail-line">
                  <motion.span className="rail-line-fill" initial={false} animate={{ scaleY: linked ? 1 : stage.state === "running" ? 0.35 : 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
                  {stage.state === "running" ? <span className="rail-line-flow" /> : null}
                </span>
              ) : null}
            </div>
            <div className="rail-body">
              <div className="rail-head">
                <span className="rail-name">{STAGE_SHORT[stage.id]}</span>
                <span className="rail-time tnum">{stage.state === "skipped" ? "skipped" : duration(stage, now)}</span>
              </div>
              <div className="rail-sub">{stage.state === "running" && stage.detail ? stage.detail : STAGE_LABEL[stage.id]}</div>
              {stage.state === "running" || bars.length > 0 ? (
                <div className="rail-bars">
                  {bars.map(b => (
                    <div className={`rail-bar ${b.end ? `is-${b.end}` : ""}`} key={b.kind}>
                      <div className="rail-bar-head">
                        <span>{KIND_LABEL[b.kind] || b.label}</span>
                        <span className="tnum">{Math.round(b.pct)}%</span>
                      </div>
                      <ProgressBar pct={b.pct} end={b.end} label={`${STAGE_SHORT[stage.id]} ${KIND_LABEL[b.kind]}`.trim()} />
                      {KIND_LABEL[b.kind] ? <div className="rail-bar-label">{b.label}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
