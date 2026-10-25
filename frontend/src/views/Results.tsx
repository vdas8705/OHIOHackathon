import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import {
  GitBranch,
  RefreshCw,
  Printer,
  ChevronDown,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  Loader2,
} from "lucide-react";
import { Button, Panel, Badge, formatTime } from "../components/ui";
import { api } from "../api";
import type { CompletionStatus, PerformanceReport } from "../types";

const STATUS_META: Record<
  CompletionStatus,
  { label: string; tone: "teal" | "amber" | "rose" | "slate"; icon: any }
> = {
  completed: { label: "Completed", tone: "teal", icon: CheckCircle2 },
  timed_out: { label: "Time limit reached", tone: "amber", icon: Clock },
  ended_early: { label: "Ended early", tone: "amber", icon: XCircle },
  in_progress: { label: "In progress", tone: "slate", icon: Clock },
};

export default function Results({
  sessionId,
  onRestart,
  picker,
}: {
  sessionId: string;
  onRestart: () => void;
  picker: ReactNode;
}) {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api
      .report(sessionId)
      .then(setReport)
      .catch((e) => setError((e as Error).message));
  }, [sessionId]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="mt-4 text-slate-300">{error}</p>
        <Button className="mt-6" onClick={onRestart}>
          Start over
        </Button>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-teal-accent" />
        <p className="text-slate-400">Compiling your performance report…</p>
      </div>
    );
  }

  const status = STATUS_META[report.completion_status];
  const chartData = report.categories.map((c) => ({
    category: c.name.split(" ")[0],
    value: Math.round((c.score / c.max_score) * 100),
    fullMark: 100,
  }));
  const partial =
    report.completion_status !== "completed" || report.rounds_attempted < 5;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {/* Header */}
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 text-teal-accent" />
          <span className="font-bold">BranchPoint · Performance Report</span>
        </div>
        <div className="flex gap-2">
          {picker}
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={onRestart}>
            <RefreshCw className="h-4 w-4" /> New simulation
          </Button>
        </div>
      </header>

      {report.is_demo && (
        <div className="no-print mt-4">
          <Badge tone="amber">
            Demo mode — this report uses deterministic scoring, not live AI
            assessment
          </Badge>
        </div>
      )}

      {/* Score + radar */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Panel className="print-light flex flex-col items-center justify-center p-8 text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Overall score
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span className="text-7xl font-extrabold text-teal-accent">
              {report.overall_score}
            </span>
            <span className="mb-2 text-2xl font-bold text-slate-500">
              /{report.max_score}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge tone={status.tone}>
              <status.icon className="h-3.5 w-3.5" /> {status.label}
            </Badge>
            <Badge tone="slate">
              {report.completion_percentage}% completed
            </Badge>
            <Badge tone="slate">
              Active time {formatTime(report.total_active_seconds)}
            </Badge>
          </div>
          {partial && (
            <p className="mt-4 text-xs text-amber-300/90">
              This is a partial assessment — {report.rounds_attempted} of 5
              rounds were attempted. The score reflects demonstrated practice
              only and is not a hiring prediction.
            </p>
          )}
        </Panel>

        <Panel className="print-light p-5">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={chartData} outerRadius="72%">
              <PolarGrid stroke="rgba(148,163,184,0.25)" />
              <PolarAngleAxis
                dataKey="category"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <PolarRadiusAxis
                domain={[0, 100]}
                tick={{ fill: "#475569", fontSize: 10 }}
                axisLine={false}
              />
              <Radar
                dataKey="value"
                stroke="#2dd4bf"
                fill="#2dd4bf"
                fillOpacity={0.35}
              />
            </RadarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Summary */}
      <Panel className="print-light mt-5 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Summary
        </h2>
        <p className="mt-3 leading-relaxed text-slate-200">{report.summary}</p>
        {report.overall_recommendation && (
          <p className="mt-4 rounded-xl border border-teal-accent/20 bg-teal-accent/5 px-4 py-3 text-sm text-teal-soft">
            {report.overall_recommendation}
          </p>
        )}
      </Panel>

      {/* Category breakdown */}
      <h2 className="mt-8 text-lg font-bold">Category breakdown</h2>
      <div className="mt-3 space-y-3">
        {report.categories.map((c) => (
          <Panel key={c.name} className="print-light p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{c.name}</span>
              <span className="text-sm font-bold text-teal-soft">
                {c.score}
                <span className="text-slate-500">/{c.max_score}</span>
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-teal-accent"
                style={{ width: `${(c.score / c.max_score) * 100}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-slate-300">{c.explanation}</p>
            {c.improvements.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
                {c.improvements.map((imp, i) => (
                  <li key={i}>{imp}</li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>

      {/* Strengths / improvements / missed */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <InsightCard
          title="Strengths"
          icon={TrendingUp}
          tone="teal"
          items={report.strengths}
        />
        <InsightCard
          title="To improve"
          icon={AlertCircle}
          tone="amber"
          items={report.improvements}
        />
        <InsightCard
          title="Missed considerations"
          icon={Lightbulb}
          tone="slate"
          items={report.missed_considerations}
        />
      </div>

      {report.suggested_next_steps.length > 0 && (
        <Panel className="print-light mt-5 p-6">
          <h3 className="font-semibold">Suggested next steps</h3>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-300">
            {report.suggested_next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Round-by-round + decision timeline */}
      <h2 className="mt-8 text-lg font-bold">Round-by-round review</h2>
      <div className="mt-3 space-y-3">
        {report.round_reports.map((r) => (
          <Panel key={r.round_number} className="print-light overflow-hidden">
            <button
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              onClick={() => setOpen(open === r.round_number ? null : r.round_number)}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-accent/15 text-sm font-bold text-teal-soft">
                  {r.round_number}
                </span>
                <span className="font-medium">Round {r.round_number}</span>
                {r.timed_out && <Badge tone="amber">Timed out</Badge>}
              </span>
              <ChevronDown
                className={`h-5 w-5 text-slate-400 transition-transform ${
                  open === r.round_number ? "rotate-180" : ""
                }`}
              />
            </button>
            {open === r.round_number && (
              <div className="space-y-3 border-t border-white/10 px-5 py-4 text-sm">
                <Field label="Interviewer asked" value={r.question} />
                <Field label="Your response" value={r.response} accent />
                {r.consequence && (
                  <Field label="What happened next" value={r.consequence} />
                )}
                {r.analysis && (
                  <Field label="Analysis" value={r.analysis} />
                )}
              </div>
            )}
          </Panel>
        ))}
      </div>

      <div className="no-print mt-10 flex justify-center">
        <Button onClick={onRestart} className="px-8">
          <RefreshCw className="h-4 w-4" /> Run another simulation
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <p
        className={`mt-1 leading-relaxed ${
          accent ? "text-teal-soft" : "text-slate-300"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InsightCard({
  title,
  icon: Icon,
  tone,
  items,
}: {
  title: string;
  icon: any;
  tone: "teal" | "amber" | "slate";
  items: string[];
}) {
  const toneClass = {
    teal: "text-teal-soft",
    amber: "text-amber-300",
    slate: "text-slate-300",
  }[tone];
  return (
    <Panel className="print-light p-5">
      <div className={`flex items-center gap-2 ${toneClass}`}>
        <Icon className="h-4 w-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${toneClass}`} />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Not enough evidence to report here.
        </p>
      )}
    </Panel>
  );
}
