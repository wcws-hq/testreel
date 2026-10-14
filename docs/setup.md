# Setup

Tested on macOS with Apple Silicon. Intel Macs should work. Linux has not been tried: the code avoids macOS-only calls, but the Chrome lookup and defaults assume macOS, so expect to set `CHROME_PATH` and check the voice step yourself.

## What you need

| Tool | Why | Install (macOS) |
|------|-----|-----------------|
| [Bun](https://bun.sh) 1.3 or newer | runs the server and builds the web UI | `brew install oven-sh/bun/bun` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | the throwaway test containers | install and start it |
| ffmpeg | encodes video and normalises audio | `brew install ffmpeg` |
| Chrome for Testing | records web apps and renders the video scenes | `bunx puppeteer browsers install chrome` |
| Python 3.10 to 3.12 | the local voice | `brew install python@3.12` |
| A model gateway | writes the triage, test plans and scripts | see below |

Disk: the sandbox image is about 2 GB, the voice models about 350 MB, and the speech-timing model about 460 MB the first time it is used. A finished run is about 60 MB. Memory: each test container may use up to 6 GB and 4 CPUs while Docker, Chrome and the voice run on the same machine, so 16 GB of RAM is a sensible minimum.

## 1. Install

```sh
git clone https://github.com/<you>/testreel.git
cd testreel
bun install
cp .env.example .env
```

## 2. The model gateway

Testreel needs a chat model that answers on the OpenAI chat completions API. Set three values in `.env`:

```
GATEWAY_URL=https://your-gateway.example.com      # base URL, no /v1, no trailing slash
GATEWAY_API_KEY=...
GATEWAY_MODEL=...                                 # the model name your gateway expects
```

Testreel calls `POST {GATEWAY_URL}/v1/chat/completions`. This works with OpenAI, OpenRouter, a LiteLLM or other proxy in front of Claude, and local servers such as Ollama. A strong model gives much better results: the model decides whether a repo can be run, writes the install and start commands, drives the browser tests and writes the video scripts. Small models tend to fail the validation steps.

Each run makes roughly 30 to 80 model calls. Check your provider's pricing.

## 3. The voice

```sh
bash scripts/setup-voice.sh
```

This creates a Python environment and downloads the Kokoro text-to-speech model into `~/.testreel` (or `$TESTREEL_SETTINGS`). It is safe to run again. Use `--no-models` to skip the downloads if you already have the two model files, and point `KOKORO_MODEL` and `KOKORO_VOICES` at them.

The first run also downloads the `small.en` speech recognition model, which is used only to time each spoken word. It is not shown as captions.

## 4. Chrome

```sh
bunx puppeteer browsers install chrome
```

Testreel finds it in `~/.cache/puppeteer`. To use another Chrome, set `CHROME_PATH` in `.env`.

## 5. Start

```sh
bun run start
```

Open <http://127.0.0.1:4173>. The chips under the form show what is missing: Docker, sandbox image, voice, ffmpeg, Chrome, gateway and YouTube. The sandbox image is built automatically on the first run, which takes a few minutes.

Paste a GitHub URL. Testreel checks right away whether it can run the repo and tells you why when it cannot. Below the form, "Trending, and runnable" lists trending repos that pass the same check.

Good first repos: small React apps, static file servers, and command line tools written in JavaScript or Python.

## 6. YouTube (optional)

See [youtube.md](youtube.md).

## Settings reference

All of these are environment variables, read from the real environment, then `.env` next to `package.json`, then `.env` in the settings folder.

| Variable | Default | Meaning |
|----------|---------|---------|
| `GATEWAY_URL`, `GATEWAY_API_KEY`, `GATEWAY_MODEL` | none, required | the chat model |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET` | none | YouTube upload |
| `GITHUB_TOKEN` | the GitHub CLI sign-in, if any | raises the GitHub API limit from 60 to 5000 an hour |
| `CHANNEL_NAME` | `Testreel` | name shown on the outro card |
| `KOKORO_VOICE_A`, `KOKORO_VOICE_B` | `af_heart`, `am_fenrir` | the two narrator voices |
| `KOKORO_SPEED` | `1` | speaking speed |
| `PORT` | `4173` | web UI port, always bound to 127.0.0.1 |
| `TESTREEL_SETTINGS` | `~/.testreel` | voice environment, models, YouTube token |
| `TESTREEL_DATA` | `~/Library/Application Support/Testreel` on macOS, `~/.local/share/testreel` elsewhere | where runs are stored |
| `CHROME_PATH` | auto | Chrome executable |
| `KOKORO_PYTHON`, `KOKORO_MODEL`, `KOKORO_VOICES` | inside the settings folder | custom voice locations |

Keep the data folder out of Desktop, Documents and Downloads. File optimizers such as Clop re-encode MP4s in those folders while a run is still using them, which corrupts the render.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| A chip is red | Hover or read the hint under the form, each one names the missing piece |
| `GitHub rate limit reached` | Set `GITHUB_TOKEN`, or run `gh auth login` |
| Sandbox image build fails | Check Docker is running and has internet. Run `docker build -f docker/sandbox.Dockerfile docker` to see the full output |
| `Kokoro python is missing` | Run `bash scripts/setup-voice.sh` |
| Check says "could not check ahead of time" | The gateway or GitHub was unreachable. The run checks again when it starts |
| Videos stay private on YouTube | See "Things that surprise people" in [youtube.md](youtube.md) |
| Upload asks to connect every week | Google expires tokens after 7 days while the consent screen is in Testing |
