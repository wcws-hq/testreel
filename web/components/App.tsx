import { AnimatePresence, motion } from "motion/react";
import { useRoute } from "../hooks/useRoute.ts";
import { DotField } from "./DotField.tsx";
import { Home } from "./Home.tsx";
import { RunPage } from "./RunPage.tsx";

function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Testreel home">
      <svg className="brand-mark" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M12 9.5v13l11-6.5z" fill="#000" />
      </svg>
      <span className="brand-name">Testreel</span>
    </a>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <DotField />
      <div className="shell">
        <header className="topbar">
          <Brand />
          <nav className="topnav" aria-label="Main">
            <a className="btn btn-ghost btn-sm" href="#/">
              New run
            </a>
          </nav>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={route.name === "run" ? `run-${route.id}` : "home"}
            className="page"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {route.name === "run" ? <RunPage id={route.id} /> : <Home />}
          </motion.main>
        </AnimatePresence>
      </div>
    </>
  );
}
