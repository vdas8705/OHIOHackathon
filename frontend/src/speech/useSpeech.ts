import { useCallback, useEffect, useRef, useState } from "react";
import { recognitionService, synthesisService } from "./browserSpeech";

/**
 * Text-to-speech hook for the interviewer voice.
 * Exposes speaking state and respects a mute toggle and speed setting.
 */
export function useInterviewerVoice(muted: boolean, rate = 1) {
  const [speaking, setSpeaking] = useState(false);
  const supported = synthesisService.supported;

  // Warm up voices (some browsers load them async).
  useEffect(() => {
    if (supported) {
      window.speechSynthesis.getVoices();
      const handler = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", handler);
      return () =>
        window.speechSynthesis.removeEventListener?.("voiceschanged", handler);
    }
  }, [supported]);

  const speak = useCallback(
    (text: string, onComplete?: () => void) => {
      // If muted or unsupported, invoke the completion immediately so the
      // response flow (timer start) still proceeds.
      if (muted || !supported) {
        onComplete?.();
        return;
      }
      setSpeaking(true);
      synthesisService.speak(text, {
        rate,
        onStart: () => setSpeaking(true),
        onEnd: () => {
          setSpeaking(false);
          onComplete?.();
        },
      });
    },
    [muted, supported, rate]
  );

  const stop = useCallback(() => {
    synthesisService.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, supported };
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

  const start = useCallback(
    (onFinal: (full: string) => void, seed = "") => {
      if (!supported) {
        setError("Speech recognition is not supported in this browser.");
        return;
      }
      setError(null);
      finalRef.current = seed ? seed.trimEnd() + " " : "";
      onFinalRef.current = onFinal;
      setListening(true);
      recognitionService.start({
        onResult: (transcript, isFinal) => {
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
