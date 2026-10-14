// Scene transitions. Each one is a pure function of progress p (0..1) that styles the outgoing and incoming layer roots.
import type { TransitionType } from "../plan.ts";
import { abs, h, svg } from "./dom.ts";
import { clamp, ease, lerp, rng } from "./ease.ts";
import type { Layout } from "./layout.ts";
import type { Palette } from "./theme.ts";

interface Fx {
  edge: HTMLElement;
  ring: HTMLElement;
  flash: HTMLElement;
  bands: HTMLElement[];
  blur: SVGFEGaussianBlurElement;
  turbulence: SVGFETurbulenceElement;
  displace: SVGFEDisplacementMapElement;
  offsetR: SVGFEOffsetElement;
  offsetB: SVGFEOffsetElement;
}

const CHANNEL = (r: number, g: number, b: number) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;

export function buildFx(stage: HTMLElement, L: Layout, P: Palette): Fx {
  const defs = svg("svg", { width: 0, height: 0, style: "position:absolute" }, stage);
  const mb = svg("filter", { id: "mb", x: "-10%", y: "-10%", width: "120%", height: "120%" }, defs);
  const blur = svg("feGaussianBlur", { stdDeviation: "0 0" }, mb);
  const gl = svg("filter", { id: "gl", x: "0", y: "0", width: "100%", height: "100%", "color-interpolation-filters": "sRGB" }, defs);
  const turbulence = svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.0006 0.035", numOctaves: 1, seed: 1, result: "n0" }, gl);
  svg("feColorMatrix", { in: "n0", type: "matrix", values: "1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1", result: "n" }, gl);
  const displace = svg("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 0, xChannelSelector: "R", yChannelSelector: "G", result: "d" }, gl);
  svg("feColorMatrix", { in: "d", type: "matrix", values: CHANNEL(1, 0, 0), result: "r" }, gl);
  svg("feColorMatrix", { in: "d", type: "matrix", values: CHANNEL(0, 1, 0), result: "g" }, gl);
  svg("feColorMatrix", { in: "d", type: "matrix", values: CHANNEL(0, 0, 1), result: "b" }, gl);
  const offsetR = svg("feOffset", { in: "r", dx: 0, dy: 0, result: "ro" }, gl);
  const offsetB = svg("feOffset", { in: "b", dx: 0, dy: 0, result: "bo" }, gl);
  svg("feBlend", { in: "ro", in2: "g", mode: "screen", result: "rg" }, gl);
  svg("feBlend", { in: "rg", in2: "bo", mode: "screen" }, gl);

  const root = h("div", `${abs}width:${L.W}px;height:${L.H}px;pointer-events:none;overflow:hidden`, stage);
  const edge = h("div", `${abs}background:#fff;box-shadow:0 0 36px 10px ${P.glow(0.85)},0 0 0 2px ${P.a};opacity:0`, root);
  const ring = h("div", `${abs}border-radius:50%;border:5px solid ${P.a};box-shadow:0 0 50px ${P.glow(0.8)},inset 0 0 50px ${P.glow(0.5)};opacity:0`, root);
  const flash = h("div", `${abs}width:${L.W}px;height:${L.H}px;background:#fff;opacity:0`, root);
  const bands = [0, 1, 2, 3].map(() => h("div", `${abs}width:${L.W}px;opacity:0`, root));
  return { edge, ring, flash, bands, blur, turbulence, displace, offsetR, offsetB };
}

export function resetRoot(e: HTMLElement): void {
  e.style.display = "block";
  e.style.transform = "";
  e.style.opacity = "";
  e.style.filter = "";
  e.style.clipPath = "";
  e.style.zIndex = "";
}

export function resetFx(fx: Fx): void {
  fx.edge.style.opacity = "0";
  fx.ring.style.opacity = "0";
  fx.flash.style.opacity = "0";
  for (const b of fx.bands) b.style.opacity = "0";
}

const place = (e: HTMLElement, left: number, top: number, w: number, hgt: number, rotate: number, opacity: number) => {
  e.style.left = `${left.toFixed(1)}px`;
  e.style.top = `${top.toFixed(1)}px`;
  e.style.width = `${w.toFixed(1)}px`;
  e.style.height = `${hgt.toFixed(1)}px`;
  e.style.transform = `rotate(${rotate.toFixed(3)}deg)`;
  e.style.opacity = String(opacity);
};

const move = (e: HTMLElement, x: number, y: number, s = 1) => {
  e.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${s.toFixed(4)})`;
};

export function applyTransition(type: TransitionType, out: HTMLElement, inn: HTMLElement, p: number, fx: Fx, L: Layout, P: Palette, frame: number): void {
  const { W, H } = L;
  inn.style.zIndex = "2";
  out.style.zIndex = "1";
  switch (type) {
    case "whip": {
      const e = ease.inOutCubic(p);
      const std = 54 * Math.sin(Math.PI * e);
      fx.blur.setAttribute("stdDeviation", L.short ? `0 ${std.toFixed(1)}` : `${std.toFixed(1)} 0`);
      out.style.filter = "url(#mb)";
      inn.style.filter = "url(#mb)";
      if (L.short) {
        move(out, 0, -e * H, 1 + 0.03 * Math.sin(Math.PI * e));
        move(inn, 0, (1 - e) * H, 1 + 0.03 * Math.sin(Math.PI * e));
      } else {
        move(out, -e * W, 0, 1 + 0.03 * Math.sin(Math.PI * e));
        move(inn, (1 - e) * W, 0, 1 + 0.03 * Math.sin(Math.PI * e));
      }
      break;
    }
    case "zoom": {
      const e = ease.inOutCubic(p);
      move(out, 0, 0, 1 + e * 1.5);
      out.style.opacity = String(1 - clamp((p - 0.2) / 0.5));
      out.style.filter = `blur(${(e * 14).toFixed(1)}px)`;
      move(inn, 0, 0, 0.62 + 0.38 * e);
      inn.style.opacity = String(clamp((p - 0.25) / 0.5));
      inn.style.filter = `blur(${((1 - e) * 10).toFixed(1)}px)`;
      fx.flash.style.opacity = String(0.2 * Math.sin(Math.PI * p));
      break;
    }
    case "wipe": {
      const e = ease.inOutCubic(p);
      if (L.short) {
        const sk = W * 0.12;
        const y = lerp(-sk, H + sk, e);
        inn.style.clipPath = `polygon(0px 0px,${W}px 0px,${W}px ${(y - sk).toFixed(1)}px,0px ${(y + sk).toFixed(1)}px)`;
        const ang = (-Math.atan2(2 * sk, W) * 180) / Math.PI;
        place(fx.edge, W / 2 - W * 0.65, y - 3, W * 1.3, 6, ang, Math.sin(Math.PI * e));
      } else {
        const sk = H * 0.18;
        const x = lerp(-sk, W + sk, e);
        inn.style.clipPath = `polygon(0px 0px,${(x + sk).toFixed(1)}px 0px,${(x - sk).toFixed(1)}px ${H}px,0px ${H}px)`;
        const ang = (Math.atan2(2 * sk, H) * 180) / Math.PI;
        place(fx.edge, x - 3, H / 2 - H * 0.65, 6, H * 1.3, ang, Math.sin(Math.PI * e));
      }
      move(out, -e * W * 0.06, 0, 1 + 0.03 * e);
      out.style.opacity = String(1 - 0.5 * e);
      break;
    }
    case "push": {
      const e = ease.inOutCubic(p);
      if (L.short) {
        move(out, 0, -e * H * 0.3);
        move(inn, 0, (1 - e) * H);
      } else {
        move(out, -e * W * 0.3, 0);
        move(inn, (1 - e) * W, 0);
      }
      out.style.opacity = String(1 - 0.75 * e);
      inn.style.filter = `drop-shadow(${L.short ? "0 -40px 60px" : "-40px 0 60px"} rgba(0,0,0,0.9))`;
      break;
    }
    case "iris": {
      const e = ease.inOutCubic(p);
      const cx = W / 2;
      const cy = L.short ? H * 0.46 : H / 2;
      const r = e * Math.hypot(W, H) * 0.56;
      inn.style.clipPath = `circle(${r.toFixed(1)}px at ${cx}px ${cy}px)`;
      place(fx.ring, cx - r, cy - r, 2 * r, 2 * r, 0, Math.sin(Math.PI * e) ** 0.6);
      move(out, 0, 0, 1 + 0.08 * e);
      out.style.opacity = String(1 - 0.4 * e);
      break;
    }
    case "glitch": {
      const r = rng(frame * 7919 + 13);
      const mid = p > 0.34 && p < 0.66 ? r() > 0.5 : p >= 0.5;
      const shown = mid ? inn : out;
      const hidden = mid ? out : inn;
      hidden.style.display = "none";
      const k = Math.sin(Math.PI * p);
      fx.turbulence.setAttribute("seed", String(frame % 97));
      fx.displace.setAttribute("scale", String(Math.round(220 * k * k)));
      fx.offsetR.setAttribute("dx", String(Math.round(10 * k)));
      fx.offsetB.setAttribute("dx", String(Math.round(-10 * k)));
      shown.style.filter = "url(#gl)";
      move(shown, (r() - 0.5) * 36 * k, 0, 1 + 0.02 * k);
      fx.bands.forEach((b, i) => {
        const bh = 8 + Math.floor(r() * 46);
        b.style.height = `${bh}px`;
        b.style.top = `${Math.floor(r() * (H - bh))}px`;
        b.style.background = i % 2 ? "#fff" : P.a;
        b.style.opacity = String(r() < k ? 0.22 + 0.2 * r() : 0);
      });
      break;
    }
    case "blur": {
      const e = ease.inOutSine(p);
      move(out, 0, 0, 1 + 0.05 * e);
      out.style.opacity = String(1 - e);
      out.style.filter = `blur(${(e * 12).toFixed(1)}px)`;
      move(inn, 0, 0, 1.06 - 0.06 * e);
      inn.style.opacity = String(e);
      inn.style.filter = `blur(${((1 - e) * 12).toFixed(1)}px)`;
      break;
    }
  }
}
