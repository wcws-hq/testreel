# Contributing

Thanks for helping. Bug reports with the run's `events.jsonl` (secrets removed) are the most useful thing you can send.

## Setup

Follow [docs/setup.md](docs/setup.md), then `bun run dev` for hot reload.

## Before a pull request

- `bun run typecheck` must pass. CI runs it.
- Keep changes small and say what you ran to check them. For UI changes, include a screenshot.
- Do not add dead code, unused exports or duplicate helpers. `noUnusedLocals` and `noUnusedParameters` are on.
- New numbers in a video, a score or a script must come from measured data. The model writes words, code produces numbers.
- Never commit `.env`, keys, tokens, run data, renders or model files. `.gitignore` covers them, and a pull request that adds one will be closed.

## Ideas that are welcome

Linux support, more toolchains in the sandbox image, other upload targets, more scene types, and tests for the scoring and the command validator.
