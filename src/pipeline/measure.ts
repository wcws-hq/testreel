// The measured phase of the sandbox stage: code, not a model. It clones the repo, runs the triaged install / test / audit / start
// commands in the container and turns what happened into metrics. The numbers the score is built from come from here.
import type { Metric, TestStep, Triage } from "../shared/types.ts";
import { APP_DIR, HOME, tidy } from "./docker.ts";
import type { ExecResult } from "./docker.ts";

const INSTALL_SECS = 600;
const TEST_SECS = 300;
const AUDIT_SECS = 180;
const BOOT_SECS = 60;
const START_FILE = `${HOME}/start.sh`;
const APP_LOG = `${HOME}/app.log`;

export interface Measuring {
  triage: Triage;
  repoUrl: string;
  branch: string;
  // Runs a script in the container, records it as a numbered step and emits it. cwd defaults to the repo root.
  step(script: string, note: string, limitSecs: number, cwd?: string, display?: string): Promise<{ step: TestStep; exec: ExecResult }>;
  metric(m: Metric): void;
  exec(script: string, limitSecs: number): Promise<ExecResult>; // same container, not logged as a step
  log(text: string): void;
  progress(pct: number, label: string): void;
  throwIfStopped(): void;
}

interface Measured {
  appSid: string | null; // session id (= pid) of the running app's process tree
  bootStep: number | null; // number of the step that started the app
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

interface TestCounts {
  passed: number;
  failed: number;
  total: number;
}

// Reads pass/fail counts from the summary lines of the common test runners. null when the output has none of them.
function parseTestCounts(raw: string): TestCounts | null {
  const text = tidy(raw);
  const num = (re: RegExp): number | undefined => {
    const m = re.exec(text);
    return m?.[1] ? Number(m[1]) : undefined;
  };
  const make = (passed: number, failed: number, total?: number): TestCounts => ({ passed, failed, total: total ?? passed + failed });
  const jest = /^Tests:\s+(.*)$/m.exec(text);
  if (jest?.[1]) {
    const part = (word: string): number => Number(new RegExp(`(\\d+) ${word}`).exec(jest[1] ?? "")?.[1] ?? 0);
    const total = Number(/(\d+) total/.exec(jest[1])?.[1] ?? 0);
    if (total > 0) return make(part("passed"), part("failed"), total);
  }
  const vitest = /^\s*Tests\s+(.*)$/m.exec(text);
  if (vitest?.[1] && /passed|failed/.test(vitest[1])) {
    const part = (word: string): number => Number(new RegExp(`(\\d+) ${word}`).exec(vitest[1] ?? "")?.[1] ?? 0);
    return make(part("passed"), part("failed"), Number(/\((\d+)\)/.exec(vitest[1])?.[1]) || undefined);
  }
  const nodeTest = { pass: num(/^# pass (\d+)/m), fail: num(/^# fail (\d+)/m), tests: num(/^# tests (\d+)/m) };
  if (nodeTest.pass !== undefined && nodeTest.fail !== undefined) return make(nodeTest.pass, nodeTest.fail, nodeTest.tests);
  const nodeTestPretty = { pass: num(/^ℹ pass (\d+)/m), fail: num(/^ℹ fail (\d+)/m), tests: num(/^ℹ tests (\d+)/m) };
  if (nodeTestPretty.pass !== undefined && nodeTestPretty.fail !== undefined) return make(nodeTestPretty.pass, nodeTestPretty.fail, nodeTestPretty.tests);
  const mocha = { pass: num(/(\d+) passing/), fail: num(/(\d+) failing/) };
  if (mocha.pass !== undefined) return make(mocha.pass, mocha.fail ?? 0);
  const tapAsserts = /^Asserts:\s+(\d+) pass\s+(\d+) fail/m.exec(text);
  if (tapAsserts) return make(Number(tapAsserts[1]), Number(tapAsserts[2]));
  const unittest = /^Ran (\d+) tests? in [\d.]+s/m.exec(text);
  if (unittest) {
    const bad = /^FAILED \((.*)\)/m.exec(text)?.[1] ?? "";
    const failed = [...bad.matchAll(/(?:failures|errors)=(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
    return make(Number(unittest[1]) - failed, failed, Number(unittest[1]));
  }
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)];
  if (cargo.length > 0) return make(cargo.reduce((s, m) => s + Number(m[1]), 0), cargo.reduce((s, m) => s + Number(m[2]), 0));
  const pytest = /=+ (?:(\d+) failed)?,? ?(?:(\d+) passed)?.* in [\d.]+s/.exec(text) ?? /^((?:\d+ \w+(?:, )?)+) in [\d.]+s/m.exec(text);
  if (pytest) {
    const line = pytest[0];
    const part = (word: string): number => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    const passed = part("passed");
    const failed = part("failed") + part("errors?");
    if (passed + failed > 0) return make(passed, failed);
  }
  return null;
}

async function measureInstall(m: Measuring): Promise<boolean> {
  const cmds = m.triage.install;
  let secs = 0;
  let failed: { n: number; cmd: string; code: number; timedOut: boolean } | null = null;
  for (const [i, cmd] of cmds.entries()) {
    m.log(`Install command ${i + 1} of ${cmds.length}`);
    const r = await m.step(cmd, `Measured install, command ${i + 1} of ${cmds.length}`, INSTALL_SECS);
    secs += r.exec.secs;
    if (r.exec.code !== 0) {
      failed = { n: r.step.n, cmd, code: r.exec.code, timedOut: r.exec.timedOut };
      break;
    }
  }
  const detail = failed
    ? `Command ${failed.n} (${failed.cmd.slice(0, 80)}) ${failed.timedOut ? `did not finish in ${INSTALL_SECS} seconds` : `exited with ${failed.code}`}.`
    : cmds.length === 0
      ? "The repo needs no install step."
      : `${cmds.length} install command${cmds.length === 1 ? "" : "s"}, all exited 0.`;
  m.metric({ id: "install", label: "Install", value: round1(secs), unit: "s", pass: failed === null, detail });
  return failed === null;
}

async function measureTests(m: Measuring, command: string): Promise<void> {
  const r = await m.step(command, "Measured test run: the repo's own test command", TEST_SECS);
  const counts = parseTestCounts(r.exec.raw);
  let value: string;
  let pass: boolean;
  let detail: string;
  if (r.exec.timedOut) {
    value = "timed out";
    pass = false;
    detail = `The test command had not finished after ${TEST_SECS} seconds.`;
  } else if (counts) {
    value = `${counts.passed}/${counts.total} passed`;
    pass = counts.failed === 0 && r.exec.code === 0;
    detail = `${counts.failed} failed, exit code ${r.exec.code}, ${r.exec.secs} s.`;
  } else {
    value = r.exec.code === 0 ? "suite passed" : "suite failed";
    pass = r.exec.code === 0;
    detail = `The runner printed no counts; exit code ${r.exec.code}, ${r.exec.secs} s.`;
  }
  m.metric({ id: "tests", label: "Test suite", value, pass, detail });
}

interface NpmAudit {
  metadata?: { vulnerabilities?: { high?: number; critical?: number } };
  error?: unknown;
}
interface PipAudit {
  dependencies?: { vulns?: unknown[] }[];
}

function jsonFrom<T>(raw: string): T | null {
  const t = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function measureAudit(m: Measuring): Promise<void> {
  const probe = await m.exec("ls package-lock.json requirements.txt 2>/dev/null", 20);
  const has = (file: string): boolean => probe.raw.split("\n").some((l) => l.trim() === file);
  if (has("package-lock.json")) {
    const r = await m.step("npm audit --omit=dev --json", "Measured dependency audit (npm, production dependencies)", AUDIT_SECS);
    const audit = jsonFrom<NpmAudit>(r.exec.raw);
    const v = audit?.metadata?.vulnerabilities;
    if (!v || audit?.error) {
      m.log("The npm audit did not return a result (no registry answer), so no audit metric is reported");
      return;
    }
    const high = v.high ?? 0;
    const critical = v.critical ?? 0;
    m.metric({ id: "audit", label: "Dependency audit", value: high + critical, unit: "high+critical", pass: high + critical === 0, detail: `npm audit of production dependencies: ${high} high, ${critical} critical.` });
  } else if (has("requirements.txt")) {
    const r = await m.step("pip-audit -r requirements.txt -f json --progress-spinner off", "Measured dependency audit (pip-audit)", AUDIT_SECS);
    const audit = jsonFrom<PipAudit>(r.exec.raw);
    if (!audit?.dependencies) {
      m.log("pip-audit did not return a result, so no audit metric is reported");
      return;
    }
    const vulnerable = audit.dependencies.filter((d) => (d.vulns?.length ?? 0) > 0).length;
    m.metric({ id: "audit", label: "Dependency audit", value: vulnerable, unit: "vulnerable packages", pass: vulnerable === 0, detail: `pip-audit of requirements.txt: ${vulnerable} package${vulnerable === 1 ? "" : "s"} with known vulnerabilities (pip-audit gives no severity).` });
  }
}

// Starts the app in the background and polls its health path from inside the container until it answers 200 or BOOT_SECS pass.
// Returns the session id of the app's process tree, or null when it never became healthy.
export async function startApp(m: Measuring, note: string): Promise<{ sid: string | null; stepN: number; secs: number | null; lastCode: string }> {
  const { start, port, healthPath } = m.triage;
  if (!start || !port) throw new Error("startApp needs triage.start and triage.port");
  const url = `http://127.0.0.1:${port}${healthPath ?? "/"}`;
  const script = `cat > ${START_FILE} <<'TESTREEL_START_EOF'
${start}
TESTREEL_START_EOF
T0=$(date +%s.%N)
PORT=${port} HOST=0.0.0.0 setsid nohup bash ${START_FILE} > ${APP_LOG} 2>&1 < /dev/null &
SID=$!
echo "started, pid $SID"
code=000
while [ $SECONDS -lt ${BOOT_SECS} ]; do
  code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 3 ${url} || true)
  if [ "$code" = 200 ]; then echo "READY $(awk "BEGIN{print $(date +%s.%N) - $T0}")"; break; fi
  kill -0 $SID 2>/dev/null || { echo "EXITED $code"; break; }
  sleep 0.5
done
[ "$code" = 200 ] || echo "LAST $code"
echo "--- app log (last lines) ---"
tail -n 25 ${APP_LOG}
echo "SID $SID"
[ "$code" = 200 ]`;
  const r = await m.step(script, note, BOOT_SECS + 30, APP_DIR, start);
  const ready = /^READY ([\d.]+)/m.exec(r.exec.raw);
  const last = /^(?:LAST|EXITED) (\d+)/m.exec(r.exec.raw)?.[1] ?? "000";
  const sid = /^SID (\d+)/m.exec(r.exec.raw)?.[1] ?? null;
  return { sid: ready ? sid : null, stepN: r.step.n, secs: ready ? Number(ready[1]) : null, lastCode: last };
}

async function measureBoot(m: Measuring): Promise<Measured> {
  const { healthPath } = m.triage;
  const b = await startApp(m, "Measured boot: start the app and wait for its health path to answer 200");
  const path = healthPath ?? "/";
  if (b.secs === null) {
    m.metric({ id: "boot", label: "Boot", value: BOOT_SECS, unit: "s", pass: false, detail: `The app did not answer 200 on ${path} within ${BOOT_SECS} seconds (last status ${b.lastCode}).` });
    m.metric({ id: "health", label: "Health check", value: `status ${b.lastCode}`, pass: false, detail: `GET ${path} never returned 200.` });
    return { appSid: null, bootStep: b.stepN };
  }
  m.metric({ id: "boot", label: "Boot", value: round1(b.secs), unit: "s", pass: true, detail: `Time from the start command to the first 200 on ${path}.` });
  m.metric({ id: "health", label: "Health check", value: "200 OK", pass: true, detail: `GET ${path} answered 200.` });
  const mem = await m.step(`ps -o rss= --sid ${b.sid} | awk '{s+=$1} END{printf "%.1f", s/1024}'`, "Measure the memory of the app's process tree", 20);
  const mb = Number(mem.exec.raw.trim());
  if (mem.exec.code === 0 && Number.isFinite(mb) && mb > 0) {
    m.metric({ id: "memory", label: "Memory", value: Math.round(mb), unit: "MB", pass: null, detail: "Resident memory of the app's process tree right after boot." });
  }
  return { appSid: b.sid, bootStep: b.stepN };
}

export async function measure(m: Measuring): Promise<Measured> {
  const t = m.triage;
  m.progress(3, "Cloning the repo");
  const clone = await m.step(`git clone --depth 1 --branch ${JSON.stringify(m.branch)} ${JSON.stringify(m.repoUrl)} app 2>&1`, "Clone the repository", 180, HOME);
  if (clone.exec.code !== 0) throw new Error(`Cloning ${m.repoUrl} failed: ${tidy(clone.exec.raw).slice(-200)}`);
  m.throwIfStopped();
  m.progress(6, "Installing");
  const installed = await measureInstall(m);
  m.throwIfStopped();
  if (installed) {
    if (t.testCommand) {
      m.progress(12, "Running the repo's tests");
      await measureTests(m, t.testCommand);
      m.throwIfStopped();
    }
    m.progress(16, "Auditing dependencies");
    await measureAudit(m);
    m.throwIfStopped();
    if (t.start && t.port) {
      m.progress(19, "Booting the app");
      const booted = await measureBoot(m);
      m.throwIfStopped();
      return booted;
    }
  } else if (t.start && t.port) {
    m.metric({ id: "health", label: "Health check", value: "not started", pass: false, detail: "The app was not started because the install failed." });
  }
  return { appSid: null, bootStep: null };
}
