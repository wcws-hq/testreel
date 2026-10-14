// DOM helpers: terse element creation, transforms and text fitting. Everything here is synchronous and deterministic.
import { C, FONT } from "./theme.ts";

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export function tf(e: HTMLElement, x = 0, y = 0, s = 1, r = 0): void {
  e.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
}

export const abs = "position:absolute;left:0;top:0;";
export const fill = "position:absolute;inset:0;";

// Words that slide up out of a mask. Returns the inner spans in reading order.
export function maskedWords(parent: HTMLElement, text: string, css: string): HTMLElement[] {
  const inners: HTMLElement[] = [];
  text.split(/\s+/).filter(Boolean).forEach((word, i) => {
    if (i > 0) parent.appendChild(document.createTextNode(" "));
    const wrap = h("span", "display:inline-block;overflow:hidden;vertical-align:top;padding:0.12em 0.04em 0.2em;margin:-0.12em -0.04em -0.2em", parent);
    inners.push(h("span", `display:inline-block;${css}`, wrap, word));
  });
  return inners;
}

// Largest font size (px) at which `text` wraps into at most `maxH` pixels of height inside `maxW`.
// `words` measures the text as maskedWords lays it out (one inline-block per word), with a small width safety margin.
function probeFor(text: string, style: string, width: number, words: boolean): HTMLElement {
  const probe = h("div", `position:absolute;left:-99999px;top:0;visibility:hidden;width:${words ? width * 0.97 : width}px;${style}`, document.body, words ? undefined : text);
  if (words) maskedWords(probe, text, "");
  return probe;
}

export function fitFont(text: string, style: string, maxW: number, maxH: number, max: number, min: number, words = false): number {
  const probe = probeFor(text, style, maxW, words);
  let lo = min;
  let hi = max;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = `${mid}px`;
    if (probe.scrollHeight <= maxH && probe.scrollWidth <= maxW + 1) lo = mid;
    else hi = mid - 1;
  }
  probe.style.fontSize = `${hi}px`;
  const size = probe.scrollHeight <= maxH && probe.scrollWidth <= maxW + 1 ? hi : lo;
  probe.remove();
  return size;
}

// Single-line variant: width of the text at `size` px.
export function textWidth(text: string, style: string, size: number): number {
  const probe = h("span", `position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;font-size:${size}px;${style}`, document.body, text);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

export function textHeight(text: string, style: string, width: number, size: number, words = false): number {
  const probe = probeFor(text, style, width, words);
  probe.style.fontSize = `${size}px`;
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

// Longest word-boundary prefix of `text` that fits `maxLines` lines at `size` px, with an ellipsis when something was cut.
export function clampWords(text: string, style: string, width: number, size: number, maxLines: number): string {
  const lineH = textHeight("M", style, width, size);
  const fits = (t: string) => textHeight(t, style, width, size) <= lineH * maxLines + 1;
  if (fits(text)) return text;
  const words = text.split(/\s+/);
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(`${words.slice(0, mid).join(" ")}\u2026`)) lo = mid;
    else hi = mid - 1;
  }
  return `${words.slice(0, lo).join(" ").replace(/[,;:.\-\u2013]+$/, "")}\u2026`;
}

export function fitLine(text: string, style: string, maxW: number, max: number, min: number): number {
  const w = textWidth(text, style, max);
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / w));
}

export const T = {
  display: `font-family:${FONT.display};color:${C.text};letter-spacing:-0.035em;line-height:1.02;font-weight:800;`,
  mono: `font-family:${FONT.mono};color:${C.text};font-weight:500;`,
  num: `font-family:${FONT.num};color:${C.text};font-weight:700;letter-spacing:-0.02em;`,
};
