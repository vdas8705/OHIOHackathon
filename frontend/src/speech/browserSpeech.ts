// Browser implementations of the speech service interfaces.
// Guarded so the app degrades gracefully in unsupported browsers.

import type {
  SpeechRecognitionService,
  SpeechSynthesisService,
} from "./types";

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

export class BrowserSynthesis implements SpeechSynthesisService {
  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return undefined;
    // Prefer a natural-sounding English voice when available.
    const preferred = voices.find(
      (v) =>
        /en[-_]US/i.test(v.lang) &&
        /(Google|Samantha|Natural|Aria|Jenny|Daniel)/i.test(v.name)
    );
    return (
      preferred ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      voices[0]
    );
  }

  speak(text: string, opts?: { onEnd?: () => void; onStart?: () => void }) {
    if (!this.supported || !text.trim()) {
      opts?.onEnd?.();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    const voice = this.pickVoice();
    if (voice) utter.voice = voice;
    utter.onstart = () => opts?.onStart?.();
    utter.onend = () => opts?.onEnd?.();
    utter.onerror = () => opts?.onEnd?.();
    // Some browsers need a tick after cancel before speaking reliably.
    setTimeout(() => synth.speak(utter), 60);
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
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
