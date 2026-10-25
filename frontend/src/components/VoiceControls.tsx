import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2, VolumeX, Radio, Loader2, SlidersHorizontal, Play, Square } from "lucide-react";
import {
  KOKORO_VOICES,
  MAX_VOICE_RATE,
  MIN_VOICE_RATE,
  type KokoroVoiceId,
} from "../speech/voiceSettings";
import { voiceEngine, type VoiceEngineState } from "../speech/voiceEngine";

export type MicPhase =
  | "idle"
  | "listening"
  | "speaking" // interviewer speaking
  | "processing"
  | "disabled";

export function StatusPills({
  speaking,
  listening,
  processing,
  micSupported,
  micDenied,
}: {
  speaking: boolean;
  listening: boolean;
  processing: boolean;
  micSupported: boolean;
  micDenied: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* AI speaking indicator */}
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
          speaking
            ? "border-teal-accent/40 bg-teal-accent/15 text-teal-soft"
            : "border-white/10 bg-white/5 text-slate-500"
        }`}
      >
        <Volume2 className="h-3.5 w-3.5" />
        {speaking ? "Interviewer speaking…" : "Interviewer idle"}
      </span>

      {/* Processing indicator */}
      {processing && (
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…
        </span>
      )}

      {/* Listening indicator */}
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
          listening
            ? "border-rose-400/40 bg-rose-400/15 text-rose-300"
            : "border-white/10 bg-white/5 text-slate-500"
        }`}
      >
        <Radio className={`h-3.5 w-3.5 ${listening ? "animate-pulse" : ""}`} />
        {listening ? "Listening…" : "Mic idle"}
      </span>

      {/* Mic capability */}
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
          micDenied
            ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
            : micSupported
            ? "border-white/10 bg-white/5 text-slate-400"
            : "border-amber-400/30 bg-amber-400/10 text-amber-300"
        }`}
      >
        {micDenied ? (
          <>
            <MicOff className="h-3.5 w-3.5" /> Mic blocked
          </>
        ) : micSupported ? (
          <>
            <Mic className="h-3.5 w-3.5" /> Mic ready
          </>
        ) : (
          <>
            <MicOff className="h-3.5 w-3.5" /> Mic unsupported
          </>
        )}
      </span>
    </div>
  );
}

export function MicButton({
  listening,
  disabled,
  onClick,
}: {
  listening: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={listening ? "Stop microphone" : "Start microphone"}
      className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-teal-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${
        listening
          ? "bg-rose-500 text-white"
          : "bg-teal-accent text-navy-900 hover:bg-teal-soft"
      }`}
    >
      {listening && (
        <span className="absolute inset-0 rounded-full bg-rose-500/60 animate-pulseRing" />
      )}
      {listening ? (
        <MicOff className="relative h-7 w-7" />
      ) : (
        <Mic className="relative h-7 w-7" />
      )}
    </button>
  );
}

export function ToggleIconButton({
  active,
  onClick,
  onIcon,
  offIcon,
  title,
}: {
  active: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
        active
          ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
          : "border-rose-400/30 bg-rose-400/10 text-rose-300"
      }`}
    >
      {active ? onIcon : offIcon}
    </button>
  );
}

export function VoiceSettingsButton({
  enabled,
  rate,
  voice,
  engine,
  onToggleEnabled,
  onRateChange,
  onVoiceChange,
}: {
  enabled: boolean;
  rate: number;
  voice: KokoroVoiceId;
  engine: VoiceEngineState;
  onToggleEnabled: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voice: KokoroVoiceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<KokoroVoiceId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function preview(id: KokoroVoiceId, name: string) {
    if (previewing === id) {
      voiceEngine.cancel();
      setPreviewing(null);
      return;
    }
    setPreviewing(id);
    voiceEngine.preview(id, rate, name, () => setPreviewing((p) => (p === id ? null : p)));
  }

  const canPreview = engine.status === "ready";
  const previewHint =
    engine.status === "loading"
      ? `Previews unlock once the voice is ready (${engine.progress}%).`
      : engine.status === "fallback"
      ? "This device can't run the natural voices, so a simpler voice is used."
      : engine.status === "idle"
      ? "Turn the voice on to download the natural voices."
      : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Voice settings"
        aria-label="Voice settings"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition-all hover:bg-white/10"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Voice settings"
          className="fixed inset-x-4 bottom-24 z-30 rounded-xl border p-4 shadow-xl shadow-black/30 sm:absolute sm:inset-x-auto sm:bottom-12 sm:left-0 sm:w-80"
          style={{ background: "var(--bg-panel)", borderColor: "var(--bg-panel-border)", backdropFilter: "blur(12px)", color: "var(--text-primary)" }}
        >
          <label className="flex items-center justify-between text-sm font-medium">
            Interviewer voice
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={onToggleEnabled}
              className="h-4 w-4"
              style={{ accentColor: "var(--accent)" }}
            />
          </label>

          <label className="mt-4 block text-sm font-medium">
            <span className="flex items-center justify-between">
              Speed
              <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {rate.toFixed(2)}×
              </span>
            </span>
            <input
              type="range"
              min={MIN_VOICE_RATE}
              max={MAX_VOICE_RATE}
              step={0.05}
              value={rate}
              onChange={(e) => onRateChange(Number(e.target.value))}
              className="mt-2 w-full"
              style={{ accentColor: "var(--accent)" }}
            />
          </label>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Voice</legend>
            <ul className="mt-2 space-y-1.5">
              {KOKORO_VOICES.map((v) => {
                const selected = v.id === voice;
                return (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                    style={{
                      borderColor: selected ? "var(--accent)" : "var(--btn-ghost-border)",
                      background: selected ? "var(--badge-bg)" : "transparent",
                    }}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="kokoro-voice"
                        checked={selected}
                        onChange={() => onVoiceChange(v.id)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span className="truncate">
                        <span className="font-medium">{v.name}</span>{" "}
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {v.description}
                        </span>
                      </span>
                    </label>
                    <button
                      onClick={() => preview(v.id, v.name)}
                      disabled={!canPreview}
                      aria-label={`${previewing === v.id ? "Stop preview of" : "Preview"} ${v.name}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: "var(--btn-ghost-bg)", color: "var(--btn-ghost-text)", borderColor: "var(--btn-ghost-border)" }}
                    >
                      {previewing === v.id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {previewing === v.id ? "Stop" : "Preview"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {previewHint && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                {previewHint}
              </p>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Download progress for the neural voice, or a note when using the fallback. */
export function VoiceStatusNote({
  engine,
  enabled,
  hint,
}: {
  engine: VoiceEngineState;
  enabled: boolean;
  hint?: string;
}) {
  if (!enabled) return null;
  if (engine.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-full border px-3 py-1 text-xs font-medium"
        style={{ background: "var(--badge-bg)", borderColor: "var(--badge-border)", color: "var(--text-primary)" }}
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: "var(--accent)" }} />
        <span>
          Getting the voice ready… {engine.progress}%
          {hint && <span style={{ color: "var(--text-secondary)" }}> · {hint}</span>}
        </span>
        <span
          className="h-1.5 w-16 overflow-hidden rounded-full"
          style={{ background: "var(--btn-ghost-border)" }}
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full transition-[width] duration-300"
            style={{ width: `${engine.progress}%`, background: "var(--accent)" }}
          />
        </span>
      </div>
    );
  }
  if (engine.status === "fallback") {
    return (
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Using a simpler voice on this device.
      </span>
    );
  }
  return null;
}

export { Volume2, VolumeX, Mic, MicOff };
