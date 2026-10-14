import { useEffect, useRef, useState } from "react";
import type { LogLine } from "../lib/liveState.ts";
import { STAGE_SHORT } from "../lib/stages.ts";
import { Icon } from "./Icon.tsx";
import { Collapse } from "./common.tsx";

const time = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour12: false });

export function ActivityLog({ lines, running }: { lines: LogLine[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (open && running && el) el.scrollTop = el.scrollHeight;
  }, [lines, open, running]);

  if (lines.length === 0) return null;
  return (
    <section className="card">
      <header className="card-head">
        <button type="button" className="card-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          <Icon name="chevron" size={14} className={`chev ${open ? "is-open" : ""}`} />
          <h2 className="card-title">Pipeline log</h2>
        </button>
        <div className="card-aside">
          <span className="pill tnum">{lines.length} lines</span>
        </div>
      </header>
      <Collapse open={open}>
        <div className="log" ref={box} tabIndex={0} aria-label="Pipeline log">
          {lines.map(l => (
            <div className="log-line" key={l.seq}>
              <span className="log-t tnum">{time(l.t)}</span>
              <span className="log-stage">{STAGE_SHORT[l.stage]}</span>
              <span className="log-text">{l.text}</span>
            </div>
          ))}
        </div>
      </Collapse>
    </section>
  );
}
