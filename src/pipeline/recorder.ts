// Footage for the video: real screen recordings of the tested app, written to test/rec/rec-N.mp4 (H.264, 1920x1080, 30 fps).
//  - web apps: a real headless Chrome on this machine uses the app through its published port (cursor, clicks and typing visible).
//    Every triaged flow is first carried out unrecorded and judged from the real page state; that decides whether the flow worked.
//  - everything else (CLI, API, library): a terminal session replayed from the real commands and real output in the test log
import { mkdirSync } from "node:fs";
import type { TestRecording, TestStep, Triage } from "../shared/types.ts";
import type { RunCtx } from "./ctx.ts";
import type { Exploration } from "./score.ts";
import { launchChrome, Screencast } from "./screencast.ts";
import { playTerminal } from "./terminal.ts";
import type { TerminalItem } from "./terminal.ts";
import { planFlow, recordFlow } from "./webflow.ts";
import type { Act, Plan, Replay, Spec } from "./webflow.ts";

const MAX_RECORDINGS = 3;
const MAX_WEB_FLOWS = 2;

interface FootageInput {
  ctx: RunCtx;
  triage: Triage;
  exploration: Exploration;
  steps: TestStep[];
  baseUrl: string | null; // http://127.0.0.1:<port> when the app answers; null when it is not running
  bootStep: number | null;
}

interface Footage {
  recordings: TestRecording[];
  flows: Exploration["flows"] | null; // judged from the browser run (web apps); null when no browser run happened
}

interface Group {
  steps: number[];
  caption: string;
}

function effectNote(r: Replay): string {
  const weak = r.noEffect + r.unresolved;
  return weak === 0 ? "" : ` (${weak} of ${r.total} actions showed no visible change)`;
}

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

async function recordWeb(i: FootageInput, baseUrl: string, outDir: string): Promise<Footage> {
  const { ctx, triage, exploration } = i;
  const browser = await launchChrome(ctx);
  const recordings: TestRecording[] = [];
  try {
    // Carry out every flow unrecorded and judge it.
    const plans: (Plan | null)[] = [];
    for (const [idx, goal] of triage.flows.entries()) {
      ctx.log("sandbox", `Trying flow ${idx + 1} of ${triage.flows.length} in a browser: ${goal.slice(0, 100)}`);
      let plan = await planFlow(ctx, browser, baseUrl, { goal, appSummary: triage.summary, edge: false });
      if (plan?.verdict && !(plan.verdict.worked && plan.verdict.correct)) {
        // One more careful try, so that a slip of the automated user is not counted against the app.
        ctx.log("sandbox", `Flow ${idx + 1} did not come out right (${plan.verdict.evidence.slice(0, 120)}), trying once more`);
        const second = await planFlow(ctx, browser, baseUrl, { goal, appSummary: triage.summary, edge: false, hint: plan.verdict.evidence });
        if (second?.verdict && (second.verdict.worked ? 1 : 0) + (second.verdict.correct ? 1 : 0) >= (plan.verdict.worked ? 1 : 0) + (plan.verdict.correct ? 1 : 0)) plan = second;
      }
      plans.push(plan);
      ctx.log("sandbox", `Flow ${idx + 1}: ${plan?.verdict ? `${plan.verdict.worked ? "worked" : "did not work"}${plan.verdict.worked && !plan.verdict.correct ? " but not as expected" : ""}. ${plan.verdict.evidence}` : "no result"}`);
    }
    const flows: Exploration["flows"] = triage.flows.map((flow, idx) => {
      const v = plans[idx]?.verdict;
      return { flow, ok: v?.worked === true, correct: v?.correct === true, evidence: v?.evidence ?? null };
    });

    // Record up to two flows (ones that worked first; a failing flow if none did) and the limitation the agent found.
    const withActs = triage.flows.map((goal, idx) => ({ goal, idx, plan: plans[idx] })).filter((f) => (f.plan?.acts.length ?? 0) > 0);
    const chosen = [...withActs.filter((f) => flows[f.idx]?.ok), ...withActs.filter((f) => !flows[f.idx]?.ok)].slice(0, MAX_WEB_FLOWS);
    const shows: { spec: Spec; acts: Act[]; note: string }[] = chosen.flatMap((f) => (f.plan ? [{ spec: { goal: f.goal, appSummary: triage.summary, edge: false }, acts: f.plan.acts, note: flows[f.idx]?.ok ? "" : " (this did not work)" }] : []));
    if (exploration.limitation) {
      const spec: Spec = { goal: exploration.limitation.text, appSummary: triage.summary, edge: true };
      ctx.log("sandbox", `Planning the edge case: ${spec.goal.slice(0, 100)}`);
      const edge = await planFlow(ctx, browser, baseUrl, spec);
      if (edge && edge.acts.length > 0) shows.push({ spec, acts: edge.acts, note: "" });
      else ctx.log("sandbox", `No recording for the edge case: ${edge ? "no action could be carried out on the page" : "it cannot be triggered through the page"}`);
    }
    for (const s of shows) {
      const file = `rec-${recordings.length + 1}.mp4`;
      ctx.log("sandbox", `Recording ${file}: ${s.acts.length} actions`);
      const replay = await recordFlow(ctx, browser, baseUrl, s.acts, `${outDir}/${file}`);
      const caption = `${s.spec.edge ? "A real limitation" : "Trying it"}: ${s.spec.goal}${s.note}${effectNote(replay)}`;
      recordings.push({ file, caption, secs: replay.secs, afterStep: i.bootStep ?? i.steps.length });
      ctx.log("sandbox", `Recorded ${file}: ${replay.secs} s, ${replay.total} actions, ${replay.noEffect} without visible change, ${replay.unresolved} not found, ${replay.pageErrors} page errors`);
    }
    return { recordings, flows };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// The step numbers behind each recording, taken from what the exploratory agent established and the measured phase logged.
function terminalGroups(i: FootageInput): Group[] {
  const { exploration: ex, steps } = i;
  const exists = (n: number): boolean => steps.some((s) => s.n === n);
  const groups: Group[] = [];
  const failedInstall = [...steps].reverse().find((s) => s.note.startsWith("Measured install") && s.exit !== 0);
  if (failedInstall) groups.push({ steps: [failedInstall.n], caption: "The install did not succeed" });
  const flows = ex.flows
    .map((f) => ({ f, n: Number(f.evidence) }))
    .filter((x) => x.f.ok && Number.isInteger(x.n) && exists(x.n))
    .map((x) => ({ steps: [x.n], caption: `Trying it: ${x.f.flow}` }));
  if (flows[0]) groups.push(flows[0]);
  if (ex.control && exists(ex.control.good) && exists(ex.control.bad)) {
    groups.push({ steps: [...new Set([ex.control.good, ex.control.bad])], caption: ex.control.discriminates ? "Control: a good input and a bad input give different, correct results" : "Control: a good input and a bad input, and the results did not differ as they should" });
  }
  if (flows[1] && groups.length < MAX_RECORDINGS - (ex.limitation ? 1 : 0)) groups.push(flows[1]);
  if (ex.limitation && exists(ex.limitation.step)) groups.push({ steps: [ex.limitation.step], caption: `A real limitation: ${ex.limitation.text}` });
  return groups.slice(0, MAX_RECORDINGS);
}

async function recordTerminal(i: FootageInput, outDir: string): Promise<TestRecording[]> {
  const { ctx, steps } = i;
  const groups = terminalGroups(i);
  if (groups.length === 0) return [];
  const browser = await launchChrome(ctx);
  const out: TestRecording[] = [];
  try {
    for (const g of groups) {
      const items: TerminalItem[] = g.steps.flatMap((n) => steps.filter((s) => s.n === n).map((s) => ({ cmd: s.cmd, out: s.out, exit: s.exit })));
      const file = `rec-${out.length + 1}.mp4`;
      const page = await browser.newPage();
      let cast: Screencast | undefined;
      try {
        await page.goto("about:blank");
        cast = await Screencast.start(page, `${outDir}/${file}`, ctx.signal);
        await playTerminal(page, ctx.run.name, items);
        const secs = await cast.stop(`${outDir}/${file}`, ctx.signal);
        out.push({ file, caption: g.caption, secs, afterStep: Math.max(...g.steps) });
        ctx.log("sandbox", `Recorded ${file}: terminal session of ${items.length} command${items.length === 1 ? "" : "s"}, ${secs} s`);
      } finally {
        cast?.dispose();
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return out;
}

// Records the footage for a finished test. Web apps are driven live; if the app cannot be reached from here, the terminal replay is used.
export async function recordFootage(i: FootageInput): Promise<Footage> {
  const outDir = i.ctx.path("test", "rec");
  mkdirSync(outDir, { recursive: true });
  if (i.triage.kind === "web" && i.baseUrl) {
    if (await reachable(i.baseUrl)) return recordWeb(i, i.baseUrl, outDir);
    i.ctx.log("sandbox", `The app does not answer at ${i.baseUrl} from this machine (is it bound to 127.0.0.1 inside the container?), so no browser run was possible`);
  }
  return { recordings: await recordTerminal(i, outDir), flows: null };
}
