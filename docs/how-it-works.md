# How it works

## Layout

| Path | What lives there |
|------|------------------|
| `src/server` | HTTP API, live event stream (Server-Sent Events), run store, runner, settings |
| `src/pipeline` | One file per stage, plus the shared helpers (`ctx.ts`, `docker.ts`, `repo.ts`) |
| `src/pipeline/video` | The render engine: scene plan, HTML scene runtime, capture, encode |
| `src/pipeline/python` | The Kokoro voice worker |
| `src/shared/types.ts` | Types shared by the server and the web UI, including every JSON file a stage writes |
| `web` | The React UI, bundled by Bun at startup |
| `docker/sandbox.Dockerfile` | The throwaway test environment |
| `scripts` | Voice setup |

Each stage reads its inputs from files in the run folder and writes its outputs there (`repo.json`, `triage.json`, `test/log.json`, `score.json`, `scripts.json`, `final/...`). Because of that, a failed run can resume at the failed stage, and every artifact can be inspected after the fact.

Runs are stored in `<data dir>/runs/<id>`. Only rendered videos, thumbnails and screenshots are served over HTTP, never logs or inputs.

## Triage

1. Fixed rules over the repo files refuse the obvious cases: AI and LLM dependencies or topics, GPU mentions, paid API key names in the README or env examples, compose files with several services or a database image, desktop and mobile packages and folders, repos over 500 MB, and languages the sandbox cannot build.
2. For everything else one model call classifies the repo (web, api, cli or library) and writes the install, start, test and flow commands.
3. The commands are validated in code: allowed tools only, no `sudo`, `docker`, `curl` or `rm`, no secrets in flows, ports within a fixed range.
4. When it is not clear that the repo deploys easily without keys, the stage refuses.

The verdict is cached per repo and latest push for 6 hours. The paste check, the trending list and the run share the cache, so they always agree.

## Sandbox

The container is built from `docker/sandbox.Dockerfile` (Node 22, Python 3, uv, build tools, `pip-audit`). It runs with no mounts and no secrets, all capabilities dropped, `no-new-privileges`, 6 GB memory with no extra swap, 4 CPUs, 2048 processes, a 2 GB `/tmp`, published ports only on loopback, and a watchdog that stops it when its disk use passes the cap. It has internet access.

A measured phase runs first, in code: clone, install, the repo's tests, a dependency audit, start, health check and memory sample. A model agent then explores like a new user. For web apps the system replays each flow in a real headless Chrome on your machine against the published port and judges the real page state, then records the best flows with a visible cursor. Other apps are shown as a terminal replay of the real commands and output.

After every run the container, its volumes and the build cache are removed.

## Scoring

All four scores are computed in code and rounded to whole numbers from 0 to 10. The model writes the sentences only, and its numbers are checked against the data.

| Score | Formula |
|-------|---------|
| works | `(3 install + 3 health + 4 flows) / 10 x 10` for apps with a start command, `(4 install + 6 flows) / 10 x 10` otherwise. `install` and `health` are 1 when the metric passed. `flows` is flows that worked divided by flows tried |
| quality | weighted mean of tests (weight 4), dependency audit (2), flow correctness (3) and control (1). Parts that do not apply are left out |
| effort | `10` minus 0.5 per install command beyond two (max 3), minus install seconds / 90 (max 2), minus 2 per manual rescue (max 6), minus 3 for a failed install, minus 2 if the app never became healthy |
| speed | `0.6 install + 0.4 boot`, each 10 up to its fast time and falling linearly to 0 at its slow time (install 10 to 300 s, boot 2 to 60 s) |

The verdict comes from the average: USE at 7 or above, WATCH from 5 to 7, SKIP below 5.

## Video

The render engine is Testreel's own. Scenes are written as HTML and canvas, captured frame by frame by parallel headless Chrome workers, and encoded with ffmpeg together with the voice track and synthesized sound effects. The visual style is an OLED dark theme with kinetic text, animated bars, a scorecard and a verdict. Scripts are validated against the test log before they are voiced, so a claim the log does not support is rejected.

Limits: the long video's narration is capped at 585 seconds and the Short's at 56.5 seconds, so the finished videos stay under 10 minutes and 59 seconds.

## Concurrency

One run at a time. Docker, headless Chrome and the voice model each use most of what a laptop has, and the server returns 409 when a second run is started.
