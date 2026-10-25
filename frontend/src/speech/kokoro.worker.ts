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

import "./streamAsyncIterator"; // must stay first: Safari fix for the phonemizer
import { KokoroTTS, type GenerateOptions } from "kokoro-js";

// Send Hugging Face downloads through the app's same-origin /hf proxy (see
// vite.config.ts), falling back to a direct request if the proxy isn't there.
// The library still caches by the original URL, so existing caches stay valid.
const HF_ORIGIN = "https://huggingface.co/";
const nativeFetch = self.fetch.bind(self);
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(HF_ORIGIN)) {
    try {
      const proxied = await nativeFetch(`${self.location.origin}/hf/${url.slice(HF_ORIGIN.length)}`, init);
      if (proxied.ok) return proxied;
    } catch {
      /* fall through to a direct request */
    }
  }
  return nativeFetch(input, init);
};

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type Device = "webgpu" | "wasm";
// q4 = 4-bit weights (305 MB). q4f16 = same 4-bit weights with 16-bit math
// (155 MB, about half the download) — used on GPUs with 16-bit shader support.
type Dtype = "q4" | "q4f16";
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

type GpuAdapter = { features: { has(name: string): boolean } };

/** null = no WebGPU; otherwise whether 16-bit shaders are supported. */
async function webgpuSupport(): Promise<{ f16: boolean } | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    return adapter ? { f16: adapter.features.has("shader-f16") } : null;
  } catch {
    return null;
  }
}

/** True if this model build is already in the browser cache (loads in ~2s). */
async function isCached(dtype: Dtype): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");
    return Boolean(await cache.match(`https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_${dtype}.onnx`));
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
async function tryLoad(device: Device, dtype: Dtype): Promise<KokoroTTS> {
  const model = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
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

// Safari: the voice runtime's WebGPU support there is unreliable, while the
// WebAssembly path is verified (and multi-threaded thanks to the isolation
// headers), so Safari goes straight to WebAssembly.
const IS_SAFARI = /^((?!chrome|chromium|crios|edg|android).)*safari/i.test(navigator.userAgent);

async function load() {
  const gpu = IS_SAFARI ? null : await webgpuSupport();
  const plans: { device: Device; dtype: Dtype }[] = [];
  if (gpu) {
    // Prefer the smaller q4f16 download, unless the larger q4 build is
    // already cached (then it's the fastest option and nothing downloads).
    const useF16 = gpu.f16 && !(await isCached("q4"));
    plans.push({ device: "webgpu", dtype: useF16 ? "q4f16" : "q4" });
  }
  // WebAssembly runs 16-bit math slowly, so it always uses q4.
  plans.push({ device: "wasm", dtype: "q4" });

  let lastError: unknown;
  for (const { device, dtype } of plans) {
    try {
      tts = await tryLoad(device, dtype);
      ctx.postMessage({ type: "ready", device, dtype });
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
