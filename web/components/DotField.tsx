import { useEffect, useRef } from "react";

const SPACING = 30;
const REACH = 190;
const PUSH = 7;

// A quiet dot grid. Dots near the pointer brighten and lean away from it; a slow wave keeps the rest alive.
export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let raf = 0;
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce.matches) draw(0);
    };

    const draw = (time: number): void => {
      ctx.clearRect(0, 0, width, height);
      const t = time / 1000;
      for (let gy = SPACING / 2; gy < height; gy += SPACING) {
        for (let gx = SPACING / 2; gx < width; gx += SPACING) {
          const dx = gx - pointer.x;
          const dy = gy - pointer.y;
          const dist = Math.hypot(dx, dy);
          const near = dist < REACH ? 1 - dist / REACH : 0;
          const wave = 0.5 + 0.5 * Math.sin((gx + gy) * 0.006 - t * 0.5);
          const lift = near * near;
          const push = dist > 0 ? lift * PUSH : 0;
          const x = gx + (dx / (dist || 1)) * push;
          const y = gy + (dy / (dist || 1)) * push;
          const size = 1.4 + lift * 1.6;
          if (lift > 0.04) {
            ctx.fillStyle = `rgba(200,255,46,${(0.08 + lift * 0.55).toFixed(3)})`;
          } else {
            ctx.fillStyle = `rgba(255,255,255,${(0.045 + wave * 0.05).toFixed(3)})`;
          }
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
    };

    const frame = (time: number): void => {
      pointer.x += (pointer.tx - pointer.x) * 0.14;
      pointer.y += (pointer.ty - pointer.y) * 0.14;
      draw(time);
      raf = requestAnimationFrame(frame);
    };

    const start = (): void => {
      cancelAnimationFrame(raf);
      if (!reduce.matches && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent): void => {
      if (pointer.tx < -9000) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
      }
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
    };
    const onLeave = (): void => {
      pointer.tx = pointer.ty = -9999;
    };

    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", start);
    reduce.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", start);
      reduce.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={ref} className="dotfield" aria-hidden="true" />;
}
