// Service interfaces for speech. The browser implementations live alongside
// these types, but any provider (cloud STT/TTS) can implement the same shape.

export interface SpeechSynthesisService {
  readonly supported: boolean;
  speak(
    text: string,
    opts?: { onEnd?: () => void; onStart?: () => void; rate?: number }
  ): void;
  cancel(): void;
}

export type RecognitionStatus =
  | "idle"
  | "listening"
  | "error"
  | "unsupported";

export interface SpeechRecognitionService {
  readonly supported: boolean;
  start(handlers: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }): void;
  stop(): void;
  abort(): void;
}
