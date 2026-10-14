import type { Discovery, FinalMeta, Health, Mode, RepoCheck, Run, RunDetail, TrendingPeriod, UploadRecord, VideoKind, YoutubeStatus } from "../src/shared/types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly coveredRunId?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const failure = (data ?? {}) as { error?: string; covered?: { runId?: string } };
    throw new ApiError(failure.error ?? `Request failed with status ${res.status}`, res.status, failure.covered?.runId);
  }
  return data as T;
}

export const api = {
  health: () => request<Health>("GET", "/api/health"),
  runs: () => request<Run[]>("GET", "/api/runs"),
  createRun: (repo: string, mode: Mode, autoUpload: boolean) => request<Run>("POST", "/api/runs", { repo, mode, autoUpload }),
  deleteRun: (id: string) => request<{ deleted: number }>("DELETE", `/api/runs/${id}`),
  deleteAllRuns: () => request<{ deleted: number; kept: number }>("DELETE", "/api/runs"),
  check: (repoUrl: string) => request<RepoCheck>("GET", `/api/check?repo=${encodeURIComponent(repoUrl)}`),
  discover: (since: TrendingPeriod) => request<Discovery>("GET", `/api/discover?since=${since}`),
  run: (id: string) => request<RunDetail>("GET", `/api/runs/${id}`),
  cancel: (id: string) => request<{ cancelling: boolean }>("POST", `/api/runs/${id}/cancel`),
  retry: (id: string) => request<Run>("POST", `/api/runs/${id}/retry`),
  chooseThumbnail: (id: string, kind: VideoKind, index: number) => request<FinalMeta>("POST", `/api/runs/${id}/thumbnail`, { kind, index }),
  setTitle: (id: string, kind: VideoKind, title: string) => request<FinalMeta>("POST", `/api/runs/${id}/title`, { kind, title }),
  upload: (id: string, kind: VideoKind, privacy: UploadRecord["privacy"], publishAt?: string) =>
    request<UploadRecord>("POST", `/api/runs/${id}/upload`, publishAt ? { kind, privacy, publishAt } : { kind, privacy }),
  youtube: () => request<YoutubeStatus>("GET", "/api/youtube"),
  youtubeConnect: () => request<{ url: string }>("POST", "/api/youtube/connect"),
  youtubeDisconnect: () => request<YoutubeStatus>("POST", "/api/youtube/disconnect"),
};

// Run files are served from /api/runs/:id/files/<path>; `?download` asks for an attachment.
export const fileUrl = (id: string, path: string, download = false): string =>
  `/api/runs/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}${download ? "?download" : ""}`;
