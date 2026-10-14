// Ahead-of-run checks. A check is the run's own triage (refusal rules, then one model call) performed before anything is started,
// so "can be run" here means what a run would decide. Discovery scans GitHub trending in the background and keeps only repos that pass.
import type { Config } from "../server/config.ts";
import type { Candidate, Discovery, RepoCheck, TrendingPeriod } from "../shared/types.ts";
import { fetchRepoInfo } from "./repo.ts";
import { triageRepo } from "./triage.ts";

const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_TTL_MS = 30 * 60 * 1000;
const CONCURRENCY = 4;
// The overall page lists few repos; the language pages add the ones the sandbox (Node.js and Python) can build.
const TRENDING_PAGES = ["", "/javascript", "/typescript", "/python", "/html"];

const cache = new Map<string, { at: number; check: RepoCheck }>();
const inFlight = new Map<string, Promise<RepoCheck>>();

// Checks run on their own signal: several callers (typing in the form, a discovery scan) share one check, so none of them may cancel it.
const detached = new AbortController().signal;

export function checkRepo(config: Config, owner: string, name: string): Promise<RepoCheck> {
  const key = `${owner}/${name}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return Promise.resolve(hit.check);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const env = { config, signal: detached };
  const job = (async (): Promise<RepoCheck> => {
    const repo = await fetchRepoInfo(env, owner, name);
    const triage = await triageRepo(env, repo);
    const check: RepoCheck = {
      fullName: repo.fullName,
      url: repo.url,
      description: repo.description,
      stars: repo.stars,
      language: repo.language,
      runnable: triage.runnable,
      summary: triage.summary,
    };
    if (triage.runnable) check.kind = triage.kind;
    else check.reason = triage.refusal ?? "Testreel will not run this repo.";
    cache.set(key, { at: Date.now(), check });
    return check;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// ---- GitHub trending (there is no API for it, so the public page is read) ----

interface Trending {
  fullName: string;
  gained: number;
}

function parseTrending(html: string): Trending[] {
  const out: Trending[] = [];
  for (const article of html.split('<article class="Box-row">').slice(1)) {
    const name = article.match(/<h2 class="h3 lh-condensed">[\s\S]*?href="\/([\w.-]+\/[\w.-]+)"/)?.[1];
    if (!name) continue;
    const gained = article.match(/([\d,]+)\s+stars?\s+(?:today|this week|this month)/)?.[1];
    out.push({ fullName: name, gained: gained ? Number(gained.replace(/,/g, "")) : 0 });
  }
  return out;
}

async function fetchTrending(period: TrendingPeriod): Promise<Trending[]> {
  const pages = await Promise.allSettled(
    TRENDING_PAGES.map(async (page) => {
      const res = await fetch(`https://github.com/trending${page}?since=${period}`, { headers: { "user-agent": "Mozilla/5.0 testreel" } });
      if (!res.ok) throw new Error(`GitHub trending returned ${res.status}`);
      return parseTrending(await res.text());
    }),
  );
  const byName = new Map<string, Trending>();
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    for (const t of page.value) {
      const key = t.fullName.toLowerCase();
      const seen = byName.get(key);
      if (!seen || t.gained > seen.gained) byName.set(key, t);
    }
  }
  if (byName.size === 0) throw new Error("Could not read the GitHub trending page. Its layout may have changed, or GitHub is unreachable.");
  return [...byName.values()];
}

const discoveries = new Map<TrendingPeriod, Discovery>();

async function scan(config: Config, state: Discovery): Promise<void> {
  try {
    const list = await fetchTrending(state.period);
    state.total = list.length;
    let next = 0;
    let stop: Error | null = null;
    const worker = async (): Promise<void> => {
      while (!stop) {
        const t = list[next++];
        if (!t) return;
        const [owner, name] = t.fullName.split("/") as [string, string];
        try {
          const check = await checkRepo(config, owner, name);
          if (check.runnable) {
            const candidate: Candidate = { ...check, starsGained: t.gained };
            state.found.push(candidate);
            state.found.sort((a, b) => b.starsGained - a.starsGained);
          }
        } catch (e) {
          // A repo that vanished or could not be classified is skipped; a rate limit or an unreachable model would fail every repo.
          const message = e instanceof Error ? e.message : String(e);
          if (/rate limit|GATEWAY_API_KEY|Could not reach GitHub/.test(message)) stop = new Error(message);
        }
        state.scanned++;
        state.updatedAt = new Date().toISOString();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (stop) throw stop;
    state.status = "done";
  } catch (e) {
    state.status = "failed";
    state.error = e instanceof Error ? e.message : String(e);
  }
  state.updatedAt = new Date().toISOString();
}

// Returns the current scan for the period, starting one when there is none or the last one is old.
export function discover(config: Config, period: TrendingPeriod): Discovery {
  const current = discoveries.get(period);
  if (current && (current.status === "running" || (current.status === "done" && Date.now() - Date.parse(current.updatedAt) < DISCOVERY_TTL_MS))) return current;
  const state: Discovery = { period, status: "running", scanned: 0, total: 0, found: [], updatedAt: new Date().toISOString() };
  discoveries.set(period, state);
  void scan(config, state);
  return state;
}
