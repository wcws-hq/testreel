// Stage "repo": GitHub metadata and README into repo.json.
import type { RepoInfo } from "../shared/types.ts";
import type { Config } from "../server/config.ts";
import { writeJson } from "./ctx.ts";
import type { Stage } from "./ctx.ts";

const README_LIMIT = 12000;

interface ApiRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  topics?: string[];
  homepage: string | null;
  default_branch: string;
  pushed_at: string;
  created_at: string;
  archived: boolean;
  owner: { avatar_url: string };
}

// What a GitHub request needs. A RunCtx satisfies it.
export interface GithubEnv {
  config: Config;
  signal: AbortSignal;
}

export async function github(env: GithubEnv, path: string, accept: string): Promise<Response> {
  const headers: Record<string, string> = { accept, "user-agent": "testreel", "x-github-api-version": "2022-11-28" };
  if (env.config.githubToken) headers.authorization = `Bearer ${env.config.githubToken}`;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, { headers, signal: env.signal });
  } catch (e) {
    if (env.signal.aborted) throw new Error("cancelled");
    throw new Error(`Could not reach GitHub: ${e instanceof Error ? e.message : String(e)}`);
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const when = reset ? `at ${new Date(reset).toLocaleTimeString()}` : "later";
    throw new Error(`GitHub rate limit reached. It resets ${when}. Set GITHUB_TOKEN or sign in with the GitHub CLI (gh auth login) to raise the limit.`);
  }
  return res;
}

function normaliseHomepage(raw: string | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

// Metadata and README of one repo. `onNote` receives the facts the run log reports.
export async function fetchRepoInfo(env: GithubEnv, owner: string, name: string, onNote: (text: string) => void = () => {}): Promise<RepoInfo> {
  const res = await github(env, `/repos/${owner}/${name}`, "application/vnd.github+json");
  if (res.status === 404) throw new Error(`${owner}/${name} was not found on GitHub. It may be private or misspelled.`);
  if (res.status === 401) throw new Error("GitHub rejected GITHUB_TOKEN. Remove it or use a valid one.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${owner}/${name}`);
  const r = (await res.json()) as ApiRepo;

  if (r.archived) onNote("Note: this repository is archived, so it is read-only and probably unmaintained");

  let readme = "";
  const rr = await github(env, `/repos/${owner}/${name}/readme`, "application/vnd.github.raw+json");
  if (rr.ok) readme = await rr.text();
  else if (rr.status === 404) onNote("This repository has no README");
  else throw new Error(`GitHub returned ${rr.status} for the README`);
  if (readme.length > README_LIMIT) {
    onNote(`README is ${readme.length} characters, keeping the first ${README_LIMIT}`);
    readme = readme.slice(0, README_LIMIT);
  }

  return {
    fullName: r.full_name,
    url: r.html_url,
    description: r.description ?? "",
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    language: r.language,
    license: r.license ? (r.license.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : r.license.name) : null,
    topics: r.topics ?? [],
    homepage: normaliseHomepage(r.homepage),
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    createdAt: r.created_at,
    archived: r.archived,
    ownerAvatar: r.owner.avatar_url,
    readme,
  };
}

export const repoStage: Stage = async (ctx) => {
  const { owner, name } = ctx.run;
  ctx.log("repo", `Fetching ${owner}/${name} from GitHub`);
  const info = await fetchRepoInfo(ctx, owner, name, (text) => ctx.log("repo", text));
  writeJson(ctx.path("repo.json"), info);
  ctx.log("repo", `${info.fullName}: ${info.stars} stars, ${info.language ?? "no main language"}, README ${info.readme.length} characters`);
};
