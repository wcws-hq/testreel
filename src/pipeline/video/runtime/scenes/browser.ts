import type { ResolvedScene } from "../../plan.ts";
import { abs, fill, fitFont, h, maskedWords, T, tf } from "../dom.ts";
import { clamp, drift, ease, lerp, need, seg } from "../ease.ts";
import { icon, revealWords } from "../kit.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C } from "../theme.ts";

type BrowserScene = Extract<ResolvedScene, { kind: "browser" }>;
interface Key { u: number; v: number; z: number }

// A page capture in a tilted 3D browser frame with a camera that pushes in, drifts and re-frames over the whole scene.
export function buildBrowser(c: SceneCtx, s: BrowserScene): Scene {
  const { L, P, D } = c;
  // Each scene gets its own element: several sections can show the same screenshot, and appendChild would move one shared element.
  const img = need(c.images[s.src], `image ${s.src}`).cloneNode(false) as HTMLImageElement; // clone of an <img>, always an HTMLImageElement
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) throw new Error(`screenshot ${s.src} is not decoded, refusing to render a blank browser window`);
  const root = h("div", fill);
  const fw = L.short ? 920 : 1220;
  const vh = L.short ? 900 : 660;
  const barH = 56;
  const fh = vh + barH;
  const capH = s.caption ? (L.short ? 96 : 84) : 0;
  const top = L.box.y + (L.box.h - fh - capH) / 2;
  const left = (L.W - fw) / 2;

  const stage3d = h("div", `${fill}perspective:2400px;perspective-origin:50% 42%`, root);
  const glow = h("div", `${abs}left:${L.W / 2 - 800}px;top:${top + fh / 2 - 800}px;width:1600px;height:1600px;border-radius:50%;background:radial-gradient(circle,${P.glow(0.3)} 0%,${P.glow(0)} 58%)`, stage3d);
  const cam = h("div", `${fill}`, stage3d);
  const frame = h("div", `${abs}left:${left}px;top:${top}px;width:${fw}px;height:${fh}px;border-radius:22px;overflow:hidden;background:#0b0b0e;border:1px solid rgba(255,255,255,0.14);box-shadow:0 70px 140px rgba(0,0,0,0.9),0 0 0 1px rgba(0,0,0,0.6),0 0 90px ${P.glow(0.22)};opacity:0`, cam);
  const bar = h("div", `${abs}left:0;top:0;width:${fw}px;height:${barH}px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#101015;border-bottom:1px solid ${C.line};z-index:3`, frame);
  for (const col of ["#ff5f57", "#febc2e", "#28c840"]) h("i", `width:14px;height:14px;border-radius:50%;background:${col};opacity:0.85`, bar);
  const addr = h("div", `flex:1;margin:0 40px 0 30px;height:34px;border-radius:10px;background:rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;padding:0 16px;overflow:hidden`, bar);
  icon(addr, "lock", 16, C.faint);
  h("div", `${T.mono}font-size:19px;color:${C.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, addr, s.address.replace(/^https?:\/\//, ""));
  const view = h("div", `${abs}left:0;top:${barH}px;width:${fw}px;height:${vh}px;overflow:hidden;background:#000`, frame);
  const pic = h("div", `${abs}left:0;top:0;transform-origin:0 0`, view);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  img.style.cssText = `display:block;width:${iw}px;height:${ih}px;max-width:none`;
  pic.appendChild(img);
  const shine = h("div", `${abs}left:0;top:0;width:${fw}px;height:${vh}px;background:linear-gradient(105deg,rgba(255,255,255,0) 38%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0) 62%);z-index:2`, view);

  const base = Math.max(fw / iw, vh / ih);
  const fy = s.focus === "top" ? 0.22 : s.focus === "middle" ? 0.5 : 0.78;
  const wf = vh / (ih * base);
  const tall = ih * base > vh * 2.2;
  const keys: Key[] = [
    { u: 0.5, v: fy, z: 1 },
    { u: 0.3, v: fy - 0.1, z: 1.55 },
    { u: 0.72, v: fy + 0.08, z: 1.5 },
    { u: 0.5, v: fy, z: 1.22 },
    { u: 0.36, v: fy + 0.14, z: 1.65 },
  ];
  const hold = 4.4;
  const move = 1.8;
  const camera = (t: number): Key => {
    if (tall) {
      const startV = s.focus === "top" ? wf / 2 : s.focus === "middle" ? 0.45 : 0.7;
      const endV = Math.min(1 - wf / 2, startV + 0.4);
      return { u: 0.5, v: lerp(startV, endV, ease.inOutSine(clamp(t / Math.max(D, 1)))), z: 1 + 0.08 * ease.inOutSine(clamp(t / Math.max(D, 1))) };
    }
    const t0 = Math.max(0, t - 1.0);
    const k = Math.floor(t0 / (hold + move));
    const e = ease.inOutCubic(seg(t0 - k * (hold + move), hold, move));
    const a = need(keys[k % keys.length]);
    const b = need(keys[(k + 1) % keys.length]);
    return { u: lerp(a.u, b.u, e) + 0.01 * Math.sin(t * 0.7), v: lerp(a.v, b.v, e) + 0.008 * Math.sin(t * 0.5), z: lerp(a.z, b.z, e) * (1 + 0.012 * Math.sin(t * 0.45)) };
  };

  let captionWords: HTMLElement[] = [];
  let cap: HTMLElement | null = null;
  if (s.caption) {
    cap = h("div", `${abs}left:${left}px;top:${top + fh + 34}px;width:${fw}px;text-align:center;opacity:1`, root);
    const size = fitFont(s.caption, `${T.display}font-weight:700;`, fw - 40, L.short ? 96 : 56, L.short ? 46 : 40, 24, true);
    captionWords = maskedWords(cap, s.caption, `${T.display}font-weight:700;font-size:${size}px;color:${C.text};letter-spacing:-0.015em`);
    cap.style.fontSize = `${size}px`;
    cap.style.lineHeight = "1.12";
    cap.style.textWrap = "balance";
  }

  return {
    root,
    update(t) {
      const enter = ease.outQuart(seg(t, 0, 1.3));
      const idle = drift(t, 0.55, 3);
      const ry = lerp(L.short ? -18 : -24, L.short ? -6 : -9, enter) + idle * 1.4;
      const rx = lerp(8, 3.5, enter) + drift(t, 0.4, 8) * 0.9;
      const rz = lerp(1.6, 0.5, enter);
      const grow = lerp(0.9, 1, enter) * (1 + 0.045 * clamp(t / Math.max(D, 1)));
      frame.style.opacity = String(clamp(enter * 2.2));
      frame.style.transform = `translate3d(0,${((1 - enter) * 70).toFixed(2)}px,0) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${grow.toFixed(4)})`;
      tf(glow, -ry * 9, (1 - enter) * 40, 0.85 + 0.15 * enter);

      const cam = camera(t);
      const sc = base * cam.z;
      const px = clamp(fw / 2 - cam.u * iw * sc, fw - iw * sc, 0);
      const py = clamp(vh / 2 - cam.v * ih * sc, vh - ih * sc, 0);
      pic.style.transform = `translate3d(${px.toFixed(2)}px,${py.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
      shine.style.transform = `translate3d(${((((t * 0.19) % 1.4) - 0.7) * fw * 1.6).toFixed(1)}px,0,0)`;

      if (cap) revealWords(captionWords, t, 0.9, 0.06, 0.6);
    },
  };
}
