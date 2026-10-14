// The single self-contained page for one video: fonts inlined as base64, the plan as JSON and the bundled runtime.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VideoPlan } from "./plan.ts";

const FONT_DIR = join(import.meta.dir, "fonts");
const FAMILIES: [string, string][] = [["Inter", "Inter.woff2"], ["JetBrains Mono", "JetBrainsMono.woff2"], ["Outfit", "Outfit.woff2"]];

// @font-face rules with the bundled OFL fonts embedded, so headless Chrome never falls back to a system font.
export function fontCss(): string {
  return FAMILIES.map(([family, file]) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(join(FONT_DIR, file)).toString("base64")}) format("woff2");font-weight:100 900;font-style:normal}`).join("\n");
}

export async function runtimeBundle(): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "runtime/main.ts")], target: "browser", format: "iife", minify: false });
  if (!built.success) throw new Error(`runtime bundle failed: ${built.logs.map((l) => l.message).join("; ")}`);
  const out = built.outputs[0];
  if (!out) throw new Error("runtime bundle produced no output");
  return out.text();
}

export function pageHtml(plan: VideoPlan, runtime: string): string {
  const json = JSON.stringify(plan).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}${fontCss()}</style></head><body><script>window.__PLAN__=${json};</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
