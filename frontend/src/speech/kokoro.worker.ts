// Runs the Kokoro TTS model off the main thread so generation never blocks the UI.
//
// In:  { type: "load" }
//      { type: "generate", id, gen, text, voice, speed }
//      { type: "cancel", gen }   — drop every queued job with job.gen <= gen
// Out: { type: "progress", progress }        0–100, overall download progress
//      { type: "ready", device }
//      { type: "load-error", message }
//      { type: "audio", id, gen, audio, sampleRate }
//      { type: "generate-error", id, gen, message }

import { KokoroTTS, type GenerateOptions } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = "q4";

type Device = "webgpu" | "wasm";
type VoiceId = NonNullable<GenerateOptions["voice"]>;

interface Job {
  id: number;
  gen: number;
  text: string;
  voice: VoiceId;
  speed: number;
}

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;
let cancelledThrough = 0;
const queue: Job[] = [];
let working = false;

async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

// Sum bytes across every model file so the bar moves smoothly to 100%.
const fileBytes = new Map<string, { loaded: number; total: number }>();
let lastReported = -1;
function onProgress(info: { status: string; file?: string; loaded?: number; total?: number }) {
  if (info.status !== "progress" || !info.file || !info.total) return;
  fileBytes.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
  let loaded = 0;
  let total = 0;
  for (const f of fileBytes.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  const pct = Math.floor((loaded / total) * 100);
  if (pct !== lastReported) {
    lastReported = pct;
    ctx.postMessage({ type: "progress", progress: pct });
  }
}

/** Load on one device and prove it produces real audio before trusting it. */
async function tryLoad(device: Device): Promise<KokoroTTS> {
  const model = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: DTYPE,
    device,
    progress_callback: onProgress as never,
  });
  const probe = await model.generate("Hi.", { voice: "af_heart" });
  const samples = probe.audio;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (!Number.isFinite(v)) throw new Error(`${device} produced invalid audio`);
    if (v > peak) peak = v;
  }
  if (peak < 1e-4) throw new Error(`${device} produced silent audio`);
  return model;
}

async function load() {
  const devices: Device[] = (await webgpuAvailable()) ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: unknown;
  for (const device of devices) {
    try {
      tts = await tryLoad(device);
      ctx.postMessage({ type: "ready", device });
      void drain();
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function drain() {
  if (working || !tts) return;
  working = true;
  while (queue.length) {
    const job = queue.shift()!;
    if (job.gen <= cancelledThrough) continue;
    try {
      const out = await tts.generate(job.text, { voice: job.voice, speed: job.speed });
      if (job.gen <= cancelledThrough) continue;
      const audio = out.audio;
      ctx.postMessage(
        { type: "audio", id: job.id, gen: job.gen, audio, sampleRate: out.sampling_rate },
        [audio.buffer]
      );
    } catch (e) {
      ctx.postMessage({
        type: "generate-error",
        id: job.id,
        gen: job.gen,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  working = false;
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "load") {
    loading ??= load().catch((err) => {
      loading = null;
      ctx.postMessage({
        type: "load-error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } else if (msg.type === "generate") {
    queue.push(msg as Job);
    void drain();
  } else if (msg.type === "cancel") {
    cancelledThrough = Math.max(cancelledThrough, msg.gen);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].gen <= cancelledThrough) queue.splice(i, 1);
    }
  }
};
