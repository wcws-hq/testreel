// Small reusable pieces for scenes: masked word reveals, icons, count-up formatting, cards.
import { h, svg } from "./dom.ts";
import { ease, seg, rng } from "./ease.ts";
import { C } from "./theme.ts";

export function revealWords(inners: HTMLElement[], t: number, start: number, stagger = 0.07, dur = 0.7): void {
  inners.forEach((e, i) => {
    const p = ease.outExpo(seg(t, start + i * stagger, dur));
    e.style.transform = `translate3d(0,${((1 - p) * 112).toFixed(2)}%,0)`;
    e.style.opacity = p > 0 ? "1" : "0";
  });
}

export const ICONS = {
  star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z",
  fork: "M7 3a2.5 2.5 0 00-1 4.8V9a3 3 0 003 3h2v3.2a2.5 2.5 0 101.5 0V12h2a3 3 0 003-3V7.8a2.5 2.5 0 10-1.5 0V9a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 018.5 9V7.8A2.5 2.5 0 007 3z",
  issue: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4.5a1.3 1.3 0 011.3 1.3v4a1.3 1.3 0 01-2.6 0v-4A1.3 1.3 0 0112 7.5zm0 8.2a1.4 1.4 0 110 2.8 1.4 1.4 0 010-2.8z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
  bell: "M12 3a6 6 0 00-6 6v3.6L4.4 16a1 1 0 00.9 1.5h13.4a1 1 0 00.9-1.5L18 12.6V9a6 6 0 00-6-6zm-2 16a2 2 0 004 0z",
  quote: "M9.6 6C5.9 7.4 3.5 10.6 3.5 14.6V21h7v-7H7.3c.1-2.2 1.3-3.8 3.5-4.7zM20.6 6c-3.7 1.4-6.1 4.6-6.1 8.6V21h7v-7h-3.2c.1-2.2 1.3-3.8 3.5-4.7z",
  lock: "M7 10V8a5 5 0 0110 0v2h1a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zm2 0h6V8a3 3 0 00-6 0z",
} as const;

export function icon(parent: HTMLElement, name: keyof typeof ICONS, size: number, color: string, stroke = false): SVGSVGElement {
  const s = svg("svg", { width: size, height: size, viewBox: "0 0 24 24", style: "flex:none;display:block" }, parent);
  svg("path", stroke ? { d: ICONS[name], fill: "none", stroke: color, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" } : { d: ICONS[name], fill: color }, s);
  return s;
}

export function card(parent: HTMLElement, css: string): HTMLElement {
  return h("div", `background:linear-gradient(180deg,${C.card2},${C.card});border:1px solid ${C.line};border-radius:28px;${css}`, parent);
}

export function formatCount(target: number, p: number, fixedDecimals?: number): string {
  const decimals = fixedDecimals ?? (Number.isInteger(target) ? 0 : Math.min(2, (String(target).split(".")[1] ?? "").length));
  return (target * p).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const GLYPHS = "01ABCDEF<>/{}#$%";
// Characters resolve left to right out of noise; the noise is seeded by frame so every worker agrees.
export function scramble(text: string, p: number, frame: number): string {
  const r = rng(frame * 131 + 5);
  const done = Math.floor(p * text.length);
  return [...text].map((ch, i) => (i < done || ch === " " ? ch : GLYPHS.charAt(Math.floor(r() * GLYPHS.length)))).join("");
}
