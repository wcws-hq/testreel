import type { PlanLayer, VideoPlan } from "../plan.ts";
import type { Layout } from "./layout.ts";
import type { Palette } from "./theme.ts";

export interface SceneCtx {
  plan: VideoPlan;
  L: Layout;
  P: Palette;
  layer: PlanLayer;
  D: number; // layer length in seconds (start to the start of the next layer)
  images: Record<string, HTMLImageElement>;
}

export interface Scene {
  root: HTMLElement;
  // t: seconds since the layer started (preroll included); frame: absolute frame index, the only seed for jitter.
  update(t: number, frame: number): void;
  // Scenes that swap pictures per frame resolve this once the picture for the last update is decoded.
  settle?(): Promise<unknown>;
}
