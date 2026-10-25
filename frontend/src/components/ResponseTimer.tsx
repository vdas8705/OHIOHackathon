import { AlertTriangle } from "lucide-react";
import { formatTime } from "./ui";
import type { OvertimeTier } from "../types";

/**
 * Response timer for one section. Counts down normally; once it passes zero it
 * switches to overtime, counting up with the current penalty and the next tier.
 * Tiers come from the backend (overtime.py), so this always matches scoring.
 */
export function ResponseTimer({
  remaining,
  limit,
  tiers,
}: {
  remaining: number; // seconds; negative once in overtime
  limit: number;
  tiers: OvertimeTier[];
}) {
  const overtime = Math.max(0, -remaining);

  if (overtime === 0) {
    const pct = (Math.max(0, remaining) / limit) * 100;
    const tone = remaining <= 15 ? "text-rose-400" : remaining <= 30 ? "text-amber-300" : "text-teal-soft";
    return (
      <div className="flex items-center gap-3">
        <div className={`text-right ${tone}`}>
          <div className="text-xs font-medium text-slate-400">Response time</div>
          <div className="text-2xl font-bold tabular-nums">{formatTime(Math.max(0, remaining))}</div>
        </div>
        <div className="relative h-12 w-12">
          <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${(pct / 100) * 100.5} 100.5`}
              strokeLinecap="round"
              className={tone}
            />
          </svg>
        </div>
      </div>
    );
  }

  const fallback: OvertimeTier = { tier: 1, starts_after_seconds: 0, ends_at_seconds: null, penalty_pct: 0 };
  const current =
    tiers.find((t) => t.ends_at_seconds === null || overtime <= t.ends_at_seconds) ??
    tiers[tiers.length - 1] ??
    fallback;
  const next = tiers.find((t) => t.tier === current.tier + 1);
  const untilNext = current.ends_at_seconds !== null ? current.ends_at_seconds - overtime + 1 : 0;
  const level = current.tier <= 2 ? "soft" : current.tier < tiers.length ? "strong" : "max";

  return (
    <div className={`comic-overtime comic-overtime--${level} comic-font`} data-tier={current.tier}>
      <div className="flex items-center gap-1.5 text-[13px] font-bold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Overtime: points being deducted
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-bold leading-none tabular-nums" aria-label={`${formatTime(overtime)} over time`}>
          +{formatTime(overtime)}
        </div>
        <div className="comic-overtime__pips" aria-hidden="true">
          {tiers.map((t) => (
            <span key={t.tier} className={t.tier <= current.tier ? "is-on" : ""} />
          ))}
        </div>
      </div>
      <div className="mt-1 text-[13px] font-bold">
        −{current.penalty_pct}% so far
        <span className="font-normal">
          {next ? ` · next: −${next.penalty_pct}% in ${formatTime(untilNext)}` : " · maximum penalty"}
        </span>
      </div>
      {/* Announced once per tier, not every second. */}
      <span className="sr-only" aria-live="polite">
        {current.tier === 1
          ? `Time's up. Overtime started: ${current.penalty_pct} percent of this question's points deducted so far.`
          : `Overtime penalty increased to ${current.penalty_pct} percent of this question's points.`}
      </span>
    </div>
  );
}
