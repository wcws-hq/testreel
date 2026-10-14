// Shared contracts between server, pipeline modules and the web UI. Pure types, no runtime code.

export type VideoKind = "full" | "short";
export type Mode = "test" | "explain"; // test = run it in a Docker sandbox and score it; explain = README-only, never claims testing
export type Verdict = "USE" | "WATCH" | "SKIP";

// ---- stages, in run order ----
export const STAGES = ["repo", "triage", "sandbox", "score", "capture", "script", "voice", "render", "thumbnails", "package"] as const;
export type StageId = (typeof STAGES)[number];
export const STAGE_LABEL: Record<StageId, string> = {
  repo: "Reading the repo",
  triage: "Checking it can be tested",
  sandbox: "Testing in a throwaway container",
  score: "Scoring",
  capture: "Capturing screens",
  script: "Writing scripts and metadata",
  voice: "Recording voice",
  render: "Rendering video",
  thumbnails: "Designing thumbnails",
  package: "Packaging",
};
export type StageState = "pending" | "running" | "done" | "failed" | "skipped";

// ---- run (one repo -> one long video + one short) ----
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export interface Run {
  id: string;
  repoUrl: string; // canonical https://github.com/owner/repo
  owner: string;
  name: string;
  mode: Mode;
  autoUpload: boolean;
  status: RunStatus;
  stage: StageId | null; // stage currently running (or the one that failed)
  stages: Record<StageId, { state: StageState; startedAt?: number; endedAt?: number; error?: string }>;
  createdAt: number;
  endedAt?: number;
  error?: string;
}

// ---- repo.json ----
export interface RepoInfo {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  defaultBranch: string;
  pushedAt: string;
  createdAt: string;
  archived: boolean;
  ownerAvatar: string;
  readme: string; // truncated to ~12k chars
}

// ---- triage.json (test mode only; the run fails at this stage when runnable is false, showing `refusal`) ----
export type AppKind = "web" | "cli" | "api" | "library" | "other";
export interface Triage {
  kind: AppKind;
  runnable: boolean; // false for AI/LLM/model repos, GPU or paid-key needs, huge downloads, multi-service (docker-compose) apps, desktop/mobile apps
  refusal?: string; // one plain sentence for the user when runnable is false
  summary: string; // what the app is, one sentence
  install: string[]; // shell commands that install/build it inside the sandbox
  start?: string; // shell command that starts it (web/api), runs in the background
  port?: number; // 18000-18009
  healthPath?: string; // e.g. "/" or "/health"
  testCommand?: string; // the repo's own test command, when one exists
  flows: string[]; // 2-5 user-visible things to try (web: pages/actions; cli: example invocations)
}

// ---- sandbox test: test/log.json ----
export interface TestStep { n: number; cmd: string; note: string; exit: number; secs: number; out: string }
export interface TestShot { file: string; url: string; caption: string; afterStep: number } // file lives in test/shots/
// A screen recording of the app being used (web: real browser video; cli: terminal session). mp4 in test/rec/, H.264, 1920x1080, 30 fps.
export interface TestRecording { file: string; caption: string; secs: number; afterStep: number }
// One measured fact. pass null = informational. These, not the model, decide the score.
export interface Metric { id: "install" | "boot" | "health" | "tests" | "flows" | "audit" | "memory"; label: string; value: number | string; unit?: string; pass: boolean | null; detail: string }
export interface TestLog { tool: string; url: string; totalSecs: number; agentSummary: string; steps: TestStep[]; shots: TestShot[]; recordings: TestRecording[]; metrics: Metric[] }

// ---- score.json ----
export interface Score {
  metrics: Metric[]; // copied from the log; scores are computed from these in code
  scores: { works: number; quality: number; effort: number; speed: number }; // 0..10
  reasons: { works: string; quality: string; effort: string; speed: string };
  verdict: Verdict; // USE avg>=7, WATCH 5..7, SKIP <5
  average: number; // one decimal
  oneLine: string;
  limitations: string[];
}

// ---- scripts.json ----
// A scene is what is on screen while a section is narrated. The video engine owns the look of each kind.
export type Scene =
  | { kind: "hook"; lines: string[] } // 1-3 short kinetic lines, last one accented
  | { kind: "repo" } // animated repo card from repo.json
  | { kind: "browser"; shot: string; caption?: string; focus?: "top" | "middle" | "bottom" } // shot = file in shots/ (page capture) or "t-<file>" (sandbox shot)
  | { kind: "footage"; recording: string; caption?: string } // recording = TestRecording.file in test/rec/; plays the real screen recording
  | { kind: "terminal"; steps: number[] } // replay these test steps (TestStep.n): typed commands, real output excerpts
  | { kind: "stats"; items: { label: string; value: number | string; suffix?: string }[] } // 2-4 count-up numbers
  | { kind: "bars"; title: string; items: { label: string; value: number; max?: number; unit?: string }[] }
  | { kind: "points"; title: string; items: string[] } // 2-5 items, revealed one by one
  | { kind: "quote"; text: string; attribution?: string }
  | { kind: "scorecard" } // four animated gauges from score.json
  | { kind: "verdict" } // big verdict from score.json
  | { kind: "cta" }; // outro / subscribe

export interface Section {
  id: string; // stable, unique within the script, e.g. "s1"
  title: string; // short chapter title, shown in chapters and as a kinetic title
  voice: "A" | "B";
  voiceover: string; // may contain [pause] (0.7 s) and [beat] (0.35 s)
  scene: Scene;
  callout?: string; // short phrase that pops on screen when spoken (must appear verbatim in voiceover)
}

export interface Script {
  type: VideoKind;
  titles: string[]; // 3 options, <= 70 chars, no clickbait lies; titles[0] is the default
  description: string; // plain text, no chapters (added by the package stage), includes source links
  tags: string[]; // total <= 450 chars
  hashtags: string[]; // 3
  thumbnailTexts: string[]; // 3 options, <= 4 words and <= 20 chars each, UPPERCASE
  pinnedComment: string;
  sections: Section[];
}
export interface Scripts { full: Script; short: Script }
// Limits the whole pipeline enforces.
export const MAX_FULL_SECONDS = 600;
export const MAX_SHORT_SECONDS = 59;
// Video timeline: the full video opens with a title card and closes with an outro card; both kinds end with a silent tail.
// final duration = INTRO + voice.wav duration + TAIL + OUTRO, so the voice budget is what is left of the maximum.
export const TIMELINE = { full: { intro: 3, tail: 1.2, outro: 5 }, short: { intro: 0, tail: 0.8, outro: 0 } } as const;
export const MAX_VOICE_SECONDS = { full: 585, short: 56.5 } as const;

// ---- voice/<kind>/timings.json (voice.wav sits next to it: 44.1 kHz mono) ----
export interface WordTime { w: string; s: number; e: number } // seconds from the start of voice.wav
export interface SectionTiming { id: string; title: string; start: number; end: number; speechStart: number; speechEnd: number; words: WordTime[] }
export interface Timings { total: number; lead: number; sections: SectionTiming[] }

// ---- final/<kind>/video.mp4 (1920x1080 full, 1080x1920 short), thumb-1..3.jpg (1280x720 full, 1080x1920 short, each < 2 MB), meta.json
// ---- final/<kind>/meta.json (written by the package stage; this is what gets uploaded) ----
export interface Chapter { t: number; title: string } // t in seconds
export interface FinalMeta {
  kind: VideoKind;
  title: string; // chosen title (default titles[0])
  titles: string[];
  description: string; // includes chapters (full only) and the disclosure line
  tags: string[];
  hashtags: string[];
  thumbnailTexts: string[];
  thumbnail: number; // 1-based index of the chosen thumb-N.jpg
  pinnedComment: string;
  durationSec: number;
  chapters: Chapter[];
}
export interface UploadRecord { kind: VideoKind; videoId: string; url: string; privacy: "private" | "unlisted" | "public"; publishAt?: string; at: number }

// ---- live events (SSE and events.jsonl) ----
interface Base { seq: number; t: number } // t = epoch ms
export type RunEvent =
  | (Base & { kind: "stage"; stage: StageId; state: StageState; detail?: string })
  | (Base & { kind: "log"; stage: StageId; text: string })
  | (Base & { kind: "progress"; stage: StageId; video?: VideoKind; pct: number; label: string }) // pct 0..100
  | (Base & { kind: "sandbox"; phase: "start" | "stop"; container: string })
  | (Base & { kind: "agent-note"; n: number; text: string })
  | (Base & { kind: "cmd"; n: number; cmd: string })
  | (Base & { kind: "cmd-out"; n: number; exit: number; secs: number; out: string })
  | (Base & { kind: "metric"; metric: Metric })
  | (Base & { kind: "shot"; file: string; caption: string }) // sandbox screenshot, served at /api/runs/:id/files/test/shots/<file>
  | (Base & { kind: "score"; score: Score })
  | (Base & { kind: "artifact"; name: "scripts" | "voice" | "video" | "thumbnails" | "meta"; video?: VideoKind })
  | (Base & { kind: "run"; status: RunStatus; error?: string });
// What a stage emits (server adds seq and t).
export type EmitEvent = RunEvent extends infer E ? (E extends Base ? Omit<E, "seq" | "t"> : never) : never;

// ---- HTTP API (all JSON unless noted) ----
// GET  /api/health                 -> Health
// GET  /api/runs                   -> Run[] (newest first)
// POST /api/runs {repo, mode, autoUpload?} -> Run | {error, covered?: {runId}} (409 when a run is active, 400 bad url)
// GET  /api/runs/:id               -> RunDetail
// GET  /api/runs/:id/events        -> text/event-stream of RunEvent (replays all, then live; honours Last-Event-ID)
// POST /api/runs/:id/cancel        -> Run
// POST /api/runs/:id/retry         -> Run (re-runs from the failed stage)
// GET  /api/runs/:id/files/<path>  -> file bytes (whitelisted: final/**, test/shots/**, test/rec/**, shots/**), Range supported
// POST /api/runs/:id/thumbnail {kind, index} -> FinalMeta (choose thumb-N)
// POST /api/runs/:id/title {kind, title}     -> FinalMeta
// POST /api/runs/:id/upload {kind, privacy, publishAt?} -> UploadRecord
// GET  /api/youtube                -> YoutubeStatus
// POST /api/youtube/connect        -> {url}  (open it; the server finishes the sign-in on its loopback callback)
// POST /api/youtube/disconnect     -> YoutubeStatus
export interface Check { ok: boolean; detail: string }
export interface Health { docker: Check; sandboxImage: Check; ffmpeg: Check; chrome: Check; kokoro: Check; gateway: Check; youtube: Check; settingsDir: string }
export interface YoutubeStatus { configured: boolean; connected: boolean; channelTitle?: string }
export interface RunDetail {
  run: Run;
  repo?: RepoInfo;
  triage?: Triage;
  log?: TestLog;
  score?: Score;
  scripts?: Scripts;
  meta: Partial<Record<VideoKind, FinalMeta>>;
  uploads: UploadRecord[];
  files: { video: Partial<Record<VideoKind, string>>; thumbs: Partial<Record<VideoKind, string[]>> }; // paths relative to /api/runs/:id/files/
}

// ---- GET /api/check?repo=<url>  and  GET /api/discover?since=daily|weekly ----
// The same triage a run starts with, run ahead of time. `runnable` false carries the plain-sentence `reason`.
export interface RepoCheck {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  runnable: boolean;
  kind?: AppKind; // when runnable
  summary: string; // what the app is
  reason?: string; // when not runnable
}
export const TRENDING_PERIODS = ["daily", "weekly"] as const;
export type TrendingPeriod = (typeof TRENDING_PERIODS)[number];
export interface Candidate extends RepoCheck {
  starsGained: number; // stars gained in the period, from the GitHub trending page
}
// A discovery job scans GitHub trending in the background; `found` only ever holds repos that passed the check.
export interface Discovery {
  period: TrendingPeriod;
  status: "running" | "done" | "failed";
  scanned: number;
  total: number;
  found: Candidate[]; // sorted by starsGained, highest first
  error?: string;
  updatedAt: string;
}
