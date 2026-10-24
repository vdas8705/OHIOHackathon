import { Mic, MicOff, Volume2, VolumeX, Radio, Loader2 } from "lucide-react";

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

export { Volume2, VolumeX, Mic, MicOff };
