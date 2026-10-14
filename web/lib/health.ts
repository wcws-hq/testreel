import type { Health, Mode } from "../../src/shared/types.ts";

export type CheckKey = Exclude<keyof Health, "settingsDir">;

export interface CheckInfo {
  key: CheckKey;
  label: string;
  hint: (settingsDir: string) => string;
  needed: (mode: Mode, autoUpload: boolean) => boolean;
}

export const CHECKS: CheckInfo[] = [
  { key: "docker", label: "Docker", hint: () => "Open Docker Desktop and wait until it reports that it is running.", needed: mode => mode === "test" },
  { key: "sandboxImage", label: "Sandbox image", hint: () => "Build the testreel-sandbox image once from the sandbox folder.", needed: mode => mode === "test" },
  { key: "kokoro", label: "Voice", hint: dir => `Check the Kokoro model files and the Python environment in ${dir}.`, needed: () => true },
  { key: "ffmpeg", label: "ffmpeg", hint: () => "Install ffmpeg, for example with brew install ffmpeg.", needed: () => true },
  { key: "chrome", label: "Chrome", hint: () => "Install Chrome for Testing, or set CHROME_PATH in the .env file.", needed: () => true },
  { key: "gateway", label: "Gateway", hint: () => "Set GATEWAY_URL, GATEWAY_API_KEY and GATEWAY_MODEL in the .env file next to package.json.", needed: () => true },
  {
    key: "youtube",
    label: "YouTube",
    hint: dir => `Add YT_CLIENT_ID and YT_CLIENT_SECRET to the .env file in ${dir}. Only needed for uploads.`,
    needed: (_mode, autoUpload) => autoUpload,
  },
];

export function blockingChecks(health: Health, mode: Mode, autoUpload: boolean): CheckInfo[] {
  return CHECKS.filter(c => c.needed(mode, autoUpload) && !health[c.key].ok);
}
