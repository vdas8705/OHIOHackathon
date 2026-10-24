import { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-navy-800/70 backdrop-blur-sm shadow-xl shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger" | "subtle";
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-teal-accent/50 disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary:
      "bg-teal-accent text-navy-900 hover:bg-teal-soft shadow-lg shadow-teal-accent/20",
    ghost:
      "bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10",
    danger:
      "bg-rose-500/90 text-white hover:bg-rose-500 border border-rose-400/30",
    subtle: "bg-transparent text-slate-300 hover:text-white hover:bg-white/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: "teal" | "amber" | "rose" | "slate";
}) {
  const tones: Record<string, string> = {
    teal: "bg-teal-accent/15 text-teal-soft border-teal-accent/30",
    amber: "bg-amber-400/15 text-amber-300 border-amber-400/30",
    rose: "bg-rose-400/15 text-rose-300 border-rose-400/30",
    slate: "bg-white/5 text-slate-300 border-white/10",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.max(0, totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
