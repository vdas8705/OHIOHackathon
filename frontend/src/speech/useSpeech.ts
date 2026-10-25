import { useCallback, useEffect, useRef, useState } from "react";
import { recognitionService, synthesisService } from "./browserSpeech";
import { useVoiceEngineState, voiceEngine } from "./voiceEngine";
import type { KokoroVoiceId } from "./voiceSettings";

/**
 * Text-to-speech hook for the interviewer voice (Kokoro, with a browser-voice
 * fallback). Exposes speaking state and respects mute, speed, and voice.
 */
export function useInterviewerVoice(muted: boolean, rate = 1, voice: KokoroVoiceId = "af_heart") {
  const [speaking, setSpeaking] = useState(false);
  const engine = useVoiceEngineState();
  const supported = true; // the engine always has a path, even if it's silent

  // Warm up fallback voices (some browsers load them async).
  useEffect(() => {
    if (synthesisService.supported) {
      window.speechSynthesis.getVoices();
      const handler = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", handler);
      return () =>
        window.speechSynthesis.removeEventListener?.("voiceschanged", handler);
    }
  }, []);

  // Load the neural voice the first time it's needed (voice on), not on page open.
  useEffect(() => {
    if (!muted) void voiceEngine.preload();
  }, [muted]);

  const speak = useCallback(
    (text: string, onComplete?: () => void) => {
      // If muted, invoke the completion immediately so the response flow
      // (timer start) still proceeds.
      if (muted) {
        onComplete?.();
        return;
      }
      setSpeaking(true);
      voiceEngine.speak(text, {
        voice,
        rate,
        onStart: () => setSpeaking(true),
        onEnd: () => {
          setSpeaking(false);
          onComplete?.();
        },
      });
    },
    [muted, rate, voice]
  );

  const stop = useCallback(() => {
    voiceEngine.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, supported, engine };
}

/**
 * Speech-to-text hook. Accumulates a final transcript and exposes the current
 * interim text. Designed so recording never overlaps interviewer playback
 * (the caller controls when to start).
 */
export function useSpeechRecognition() {
  const supported = recognitionService.supported;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef<(full: string) => void>(() => {});
  const onActivityRef = useRef<((chunk: string, isFinal: boolean) => void) | undefined>(undefined);

  const start = useCallback(
    (
      onFinal: (full: string) => void,
      seed = "",
      // Optional: every raw result, interim or final (used for delivery coaching).
      onActivity?: (chunk: string, isFinal: boolean) => void
    ) => {
      if (!supported) {
        setError("Speech recognition is not supported in this browser.");
        return;
      }
      setError(null);
      finalRef.current = seed ? seed.trimEnd() + " " : "";
      onFinalRef.current = onFinal;
      onActivityRef.current = onActivity;
      setListening(true);
      recognitionService.start({
        onResult: (transcript, isFinal) => {
          onActivityRef.current?.(transcript, isFinal);
          if (isFinal) {
            finalRef.current = (finalRef.current + transcript + " ").replace(
              /\s+/g,
              " "
            );
            setInterim("");
            onFinalRef.current(finalRef.current.trim());
          } else {
            setInterim(transcript);
          }
        },
        onError: (message) => {
          setError(message);
          setListening(false);
        },
        onEnd: () => {
          setListening(false);
          setInterim("");
        },
      });
    },
    [supported]
  );

  const stop = useCallback(() => {
    recognitionService.stop();
    setListening(false);
  }, []);

  const abort = useCallback(() => {
    recognitionService.abort();
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, interim, error, start, stop, abort, setError };
}
