// Settings. Everything comes from environment variables, read in this order (first one wins):
//   1. the real environment
//   2. a .env file in this folder
//   3. a .env file in the settings folder (default ~/.testreel, override with TESTREEL_SETTINGS)
// The settings folder also holds the local voice (a Python venv and the Kokoro model files) and the YouTube sign-in token.
// No credential has a default value, and none is ever written outside the settings folder.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = resolve(import.meta.dir, "../..");

function parseEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return out;
}

// The anonymous GitHub API allows 60 requests per hour, which one run and the repo checks exhaust. Reuse an existing sign-in; store nothing.
function ghCliToken(): string {
  try {
    const r = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
}

// Chrome for Testing from `bunx puppeteer browsers install chrome` (macOS), else the installed Google Chrome. CHROME_PATH overrides both.
function findChrome(): string {
  const base = join(homedir(), ".cache/puppeteer/chrome");
  if (existsSync(base)) {
    const v = readdirSync(base).sort().pop();
    for (const dir of ["chrome-mac-arm64", "chrome-mac-x64"]) {
      const p = v ? join(base, v, dir, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing") : "";
      if (p && existsSync(p)) return p;
    }
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

export interface Config {
  appDir: string;
  dataDir: string; // runs live in <dataDir>/runs/<id>
  settingsDir: string;
  chrome: string;
  sandboxImage: string;
  gateway: { url: string; key: string; model: string };
  kokoro: { python: string; model: string; voices: string; voiceA: string; voiceB: string; speed: number };
  youtube: { clientId: string; clientSecret: string; tokenFile: string };
  githubToken: string; // GITHUB_TOKEN, else the sign-in of the GitHub CLI (`gh auth token`); empty means the 60 requests per hour anonymous limit
  channelName: string;
  port: number;
}

export function loadConfig(): Config {
  const settingsDir = resolve(process.env.TESTREEL_SETTINGS || join(homedir(), ".testreel"));
  const env = { ...parseEnv(join(settingsDir, ".env")), ...parseEnv(join(APP_DIR, ".env")), ...process.env } as Record<string, string | undefined>;
  // Outside Desktop, Documents and Downloads on purpose: file optimizers re-encode MP4s there while a run still uses them.
  const defaultData = platform() === "darwin" ? join(homedir(), "Library/Application Support/Testreel") : join(homedir(), ".local/share/testreel");
  return {
    appDir: APP_DIR,
    dataDir: resolve(env.TESTREEL_DATA || defaultData),
    settingsDir,
    chrome: env.CHROME_PATH || findChrome(),
    sandboxImage: "testreel-sandbox",
    gateway: { url: (env.GATEWAY_URL || "").replace(/\/+$/, ""), key: env.GATEWAY_API_KEY || "", model: env.GATEWAY_MODEL || "" },
    kokoro: {
      python: env.KOKORO_PYTHON || join(settingsDir, ".venv/bin/python"),
      model: env.KOKORO_MODEL || join(settingsDir, "assets/kokoro/kokoro-v1.0.onnx"),
      voices: env.KOKORO_VOICES || join(settingsDir, "assets/kokoro/voices-v1.0.bin"),
      voiceA: env.KOKORO_VOICE_A || "af_heart",
      voiceB: env.KOKORO_VOICE_B || "am_fenrir",
      speed: Number(env.KOKORO_SPEED || 1),
    },
    youtube: { clientId: env.YT_CLIENT_ID || "", clientSecret: env.YT_CLIENT_SECRET || "", tokenFile: join(settingsDir, ".youtube/main.json") },
    githubToken: env.GITHUB_TOKEN || ghCliToken(),
    channelName: env.CHANNEL_NAME || "Testreel",
    port: Number(env.PORT || 4173),
  };
}
