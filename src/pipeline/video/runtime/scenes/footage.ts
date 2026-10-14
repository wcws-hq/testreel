import type { FootageScene } from "../../plan.ts";
import { abs, fill, h, T, tf } from "../dom.ts";
import { clamp, drift, ease, lerp, need, seg } from "../ease.ts";
import type { Scene, SceneCtx } from "../scene.ts";
import { C } from "../theme.ts";
import { FOOTAGE_LEAD, FOOTAGE_SIZE, footageFrameUrl } from "../times.ts";

const clock = (secs: number): string => `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;

// Where a picture of `size` px sits in a view of `view` px when its point `at` (0..1) should be centred; it never shows an empty edge.
const place = (at: number, size: number, view: number): number => (size <= view ? (view - size) / 2 : clamp(view / 2 - at * size, view - size, 0));

const MAX_ZOOM = 1.6; // largest size of a recorded pixel on screen, in output pixels (the recordings are 1920 px wide)

// The real screen recording in a lightly tilted browser frame. Frames are pre-decoded images swapped per rendered frame, so every
// worker shows exactly the same picture for the same time. The frame takes the shape of the app found in the recording (its crop),
// the camera fits that crop and follows where the pixels change. On the Short the frame uses the full width over a blurred copy.
export function buildFootage(c: SceneCtx, s: FootageScene): Scene {
  const { L, P, D, plan } = c;
  const iw = FOOTAGE_SIZE.w;
  const ih = FOOTAGE_SIZE.h;
  const cropW = s.crop.w * iw;
  const cropH = s.crop.h * ih;
  const barH = 56;
  const vh = L.short ? Math.round(clamp(960 / (cropW / cropH), 560, 1000)) : 720;
  const fw = L.short ? 960 : Math.round(vh * clamp(cropW / cropH, 1.25, 16 / 9));
  const fh = vh + barH;
  const labelH = s.label ? 44 : 0;
  const top = L.short ? L.box.y + (L.box.h - fh - labelH - 22) / 2 : 92;
  const left = (L.W - fw) / 2;

  const first = need(c.images[footageFrameUrl(s.dir, 0)], `first frame of ${s.dir}`);
  // Each element is its own clone: the shared preloaded <img> must stay out of the scene.
  const picture = (css: string, parent: HTMLElement): HTMLImageElement => {
    const img = first.cloneNode(false) as HTMLImageElement;
    if (!img.complete || img.naturalWidth === 0) throw new Error(`recording frame ${img.src} is not decoded, refusing to render a blank frame`);
    img.style.cssText = css;
    parent.appendChild(img);
    return img;
  };

  const root = h("div", fill);
  const stage3d = h("div", `${fill}perspective:2400px;perspective-origin:50% 42%`, root);
  const glow = h("div", `${abs}left:${L.W / 2 - 800}px;top:${top + fh / 2 - 800}px;width:1600px;height:1600px;border-radius:50%;background:radial-gradient(circle,${P.glow(0.3)} 0%,${P.glow(0)} 58%)`, stage3d);
  const cam = h("div", fill, stage3d);
  const frame = h("div", `${abs}left:${left}px;top:${top}px;width:${fw}px;height:${fh}px;border-radius:22px;overflow:hidden;background:#0b0b0e;border:1px solid rgba(255,255,255,0.14);box-shadow:0 70px 140px rgba(0,0,0,0.9),0 0 0 1px rgba(0,0,0,0.6),0 0 90px ${P.glow(0.22)};opacity:0`, cam);

  const bar = h("div", `${abs}left:0;top:0;width:${fw}px;height:${barH}px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#101015;border-bottom:1px solid ${C.line};z-index:3`, frame);
  for (const col of ["#ff5f57", "#febc2e", "#28c840"]) h("i", `width:14px;height:14px;border-radius:50%;background:${col};opacity:0.85`, bar);
  const addr = h("div", `flex:1;margin:0 18px 0 22px;height:34px;border-radius:10px;background:rgba(255,255,255,0.06);display:flex;align-items:center;padding:0 16px;overflow:hidden;min-width:0`, bar);
  h("div", `${T.mono}font-size:19px;color:${C.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, addr, s.address);
  const live = h("div", `${T.mono}display:flex;align-items:center;gap:9px;flex:none;height:34px;padding:0 14px;border-radius:999px;border:1.5px solid ${P.glow(0.55)};background:${P.glow(0.14)};font-size:17px;font-weight:700;letter-spacing:0.14em`, bar);
  const dot = h("i", `width:10px;height:10px;border-radius:50%;background:${P.a};box-shadow:0 0 12px ${P.a}`, live);
  const liveText = h("span", "", live, "LIVE");
  const timer = h("div", `${T.mono}flex:none;font-size:19px;color:${C.dim};min-width:${L.short ? 118 : 150}px;text-align:right;font-variant-numeric:tabular-nums`, bar);
  const track = h("div", `${abs}left:0;top:${barH - 3}px;width:${fw}px;height:3px;background:rgba(255,255,255,0.1)`, bar);
  const progress = h("div", `width:100%;height:100%;background:${P.a};transform-origin:0 50%;transform:scaleX(0)`, track);

  const view = h("div", `${abs}left:0;top:${barH}px;width:${fw}px;height:${vh}px;overflow:hidden;background:#000`, frame);
  const fillScale = Math.max(fw / iw, vh / ih);
  const backdrop = L.short
    ? picture(`${abs}width:${iw}px;height:${ih}px;max-width:none;transform-origin:0 0;transform:translate3d(${((fw - iw * fillScale) / 2).toFixed(1)}px,${((vh - ih * fillScale) / 2).toFixed(1)}px,0) scale(${(fillScale * 1.12).toFixed(4)});filter:blur(34px) brightness(0.22) saturate(1.3)`, view)
    : null;
  const pic = h("div", `${abs}width:${iw}px;height:${ih}px;transform-origin:0 0;box-shadow:0 30px 80px rgba(0,0,0,0.55)`, view);
  const img = picture(`display:block;width:${iw}px;height:${ih}px;max-width:none`, pic);
  const shine = h("div", `${abs}left:0;top:0;width:${fw}px;height:${vh}px;background:linear-gradient(105deg,rgba(255,255,255,0) 40%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0) 60%);z-index:2`, view);

  const label = s.label
    ? h("div", `${T.mono}${abs}left:${left}px;top:${top + fh + 16}px;width:${fw}px;height:${labelH}px;display:flex;justify-content:center;opacity:0`, root)
    : null;
  if (label && s.label) h("div", `display:flex;align-items:center;max-width:${fw - 40}px;height:${labelH}px;padding:0 22px;border-radius:999px;border:1.5px solid ${C.line};background:rgba(255,255,255,0.05);font-size:24px;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, label, s.label);

  // Most of the way from showing the whole app (contain) to filling the frame with it (cover): big and legible, the camera follows the action.
  const contain = Math.min(fw / cropW, vh / cropH);
  const base = contain + (Math.max(fw / cropW, vh / cropH) - contain) * 0.6;
  const maxScale = (MAX_ZOOM * 1920) / iw;
  const lastFrame = s.frames - 1;
  const recordedFrames = Math.floor(s.secs * plan.fps);
  const keys = s.focus;
  const camera = (rt: number) => {
    const at = clamp(rt, 0, need(keys.at(-1)).t);
    let lo = 0;
    let hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (need(keys[mid]).t <= at) lo = mid;
      else hi = mid - 1;
    }
    const a = need(keys[lo]);
    const b = keys[lo + 1] ?? a;
    const k = b.t > a.t ? (at - a.t) / (b.t - a.t) : 0;
    return { u: lerp(a.u, b.u, k), v: lerp(a.v, b.v, k), z: lerp(a.z, b.z, k) };
  };

  let shown = -1;
  let loading: Promise<unknown> = Promise.resolve();
  return {
    root,
    settle: () => loading,
    update(t) {
      const rt = Math.max(0, t - FOOTAGE_LEAD);
      const index = Math.min(lastFrame, Math.floor(rt * plan.fps));
      if (index !== shown) {
        shown = index;
        const url = footageFrameUrl(s.dir, index);
        loading = Promise.all([img, ...(backdrop ? [backdrop] : [])].map((el) => {
          el.src = url;
          return el.decode();
        }));
      }

      const enter = ease.outQuart(seg(t, 0, 1.3));
      const ry = lerp(L.short ? -12 : -16, L.short ? -3 : -4, enter) + drift(t, 0.55, 3) * 0.8;
      const rx = lerp(6, 2, enter) + drift(t, 0.4, 8) * 0.5;
      const grow = lerp(0.9, 1, enter) * (1 + 0.04 * clamp(t / Math.max(D, 1)));
      frame.style.opacity = String(clamp(enter * 2.2));
      frame.style.transform = `translate3d(0,${((1 - enter) * 70).toFixed(2)}px,0) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) scale(${grow.toFixed(4)})`;
      tf(glow, -ry * 9, (1 - enter) * 40, 0.85 + 0.15 * enter);
      shine.style.transform = `translate3d(${((((t * 0.17) % 1.4) - 0.7) * fw * 1.6).toFixed(1)}px,0,0)`;
      if (label) {
        const e = ease.outCubic(seg(t, 0.9, 0.5));
        label.style.opacity = String(e);
        tf(label, 0, (1 - e) * 12);
      }

      const cm = camera(rt);
      const sc = Math.min(base * cm.z * (1 + 0.03 * ease.inOutSine(clamp(rt / Math.max(D - FOOTAGE_LEAD, 1)))), maxScale);
      // The camera looks at the action but never past the app: when the whole crop fits the view it just stays centred on it.
      const halfW = fw / (sc * iw) / 2;
      const halfH = vh / (sc * ih) / 2;
      const cu = halfW >= s.crop.w / 2 ? s.crop.x + s.crop.w / 2 : clamp(cm.u, s.crop.x + halfW, s.crop.x + s.crop.w - halfW);
      const cv = halfH >= s.crop.h / 2 ? s.crop.y + s.crop.h / 2 : clamp(cm.v, s.crop.y + halfH, s.crop.y + s.crop.h - halfH);
      pic.style.transform = `translate3d(${place(cu, iw * sc, fw).toFixed(2)}px,${place(cv, ih * sc, vh).toFixed(2)}px,0) scale(${sc.toFixed(4)})`;

      const ended = rt * plan.fps >= s.frames && s.frames >= recordedFrames;
      const played = Math.min(rt, s.secs);
      dot.style.opacity = ended ? "0.25" : "1";
      dot.style.boxShadow = ended ? "none" : `0 0 12px ${P.a}`;
      live.style.opacity = ended ? "0.55" : "1";
      liveText.textContent = ended ? "ENDED" : "LIVE";
      timer.textContent = `${clock(played)} / ${clock(s.secs)}`;
      progress.style.transform = `scaleX(${clamp(played / s.secs).toFixed(4)})`;
    },
  };
}
