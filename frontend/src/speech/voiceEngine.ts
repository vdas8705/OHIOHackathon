// Interviewer voice engine: Kokoro neural TTS in a Web Worker, played through
// the Web Audio API, with the browser's Web Speech voice as a silent fallback
// whenever Kokoro is still downloading, can't load, or can't run.

import { useSyncExternalStore } from "react";
import { synthesisService } from "./browserSpeech";
import { planKokoroSegments, type KokoroSegment } from "./prosody";
import type { KokoroVoiceId } from "./voiceSettings";

export type VoiceEngineStatus = "idle" | "loading" | "ready" | "fallback";

export interface VoiceEngineState {
  status: VoiceEngineStatus;
  progress: number; // 0–100 while loading
  /** Why the natural voice isn't being used (shown in voice settings). */
  reason?: string;
}

export interface SpeakOptions {
  voice: KokoroVoiceId;
  rate: number;
  onStart?: () => void;
  onEnd?: () => void;
}

// ---- tiny external store so React can render loading/fallback state ----
let state: VoiceEngineState = { status: "idle", progress: 0 };
const listeners = new Set<() => void>();
function setState(next: Partial<VoiceEngineState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useVoiceEngineState(): VoiceEngineState {
  return useSyncExternalStore(subscribe, () => state);
}

// ---- helpers ----
type AudioContextCtor = typeof AudioContext;
const AudioCtx: AudioContextCtor | undefined =
  typeof window === "undefined"
    ? undefined
    : window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;

function kokoroSupported(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly === "object" && Boolean(AudioCtx);
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** Trim the model's leading/trailing silence and fade the edges so sentences join without clicks. */
function trimAndFade(samples: Float32Array, sampleRate: number): Float32Array {
  const threshold = 0.004;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
  const pad = Math.floor(sampleRate * 0.03);
  const out = samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad));
  const fade = Math.min(Math.floor(sampleRate * 0.006), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

interface GenResult {
  audio?: Float32Array;
  sampleRate?: number;
}

interface PendingJob {
  gen: number;
  resolve: (r: GenResult) => void;
}

interface Run {
  gen: number;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
}

class VoiceEngine {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private audioCtx: AudioContext | null = null;
  // Bumped on every speak/cancel; anything tagged with an older value is stale.
  private gen = 0;
  private nextJobId = 1;
  private jobs = new Map<number, PendingJob>();
  private run: Run | null = null;
  private pendingEnd: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.installAudioUnlock();
  }

  /** Start loading Kokoro (once). Resolves true when ready, false if we fell back. */
  preload(): Promise<boolean> {
    if (this.ready) return this.ready;
    if (!kokoroSupported()) {
      setState({ status: "fallback", reason: "This browser can't run the natural voice (needs Web Workers, WebAssembly, and Web Audio)." });
      return (this.ready = Promise.resolve(false));
    }
    setState({ status: "loading", progress: 0 });
    this.ready = new Promise<boolean>((resolve) => {
      const fail = (reason = "The natural voice stopped unexpectedly.") => {
        console.warn("[voice] Natural voice unavailable, using the browser voice:", reason);
        this.worker?.terminate();
        this.worker = null;
        this.failPendingJobs();
        setState({ status: "fallback", reason });
        resolve(false);
      };
      let worker: Worker;
      try {
        worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
      } catch (e) {
        fail(`Couldn't start the voice worker: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      this.worker = worker;
      // Watchdog: loading always sends progress while downloading, then
      // "ready" a few seconds later. Long silence means something hung, so
      // use the browser voice rather than leaving the interview silent.
      const STALL_MS = 45_000;
      let stallTimer = setTimeout(() => fail("The natural voice stopped responding while loading."), STALL_MS);
      const stillAlive = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => fail("The natural voice stopped responding while loading."), STALL_MS);
      };
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") stillAlive();
        if (msg.type === "ready" || msg.type === "load-error") clearTimeout(stallTimer);
        if (msg.type === "progress") {
          setState({ progress: msg.progress });
        } else if (msg.type === "ready") {
          setState({ status: "ready", progress: 100 });
          resolve(true);
        } else if (msg.type === "load-error") {
          fail(/\b405\b|captcha/i.test(msg.message ?? "")
            ? "The voice download was blocked by Hugging Face's bot check. Try again later or on another network."
            : `The voice model couldn't load: ${msg.message ?? "unknown error"}`);
        } else if (msg.type === "audio" || msg.type === "generate-error") {
          const job = this.jobs.get(msg.id);
          if (!job) return;
          this.jobs.delete(msg.id);
          job.resolve(msg.type === "audio" ? { audio: msg.audio, sampleRate: msg.sampleRate } : {});
        }
      };
      worker.onerror = (e) => {
        e.preventDefault();
        fail(`The voice worker crashed${e.message ? `: ${e.message}` : "."}`);
      };
      worker.postMessage({ type: "load" });
    });
    return this.ready;
  }

  speak(text: string, opts: SpeakOptions) {
    this.halt(); // never let two messages overlap
    const gen = this.gen;
    this.pendingEnd = () => opts.onEnd?.();

    const segments = text.trim() ? planKokoroSegments(text) : [];
    if (!segments.length) return this.finish(gen);

    if (state.status === "ready") {
      void this.playKokoro(gen, segments, opts);
    } else if (state.status === "fallback") {
      this.speakFallback(gen, text, opts);
    } else {
      // Still loading: hold the message until Kokoro is ready so the first
      // prompt uses the real voice. Only a failed load uses the browser voice.
      void this.preload().then((ok) => {
        if (gen !== this.gen) return;
        if (ok) void this.playKokoro(gen, segments, opts);
        else this.speakFallback(gen, text, opts);
      });
    }
  }

  /** Short sample so people can compare voices in settings. */
  preview(voice: KokoroVoiceId, rate: number, name: string, onEnd?: () => void) {
    this.speak(`Hi, I'm ${name}. Let's work through this together.`, { voice, rate, onEnd });
  }

  cancel() {
    this.halt();
  }

  // ---- internals ----

  private speakFallback(gen: number, text: string, opts: SpeakOptions) {
    synthesisService.speak(text, {
      rate: opts.rate,
      onStart: () => gen === this.gen && opts.onStart?.(),
      onEnd: () => this.finish(gen),
    });
  }

  private generate(gen: number, text: string, voice: KokoroVoiceId, speed: number): Promise<GenResult> {
    if (!this.worker) return Promise.resolve({});
    const id = this.nextJobId++;
    return new Promise((resolve) => {
      this.jobs.set(id, { gen, resolve });
      this.worker!.postMessage({ type: "generate", id, gen, text, voice, speed });
    });
  }

  private async playKokoro(gen: number, segments: KokoroSegment[], opts: SpeakOptions) {
    const ctx = await this.getRunningAudioContext();
    if (gen !== this.gen) return;
    if (!ctx) {
      this.speakFallback(gen, segments.map((s) => s.text).join(" "), opts);
      return;
    }

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const run: Run = { gen, gain, sources: [] };
    this.run = run;

    // Queue every sentence now; the worker generates them in order, so the
    // first one plays while the rest are still being produced.
    const results = segments.map((seg) =>
      this.generate(gen, seg.text, opts.voice, Math.min(2, Math.max(0.5, opts.rate * seg.speed)))
    );

    let nextTime = 0;
    let started = false;
    for (let i = 0; i < segments.length; i++) {
      const r = await results[i];
      if (gen !== this.gen) return;

      if (!r.audio || !r.sampleRate) {
        if (state.status === "fallback") {
          // The worker died mid-message: finish the rest with the browser voice.
          const rest = segments.slice(i).map((s) => s.text).join(" ");
          const wait = Math.max(0, nextTime - ctx.currentTime) * 1000;
          this.timers.push(setTimeout(() => gen === this.gen && this.speakFallback(gen, rest, opts), wait));
          return;
        }
        continue; // skip one bad sentence rather than stall
      }

      const samples = trimAndFade(r.audio, r.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, r.sampleRate);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      const startAt = Math.max(ctx.currentTime + 0.03, nextTime);
      src.start(startAt);
      run.sources.push(src);
      nextTime = startAt + buffer.duration + segments[i].pauseAfterMs / 1000 / opts.rate;

      if (!started) {
        started = true;
        const delay = Math.max(0, startAt - ctx.currentTime) * 1000;
        this.timers.push(setTimeout(() => gen === this.gen && opts.onStart?.(), delay));
      }
    }

    // Finish when the last scheduled sentence has played.
    const remaining = Math.max(0, nextTime - ctx.currentTime) * 1000;
    this.timers.push(setTimeout(() => this.finish(gen), remaining));
  }

  private async getRunningAudioContext(): Promise<AudioContext | null> {
    const ctx = this.ensureAudioContext();
    if (!ctx) return null;
    if (ctx.state !== "running") {
      await withTimeout(ctx.resume().catch(() => undefined), 500, undefined);
    }
    return ctx.state === "running" ? ctx : null;
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    if (!AudioCtx) return null;
    try {
      this.audioCtx = new AudioCtx();
    } catch {
      return null;
    }
    return this.audioCtx;
  }

  /**
   * Browsers (Safari especially) only let audio start after a user gesture,
   * so unlock the AudioContext on the first tap or key press.
   */
  private installAudioUnlock() {
    if (typeof document === "undefined" || !AudioCtx) return;
    try {
      // iOS: play through the silent switch like other media.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
    } catch {
      /* not supported */
    }
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const unlock = () => {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      void ctx.resume().catch(() => undefined);
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
      if (ctx.state === "running") {
        events.forEach((ev) => document.removeEventListener(ev, unlock, true));
      }
    };
    events.forEach((ev) => document.addEventListener(ev, unlock, true));
  }

  private failPendingJobs() {
    this.jobs.forEach((job) => job.resolve({}));
    this.jobs.clear();
  }

  private stopRunAudio() {
    const run = this.run;
    this.run = null;
    if (!run || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    try {
      // Quick fade instead of a hard cut avoids a click.
      run.gain.gain.setTargetAtTime(0, now, 0.008);
      run.sources.forEach((s) => s.stop(now + 0.05));
    } catch {
      /* already stopped */
    }
    setTimeout(() => run.gain.disconnect(), 200);
  }

  /** Stop everything in flight and fire the current completion exactly once. */
  private halt() {
    const old = this.gen;
    this.gen++;
    this.worker?.postMessage({ type: "cancel", gen: old });
    this.jobs.forEach((job, id) => {
      if (job.gen <= old) {
        this.jobs.delete(id);
        job.resolve({});
      }
    });
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stopRunAudio();
    synthesisService.cancel();
    const end = this.pendingEnd;
    this.pendingEnd = null;
    end?.();
  }

  private finish(gen: number) {
    if (gen !== this.gen) return;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.run?.gen === gen) {
      this.run.gain.disconnect();
      this.run = null;
    }
    const end = this.pendingEnd;
    this.pendingEnd = null;
    end?.();
  }
}

export const voiceEngine = new VoiceEngine();
