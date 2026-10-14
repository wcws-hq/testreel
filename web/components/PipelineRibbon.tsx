import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";
import { Icon, type IconName } from "./Icon.tsx";

const NODES: { label: string; icon: IconName }[] = [
  { label: "Repo", icon: "repo" },
  { label: "Triage", icon: "check" },
  { label: "Container", icon: "container" },
  { label: "Score", icon: "score" },
  { label: "Voice", icon: "voice" },
  { label: "Video", icon: "video" },
  { label: "Upload", icon: "upload" },
];

const CYCLE_SECONDS = 7;
const GLOW_WIDTH = 0.11;

// Brightness of node `index` for a pulse at progress `p` (0..1 along the ribbon).
function glowAt(p: number, index: number): number {
  const at = index / (NODES.length - 1);
  return Math.max(0, 1 - Math.abs(p - at) / GLOW_WIDTH);
}

function Node({ index, label, icon, progress }: { index: number; label: string; icon: IconName; progress: MotionValue<number> }) {
  const glow = useTransform(progress, p => Math.max(glowAt(p, index), glowAt((p + 0.5) % 1, index)));
  const borderColor = useTransform(glow, g => `rgba(200,255,46,${0.14 + g * 0.7})`);
  const shadow = useTransform(glow, g => `0 0 ${g * 26}px rgba(200,255,46,${g * 0.35})`);
  const color = useTransform(glow, g => `rgb(${138 + g * 62},${138 + g * 117},${147 - g * 101})`);
  return (
    <li className="ribbon-node">
      <motion.span className="ribbon-icon" style={{ borderColor, boxShadow: shadow, color }}>
        <Icon name={icon} size={18} />
      </motion.span>
      <span className="ribbon-label">{label}</span>
    </li>
  );
}

export function PipelineRibbon() {
  const reduce = useReducedMotion();
  const progress = useMotionValue(0.0);
  useEffect(() => {
    if (reduce) return;
    const controls = animate(progress, 1, { duration: CYCLE_SECONDS, ease: "linear", repeat: Infinity, repeatType: "loop" });
    return () => controls.stop();
  }, [progress, reduce]);

  const first = useTransform(progress, p => `${p * 100}%`);
  const second = useTransform(progress, p => `${((p + 0.5) % 1) * 100}%`);

  return (
    <div className="ribbon" aria-label="Pipeline: repo, triage, container, score, voice, video, upload">
      <div className="ribbon-track" aria-hidden="true">
        <span className="ribbon-line" />
        {reduce ? null : (
          <>
            <motion.span className="ribbon-pulse" style={{ left: first }} />
            <motion.span className="ribbon-pulse" style={{ left: second }} />
          </>
        )}
      </div>
      <ol className="ribbon-nodes">
        {NODES.map((n, i) => (
          <Node key={n.label} index={i} label={n.label} icon={n.icon} progress={progress} />
        ))}
      </ol>
    </div>
  );
}
