import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { TrendingUp, TrendingDown, Info, Repeat } from "lucide-react";
import { Panel, Badge } from "./ui";
import type { HistoryTrends } from "../types";

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TrendsPanel({ trends }: { trends: HistoryTrends }) {
  if (!trends.has_enough_data) {
    return (
      <Panel className="print-light mt-8 p-6">
        <div className="flex items-center gap-2 text-slate-400">
          <Info className="h-4 w-4" />
          <h2 className="text-sm font-semibold uppercase tracking-widest">
            Historical progress
          </h2>
        </div>
        <p className="mt-3 text-sm text-slate-400">{trends.message}</p>
      </Panel>
    );
  }

  const series = trends.overall_score_series.map((p, i) => ({
    label: shortDate(p.created_at) || `#${i + 1}`,
    score: p.score ?? 0,
  }));

  return (
    <Panel className="print-light mt-8 p-6">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-teal-accent" />
        <h2 className="text-lg font-bold">Historical progress</h2>
        <Badge tone="slate">{trends.completed_sessions} sessions</Badge>
      </div>

      {/* Overall score trend */}
      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Overall weighted score over time
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={series} margin={{ top: 12, right: 16, left: -16, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "var(--text-secondary)", fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "var(--bg-panel)",
                border: "1px solid var(--bg-panel-border)",
                borderRadius: 12,
                color: "var(--text-primary)",
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "var(--accent)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Competency movement */}
      {trends.improvements.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {trends.improvements.map((imp, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-white/10 p-4"
            >
              {imp.direction === "improving" ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-teal-accent" />
              ) : (
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              )}
              <div>
                <div className="text-sm font-semibold text-slate-200">
                  {imp.competency}
                </div>
                <div className="text-xs text-slate-400">{imp.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recurring weaknesses */}
      {trends.recurring_weaknesses.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-rose-300">
            <Repeat className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Recurring weaknesses</h3>
          </div>
          <div className="mt-2 space-y-2">
            {trends.recurring_weaknesses.map((w, i) => (
              <div
                key={i}
                className="rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm"
              >
                <span className="font-medium text-slate-200">
                  {w.question_type}
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  {w.average_indicator}/100 · {w.sessions_counted} sessions
                </span>
                <p className="mt-1 text-xs text-slate-400">{w.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">
          No recurring weaknesses detected yet. A pattern needs at least three
          questions of a type across two or more sessions.
        </p>
      )}
    </Panel>
  );
}
