import { abs, h, svg, T, tf } from "../dom.ts";
import { clamp, ease, seg } from "../ease.ts";
import { icon } from "../kit.ts";
import { C, type Palette } from "../theme.ts";

// An animated Subscribe button: it pops in, gets pressed, turns into Subscribed and the bell rings.
export function subscribeButton(parent: HTMLElement, P: Palette, size: number): { root: HTMLElement; update(t: number, pressAt: number): void } {
  const root = h("div", `position:relative;display:flex;align-items:center;justify-content:center;width:${size * 7.2}px;height:${size * 2.4}px`, parent);
  const halo = h("div", `${abs}left:50%;top:50%;width:${size * 5}px;height:${size * 1.7}px;margin:${-size * 0.85}px 0 0 ${-size * 2.5}px;border-radius:999px;border:2px solid ${P.glow(0.7)};opacity:0`, root);
  const ripple = h("div", `${abs}left:50%;top:50%;width:${size * 5}px;height:${size * 1.7}px;margin:${-size * 0.85}px 0 0 ${-size * 2.5}px;border-radius:999px;border:3px solid ${P.a};opacity:0`, root);
  const btn = h("div", `position:relative;display:flex;align-items:center;gap:${size * 0.4}px;height:${size * 1.7}px;padding:0 ${size * 0.9}px;border-radius:999px;border:3px solid ${P.a};box-shadow:0 0 ${size}px ${P.glow(0.45)}`, root);
  const bell = h("div", `transform-origin:50% 12%`, btn);
  icon(bell, "bell", size * 0.9, "#000");
  const text = h("div", `${T.display}font-size:${size}px;font-weight:800;letter-spacing:-0.02em;white-space:nowrap`, btn, "Subscribe");
  const tick = svg("svg", { width: size * 0.8, height: size * 0.8, viewBox: "0 0 24 24", style: "display:none" }, btn);
  svg("path", { d: "M5 12.5l4.5 4.5L19 7.5", fill: "none", stroke: "currentColor", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }, tick);
  return {
    root,
    update(t, pressAt) {
      const enter = ease.outBack(seg(t, 0.3, 0.6));
      const press = seg(t, pressAt, 0.18);
      const release = ease.outBack(seg(t, pressAt + 0.18, 0.4));
      const dip = press < 1 ? press : 1 - release;
      const done = t >= pressAt + 0.12;
      root.style.opacity = String(clamp(enter * 2));
      tf(btn, 0, (1 - enter) * 30, (0.8 + 0.2 * enter) * (1 - 0.07 * dip));
      btn.style.background = done ? C.card2 : P.a;
      btn.style.color = done ? C.text : "#000";
      text.textContent = done ? "Subscribed" : "Subscribe";
      tick.style.display = done ? "block" : "none";
      tick.style.color = P.soft;
      bell.style.display = done ? "none" : "block";
      const rp = seg(t, pressAt, 0.9);
      ripple.style.opacity = String(rp > 0 && rp < 1 ? 0.8 * (1 - rp) : 0);
      tf(ripple, 0, 0, 1 + ease.outCubic(rp) * 0.35);
      const hp = (t * 0.7) % 1;
      halo.style.opacity = String((1 - hp) * 0.5 * clamp(enter));
      tf(halo, 0, 0, 1 + hp * 0.22);
      bell.style.transform = `rotate(${(Math.sin(t * 9) * 14 * Math.max(0, 1 - seg(t, 0.9, 0.8))).toFixed(2)}deg)`;
    },
  };
}
