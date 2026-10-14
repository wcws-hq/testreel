// What every pipeline stage receives. A stage reads its inputs from files in ctx.dir, writes its outputs there,
// reports progress through ctx.emit, and must honour ctx.signal (cancel) by stopping child processes and containers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../server/config.ts";
import type { EmitEvent, Run, StageId } from "../shared/types.ts";

export interface RunCtx {
  run: Run;
  dir: string; // absolute run directory: <dataDir>/runs/<id>
  config: Config;
  signal: AbortSignal;
  emit(e: EmitEvent): void;
  log(stage: StageId, text: string): void;
  path(...p: string[]): string; // join(dir, ...p), parent folders are NOT created (use writeJson or mkdirSync)
}

export type Stage = (ctx: RunCtx) => Promise<void>;

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
export function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}


// Canonical https://github.com/owner/repo from whatever the user typed, or null.
export function parseRepoUrl(input: string): { url: string; owner: string; name: string } | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!m?.[1] || !m[2]) return null;
  return { url: `https://github.com/${m[1]}/${m[2]}`, owner: m[1], name: m[2] };
}

// One chat completion through the gateway (OpenAI-compatible). Retries 3 times. Never logs the key.
export async function chat(config: Config, messages: { role: "system" | "user" | "assistant"; content: string }[], maxTokens = 4000, signal?: AbortSignal): Promise<string> {
  if (!config.gateway.key || !config.gateway.url || !config.gateway.model) throw new Error("GATEWAY_URL, GATEWAY_API_KEY and GATEWAY_MODEL must all be set in .env (see .env.example)");
  let err: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { authorization: `Bearer ${config.gateway.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.gateway.model, max_tokens: maxTokens, messages }),
      };
      if (signal) init.signal = signal;
      const r = await fetch(`${config.gateway.url}/v1/chat/completions`, init);
      if (!r.ok) throw new Error(`gateway ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0]?.message.content ?? "";
    } catch (e) {
      if (signal?.aborted) throw e;
      err = e;
    }
  }
  throw err;
}

// Extracts the first JSON object from a model reply (tolerates code fences).
export function parseJsonObject<T>(txt: string): T {
  const t = txt.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as T;
}
