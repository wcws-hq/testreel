// Sound design: a handful of sounds synthesized with ffmpeg's lavfi sources, placed on a timeline next to the voice.
// Everything sits about 24 dB under full scale so it never competes with the narration.
import { FFMPEG, spawnCollect } from "./proc.ts";
import { layoutFor, terminalMetrics } from "./runtime/layout.ts";
import { GAUGE_FILL_SECONDS, STATS_COUNT_SECONDS, STATS_COUNT_START, VERDICT_HIT, gaugeTimes, planTerminal, pointTimes, timeAt } from "./runtime/times.ts";
import type { VideoPlan } from "./plan.ts";

export const SAMPLE_RATE = 44100;
const NOISE = "(random(0)*2-1)";

type SoundName = "whoosh" | "tick" | "type" | "impact" | "pop";
// name: [seconds, aevalsrc expression, extra filters]
const SOUNDS: Record<SoundName, [number, string, string]> = {
  whoosh: [0.75, `${NOISE}*sin(PI*t/0.75)^2*0.9+sin(2*PI*(220+1500*(t/0.75)^2)*t)*sin(PI*t/0.75)^2*0.1`, "highpass=f=350,lowpass=f=6500"],
  tick: [0.05, `${NOISE}*exp(-110*t)`, "highpass=f=2200"],
  type: [0.04, `${NOISE}*exp(-170*t)`, "highpass=f=1500,lowpass=f=7000"],
  impact: [1.1, `sin(2*PI*58*t)*exp(-4*t)*0.9+${NOISE}*exp(-34*t)*0.4`, "lowpass=f=2200"],
  pop: [0.22, "sin(2*PI*(900-2600*t)*t)*exp(-20*t)", ""],
};

export interface SoundEvent { at: number; sound: SoundName; gain: number }

export function soundEvents(plan: VideoPlan): SoundEvent[] {
  const L = layoutFor(plan.kind);
  const tm = terminalMetrics(L);
  const out: SoundEvent[] = [];
  // Ticks that slow down with the count-up easing (outExpo) they accompany.
  const countTicks = (start: number, seconds: number, gain: number) => {
    for (let k = 1; k <= 8; k++) {
      const q = -Math.log2(1 - k / 9) / 10;
      if (q <= 1) out.push({ at: start + q * seconds, sound: "tick", gain });
    }
  };
  for (const layer of plan.layers) {
    if (layer.trans) out.push({ at: layer.start - 0.03, sound: "whoosh", gain: layer.trans.type === "glitch" ? 0.7 : 1 });
    if (layer.kind === "intro") {
      out.push({ at: 0.12, sound: "impact", gain: 0.55 });
      countTicks(timeAt(layer, 1.2), 1.3, 0.4);
    }
    if (layer.callout) out.push({ at: layer.callout.start + 0.05, sound: "pop", gain: 0.6 });
    const scene = layer.scene;
    if (!scene) continue;
    if (scene.kind === "stats") scene.items.slice(0, 4).forEach((_, i) => countTicks(timeAt(layer, STATS_COUNT_START(i)), STATS_COUNT_SECONDS, 0.5));
    if (scene.kind === "scorecard") {
      gaugeTimes(layer).forEach((t) => {
        out.push({ at: timeAt(layer, t), sound: "pop", gain: 0.45 });
        countTicks(timeAt(layer, t + 0.2), GAUGE_FILL_SECONDS, 0.45);
      });
    }
    if (scene.kind === "points") pointTimes(scene.items.slice(0, 5), layer).forEach((t) => out.push({ at: timeAt(layer, t), sound: "pop", gain: 0.5 }));
    if (scene.kind === "verdict") out.push({ at: timeAt(layer, VERDICT_HIT), sound: "impact", gain: 1 });
    if (scene.kind === "cta") out.push({ at: timeAt(layer, 2.02), sound: "pop", gain: 0.7 });
    if (scene.kind === "terminal") {
      const term = planTerminal(scene.steps, layer, tm.cols, tm.maxOut);
      for (const row of term.rows) {
        if (row.kind !== "cmd") continue;
        const chars = Math.floor(row.text.length / 2);
        for (let k = 0; k < chars; k++) out.push({ at: timeAt(layer, row.at) + (row.typeSeconds * k) / chars, sound: "type", gain: 0.3 + 0.12 * ((k * 7) % 3) });
      }
    }
  }
  const outro = plan.layers.find((l) => l.kind === "outro");
  if (outro) out.push({ at: timeAt(outro, 2.7), sound: "pop", gain: 0.7 });
  return out;
}

const toFloat32 = (raw: Uint8Array): Float32Array => new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength - (raw.byteLength % 4)));

async function synth(name: SoundName, signal: AbortSignal): Promise<Float32Array> {
  const [seconds, expr, filters] = SOUNDS[name];
  const fade = `afade=t=out:st=${(seconds * 0.8).toFixed(3)}:d=${(seconds * 0.2).toFixed(3)}`;
  const chain = [filters, fade].filter(Boolean).join(",");
  const raw = await spawnCollect(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=${SAMPLE_RATE}:d=${seconds}`, "-af", chain, "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"], signal);
  const samples = toFloat32(raw);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak > 0 ? samples.map((v) => v / peak) : samples;
}

export async function decodeMono(file: string, signal: AbortSignal): Promise<Float32Array> {
  const raw = await spawnCollect(FFMPEG, ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"], signal);
  return toFloat32(raw);
}

const SFX_LEVEL = 10 ** (-24 / 20);

// Voice (delayed by the intro) plus sound design, as a mono 16-bit wav of exactly `plan.total` seconds.
export async function mixAudio(plan: VideoPlan, voiceFile: string, voiceOffset: number, outFile: string, signal: AbortSignal): Promise<void> {
  const length = Math.round(plan.total * SAMPLE_RATE);
  const mix = new Float32Array(length);
  const voice = await decodeMono(voiceFile, signal);
  const offset = Math.round(voiceOffset * SAMPLE_RATE);
  for (let i = 0; i < voice.length && offset + i < length; i++) mix[offset + i] = voice[i] ?? 0;

  const events = soundEvents(plan);
  const bank = new Map<SoundName, Float32Array>();
  for (const name of new Set(events.map((e) => e.sound))) bank.set(name, await synth(name, signal));
  for (const e of events) {
    const s = bank.get(e.sound);
    if (!s) continue;
    const start = Math.round(Math.max(e.at, 0) * SAMPLE_RATE);
    for (let i = 0; i < s.length && start + i < length; i++) mix[start + i] = (mix[start + i] ?? 0) + (s[i] ?? 0) * e.gain * SFX_LEVEL;
  }

  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, mix[i] ?? 0)) * 32767);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  await Bun.write(outFile, Buffer.concat([header, Buffer.from(pcm.buffer)]));
}
