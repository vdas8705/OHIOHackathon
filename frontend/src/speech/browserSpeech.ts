// Browser implementations of the speech service interfaces.
// Guarded so the app degrades gracefully in unsupported browsers.

import type {
  SpeechRecognitionService,
  SpeechSynthesisService,
} from "./types";
import { planSegments } from "./prosody";

// ---- minimal typings for the vendor-prefixed Web Speech API ----
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: ((e: any) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

// Voices that read as human: neural/cloud voices first, then good defaults.
const NATURAL_HINTS: [RegExp, number][] = [
  [/natural/i, 100],
  [/neural/i, 90],
  [/online/i, 70],
  [/enhanced|premium/i, 60],
  [/google/i, 40],
  [/\b(Aria|Jenny|Ava|Emma|Michelle|Samantha|Allison|Serena|Sonia|Libby|Karen|Moira|Zoe|Joanna)\b/i, 15],
];

// Novelty and legacy formant voices that sound robotic.
const ROBOTIC_VOICES =
  /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Deranged|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Hysterical|Fred|Junior|Ralph|Kathy|Princess|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b|espeak/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  if (!/^en/i.test(v.lang)) return -1000;
  let score = /en[-_]US/i.test(v.lang) ? 10 : 5;
  for (const [re, pts] of NATURAL_HINTS) if (re.test(v.name)) score += pts;
  if (ROBOTIC_VOICES.test(v.name)) score -= 200;
  if (v.default) score += 2;
  return score;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export class BrowserSynthesis implements SpeechSynthesisService {
  private cachedVoice: SpeechSynthesisVoice | undefined;
  private cachedVoiceCount = -1;
  // Bumped on every speak/cancel so stale callbacks from an old run do nothing.
  private generation = 0;
  private pendingEnd: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  // Holding a reference stops Chrome from garbage-collecting the utterance
  // mid-speech, which would drop its onend event.
  current: SpeechSynthesisUtterance | null = null;

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === this.cachedVoiceCount) return this.cachedVoice;
    this.cachedVoiceCount = voices.length;
    let best: SpeechSynthesisVoice | undefined;
    let bestScore = -Infinity;
    for (const v of voices) {
      const s = scoreVoice(v);
      if (s > bestScore) {
        best = v;
        bestScore = s;
      }
    }
    // No English voice at all: let the browser choose its default.
    this.cachedVoice = bestScore > -1000 ? best : undefined;
    return this.cachedVoice;
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Stop the current run and fire its completion exactly once. */
  private halt() {
    this.generation++;
    this.clearTimers();
    this.current = null;
    if (this.supported) window.speechSynthesis.cancel();
    const end = this.pendingEnd;
    this.pendingEnd = null;
    end?.();
  }

  speak(
    text: string,
    opts?: { onEnd?: () => void; onStart?: () => void; rate?: number }
  ) {
    this.halt(); // never let two messages overlap
    const segments = text.trim() ? planSegments(text) : [];
    if (!this.supported || !segments.length) {
      opts?.onEnd?.();
      return;
    }
    const synth = window.speechSynthesis;
    const gen = this.generation;
    const baseRate = opts?.rate ?? 1;
    this.pendingEnd = () => opts?.onEnd?.();
    let started = false;

    const finish = () => {
      if (gen !== this.generation) return;
      this.current = null;
      const end = this.pendingEnd;
      this.pendingEnd = null;
      end?.();
    };

    const playSegment = (i: number) => {
      if (gen !== this.generation) return;
      if (i >= segments.length) return finish();
      const seg = segments[i];
      const utter = new SpeechSynthesisUtterance(seg.text);
      utter.rate = clamp(baseRate * seg.rate, 0.5, 2);
      utter.pitch = clamp(seg.pitch, 0.5, 1.5);
      utter.volume = 1.0;
      const voice = this.pickVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      } else {
        utter.lang = "en-US";
      }

      let advanced = false;
      const next = () => {
        if (advanced || gen !== this.generation) return;
        advanced = true;
        const pause = seg.pauseAfterMs / utter.rate;
        this.timers.push(setTimeout(() => playSegment(i + 1), pause));
      };
      utter.onstart = () => {
        if (gen !== this.generation || started) return;
        started = true;
        opts?.onStart?.();
      };
      utter.onend = next;
      utter.onerror = next;

      // Safety net: some engines occasionally never fire onend.
      const words = seg.text.split(/\s+/).length;
      const expectedMs = ((words / 2.5) * 1000) / utter.rate + 4000;
      const watchdog = () => {
        if (advanced || gen !== this.generation) return;
        if (synth.speaking || synth.pending) {
          this.timers.push(setTimeout(watchdog, 500));
        } else {
          next();
        }
      };
      this.timers.push(setTimeout(watchdog, expectedMs));

      this.current = utter;
      synth.speak(utter);
    };

    // Some browsers need a tick after cancel before speaking reliably.
    this.timers.push(setTimeout(() => playSegment(0), 60));
  }

  cancel() {
    this.halt();
  }
}

export class BrowserRecognition implements SpeechRecognitionService {
  private recognition: ISpeechRecognition | null = null;

  get supported(): boolean {
    if (typeof window === "undefined") return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start(handlers: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }) {
    if (!this.supported) {
      handlers.onError("Speech recognition is not supported in this browser.");
      handlers.onEnd();
      return;
    }
    const Ctor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += chunk;
        else interim += chunk;
      }
      if (final) handlers.onResult(final, true);
      if (interim) handlers.onResult(interim, false);
    };
    rec.onerror = (e: any) => {
      const code = e?.error ?? "unknown";
      const message =
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone permission was denied."
          : code === "no-speech"
          ? "No speech detected."
          : `Speech recognition error: ${code}`;
      handlers.onError(message);
    };
    rec.onend = () => handlers.onEnd();

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if called while already running; ignore.
    }
  }

  stop() {
    this.recognition?.stop();
  }

  abort() {
    this.recognition?.abort();
  }
}

// Singletons shared across the app.
export const synthesisService = new BrowserSynthesis();
export const recognitionService = new BrowserRecognition();
