import { motion } from "motion/react";
import { useState } from "react";
import type { Mode } from "../../src/shared/types.ts";
import { useHealth, useRuns } from "../hooks/useData.ts";
import { Discover } from "./Discover.tsx";
import { HealthChips } from "./HealthChips.tsx";
import { Icon } from "./Icon.tsx";
import { KineticHeadline } from "./KineticText.tsx";
import { PipelineRibbon } from "./PipelineRibbon.tsx";
import { RepoForm } from "./RepoForm.tsx";
import { RunCards } from "./RunCards.tsx";

const REVEAL = { duration: 0.7, ease: [0.16, 1, 0.3, 1] } as const;

export function Home() {
  const { health, error, checking, recheck } = useHealth();
  const { runs, error: runsError, refresh } = useRuns();
  const [mode, setMode] = useState<Mode>("test");
  const [autoUpload, setAutoUpload] = useState(false);
  const [repoValue, setRepoValue] = useState("");

  return (
    <div className="home">
      <section className="hero">
        <motion.p className="eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={REVEAL}>
          <span className="eyebrow-dot" />
          Runs on this machine. Voice is local.
        </motion.p>
        <KineticHeadline lines={[[{ text: "Paste" }, { text: "a" }, { text: "repo." }], [{ text: "Watch", tone: "muted" }, { text: "it", tone: "muted" }, { text: "get", tone: "muted" }, { text: "tested.", tone: "accent" }]]} />
        <motion.p className="lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...REVEAL, delay: 0.9 }}>
          Testreel deploys the project in a throwaway container, uses it for real on screen, scores what it measured, then produces one long video and one Short with thumbnails, titles and a description.
        </motion.p>

        <motion.div className="form-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...REVEAL, delay: 1.05 }}>
          <RepoForm health={health} mode={mode} onMode={setMode} autoUpload={autoUpload} onAutoUpload={setAutoUpload} value={repoValue} onValue={setRepoValue} />
          <HealthChips health={health} error={error} checking={checking} mode={mode} autoUpload={autoUpload} onRecheck={recheck} />
        </motion.div>

        <motion.div className="scope" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...REVEAL, delay: 1.2 }}>
          <div className="scope-col">
            <h2 className="scope-title">
              <Icon name="check" size={14} strokeWidth={2.4} /> Works with
            </h2>
            <p>Web apps and command line tools that install and start on their own. APIs and libraries only when a short demo fits the same flow.</p>
          </div>
          <div className="scope-col">
            <h2 className="scope-title is-refused">
              <Icon name="x" size={14} strokeWidth={2.4} /> Turned away
            </h2>
            <p>AI and model repos, anything that needs a GPU, paid API keys or large downloads, apps made of several services, and desktop or mobile apps.</p>
          </div>
        </motion.div>

        <Discover
          onPick={url => {
            setRepoValue(url);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 0.9 }}>
          <PipelineRibbon />
        </motion.div>
      </section>

      <section className="recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="section-title">
          Recent runs
        </h2>
        <RunCards runs={runs} error={runsError} onChanged={refresh} />
      </section>
    </div>
  );
}
