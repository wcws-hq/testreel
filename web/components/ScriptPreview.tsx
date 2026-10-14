import { motion } from "motion/react";
import { Fragment, useState } from "react";
import type { Script, Scripts, VideoKind } from "../../src/shared/types.ts";
import { Collapse, EASE_OUT, Section } from "./common.tsx";
import { Icon } from "./Icon.tsx";

const KIND_TABS: { kind: VideoKind; label: string }[] = [
  { kind: "full", label: "Long video" },
  { kind: "short", label: "Short" },
];

const SCENE_LABEL: Record<Script["sections"][number]["scene"]["kind"], string> = {
  hook: "Hook",
  repo: "Repo card",
  browser: "Browser",
  footage: "Screen recording",
  terminal: "Terminal",
  stats: "Numbers",
  bars: "Bars",
  points: "Points",
  quote: "Quote",
  scorecard: "Scorecard",
  verdict: "Verdict",
  cta: "Outro",
};

function Voiceover({ text }: { text: string }) {
  const parts = text.split(/(\[pause\]|\[beat\])/g);
  return (
    <p className="vo">
      {parts.map((part, i) =>
        part === "[pause]" || part === "[beat]" ? (
          <span key={i} className="vo-mark">
            {part === "[pause]" ? "pause" : "beat"}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

function SectionRow({ section, index }: { section: Script["sections"][number]; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="script-row">
      <button type="button" className="script-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="script-n tnum">{String(index + 1).padStart(2, "0")}</span>
        <span className="script-title">{section.title}</span>
        <span className="pill">{SCENE_LABEL[section.scene.kind]}</span>
        <span className="pill">Voice {section.voice}</span>
        <Icon name="chevron" size={14} className={`chev ${open ? "is-open" : ""}`} />
      </button>
      <Collapse open={open}>
        <div className="script-body">
          <Voiceover text={section.voiceover} />
          {section.callout ? (
            <p className="callout">
              <span className="muted">On screen</span> {section.callout}
            </p>
          ) : null}
        </div>
      </Collapse>
    </li>
  );
}

export function ScriptPreview({ scripts }: { scripts: Scripts }) {
  const [kind, setKind] = useState<VideoKind>("full");
  const script = scripts[kind];
  const words = script.sections.reduce((sum, s) => sum + s.voiceover.split(/\s+/).filter(Boolean).length, 0);
  return (
    <Section
      title={
        <>
          <Icon name="script" size={16} /> Script
        </>
      }
      aside={
        <div className="seg seg-sm" role="tablist" aria-label="Script for">
          {KIND_TABS.map(t => (
            <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} className={`seg-item ${kind === t.kind ? "is-on" : ""}`} onClick={() => setKind(t.kind)}>
              {kind === t.kind ? <motion.span layoutId="script-seg" className="seg-thumb" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
              <span className="seg-label">{t.label}</span>
            </button>
          ))}
        </div>
      }
    >
      <p className="muted small script-stats tnum">
        {script.sections.length} sections, {words} words
      </p>
      <motion.ol key={kind} className="script-list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
        {script.sections.map((s, i) => (
          <SectionRow key={s.id} section={s} index={i} />
        ))}
      </motion.ol>
    </Section>
  );
}
