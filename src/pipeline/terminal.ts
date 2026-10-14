// A terminal-style session rendered in headless Chrome from REAL commands and REAL output (taken from the test log):
// the command is typed out, the output appears line by line. The page animates in real time while Screencast records it.
import type { Page } from "puppeteer-core";
import { fontCss } from "./video/page.ts";

export interface TerminalItem {
  cmd: string;
  out: string;
  exit: number;
}

const MAX_CMD_LINES = 6;
const MAX_OUT_HEAD = 8;
const MAX_OUT_TAIL = 16;
const MIN_TOTAL_MS = 10000;

const CSS = `
html,body{margin:0;height:100%;background:radial-gradient(1200px 700px at 50% 20%,#1a2233,#0a0d13)}
.win{position:absolute;inset:70px 110px;border-radius:18px;background:#0d1117;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px #263041;display:flex;flex-direction:column;overflow:hidden}
.bar{height:58px;flex:none;display:flex;align-items:center;gap:14px;padding:0 24px;background:#161b24;border-bottom:1px solid #263041;font:500 20px Inter,sans-serif;color:#7d8aa0}
.dot{width:16px;height:16px;border-radius:50%}
#term{flex:1;overflow:hidden;padding:30px 40px;font:400 29px/1.45 "JetBrains Mono",monospace;color:#e6edf3;white-space:pre-wrap;word-break:break-word}
.p{color:#7ee787}.d{color:#7d8aa0}.x{color:#ff7b72}.cur{display:inline-block;width:.6em;height:1.1em;margin-left:2px;background:#e6edf3;vertical-align:-.18em;animation:b 1s steps(1) infinite}
@keyframes b{50%{opacity:0}}`;

const PLAYER = `
window.__play = async (items, minTotal) => {
  const term = document.getElementById("term");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  const cur = document.createElement("span");
  cur.className = "cur";
  const down = () => { term.scrollTop = term.scrollHeight; };
  for (const it of items) {
    const line = document.createElement("div");
    const prompt = document.createElement("span");
    prompt.className = "p";
    prompt.textContent = "node@sandbox:~/app$ ";
    const typed = document.createElement("span");
    line.append(prompt, typed, cur);
    term.append(line);
    down();
    await sleep(500);
    const chars = [...it.cmd];
    const perTick = Math.max(1, Math.ceil(chars.length / 140));
    const delay = Math.min(70, Math.max(24, 3500 / Math.max(1, chars.length / perTick)));
    for (let c = 0; c < chars.length; c += perTick) {
      typed.textContent += chars.slice(c, c + perTick).join("");
      down();
      await sleep(delay * (0.7 + Math.random() * 0.6));
    }
    await sleep(450);
    cur.remove();
    const lines = it.out === "" ? [] : it.out.split("\\n");
    const chunk = lines.length <= 10 ? 1 : Math.ceil(lines.length / 22);
    for (let i = 0; i < lines.length; i += chunk) {
      const row = document.createElement("div");
      row.textContent = lines.slice(i, i + chunk).join("\\n") || " ";
      if (/^\\[\\.\\.\\./.test(lines[i])) row.className = "d";
      term.append(row);
      down();
      await sleep(lines.length <= 10 ? 130 : 70);
    }
    if (it.exit !== 0) {
      const row = document.createElement("div");
      row.className = "x";
      row.textContent = "exit code " + it.exit;
      term.append(row);
      down();
    }
    await sleep(Math.min(5000, 1500 + lines.length * 160));
  }
  const prompt = document.createElement("div");
  prompt.innerHTML = '<span class="p">node@sandbox:~/app$ </span>';
  prompt.append(cur);
  term.append(prompt);
  down();
  await sleep(Math.max(1200, minTotal - (performance.now() - t0)));
};`;

// Keeps the head and tail of a long output so it fits the window; the cut is marked like in the log.
function fit(out: string): string {
  const lines = out.split("\n");
  if (lines.length <= MAX_OUT_HEAD + MAX_OUT_TAIL) return out;
  return [...lines.slice(0, MAX_OUT_HEAD), `[... ${lines.length - MAX_OUT_HEAD - MAX_OUT_TAIL} lines not shown ...]`, ...lines.slice(-MAX_OUT_TAIL)].join("\n");
}

function fitCmd(cmd: string): string {
  const lines = cmd.trim().split("\n");
  return lines.length <= MAX_CMD_LINES ? lines.join("\n") : `${lines.slice(0, MAX_CMD_LINES).join("\n")}\n...`;
}

// Loads the terminal window into the page and plays the items; resolves when the session has finished.
export async function playTerminal(page: Page, title: string, items: TerminalItem[]): Promise<void> {
  const esc = title.replace(/[&<>"]/g, "");
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss()}${CSS}</style></head><body><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span style="margin-left:14px">${esc}: bash</span></div><div id="term"></div></div><script>${PLAYER}</script></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const shown = items.map((i) => ({ cmd: fitCmd(i.cmd), out: fit(i.out), exit: i.exit }));
  await page.evaluate(`window.__play(${JSON.stringify(shown)}, ${MIN_TOTAL_MS})`);
}
