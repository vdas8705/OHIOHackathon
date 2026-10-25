import { useState } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  ChevronDown,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  Target,
  ListChecks,
} from "lucide-react";
import { Panel, Badge, formatTime } from "./ui";
import type { CompletionStatus, PerformanceReport, RoundReport } from "../types";

// Overtime markers use the theme's warning pair (AA-checked in every theme).
const OT_STYLE = { background: "var(--warn-bg)", color: "var(--warn-text)" } as const;

function OvertimeChip({ points, title }: { points: number; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
      style={OT_STYLE}
      title={title}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />−{points}
      <span className="sr-only"> points for overtime</span>
    </span>
  );
}

/** "Question 2: 11/20 − 3 (1:12 over · tier 3, −30%) = 8/20" */
function sectionLine(r: RoundReport): string {
  const possible = r.section_points_possible ?? 0;
  const before = r.section_points_before_overtime ?? 0;
  const after = r.section_points ?? before;
  if (!r.overtime_seconds) return `Question ${r.round_number}: ${after}/${possible} (on time)`;
  return (
    `Question ${r.round_number}: ${before}/${possible} − ${r.overtime_deduction ?? 0} ` +
    `(${formatTime(r.overtime_seconds)} over · tier ${r.overtime_tier}, −${r.overtime_penalty_pct}%) ` +
    `= ${after}/${possible}`
  );
}

const STATUS_META: Record<
  CompletionStatus,
  { label: string; tone: "teal" | "amber" | "rose" | "slate"; icon: any }
> = {
  completed: { label: "Completed", tone: "teal", icon: CheckCircle2 },
  timed_out: { label: "Time limit reached", tone: "amber", icon: Clock },
  ended_early: { label: "Ended early", tone: "amber", icon: XCircle },
  in_progress: { label: "In progress", tone: "slate", icon: Clock },
};

const CATEGORY_BLURB: Record<string, string> = {
  "Technical reasoning":
    "Accuracy, depth, and validity of your technical thinking.",
  "Decision-making and risk assessment":
    "How clearly you weighed options and addressed risk and trade-offs.",
  Adaptability: "How well you incorporated new information across rounds.",
  "Communication and explanation":
    "Clarity, organization, and conciseness of your explanations.",
  "Clarifying questions and information gathering":
    "Whether you sought the information you needed when appropriate.",
};

const LEVEL_TONE: Record<string, "teal" | "amber" | "rose" | "slate"> = {
  Strong: "teal",
  Developing: "amber",
  "Needs Improvement": "rose",
  "Not attempted": "slate",
};

function radarLabel(name: string): string {
  // Short axis labels for the radar.
  if (name.startsWith("Technical")) return "Technical";
  if (name.startsWith("Decision")) return "Decisions";
  if (name.startsWith("Adapt")) return "Adaptability";
  if (name.startsWith("Communication")) return "Communication";
  if (name.startsWith("Clarifying")) return "Clarifying";
  return name.split(" ")[0];
}

/**
 * Renders the full, read-only performance report body. Shared by the live
 * Results page and the historical session viewer so the radar and every
 * section appear identically in both.
 */
export default function ReportBody({ report }: { report: PerformanceReport }) {
  const [open, setOpen] = useState<number | null>(null);

  // Legacy reports (schema_version 1 or missing categories) can't show the
  // weighted radar — surface a clear legacy notice instead of inventing data.
  const isLegacy =
    (report.schema_version ?? 1) < 2 || !report.categories?.length;

  const status = STATUS_META[report.completion_status] ?? STATUS_META.completed;
  const otLost = report.overtime_points_lost ?? 0;
  const hasSectionScores = report.round_reports.some((r) => (r.section_points_possible ?? 0) > 0);
  const anyOvertime = report.round_reports.some((r) => (r.overtime_seconds ?? 0) > 0);
  const partial =
    report.completion_status !== "completed" || report.rounds_attempted < 5;

  const chartData = (report.categories ?? []).map((c) => ({
    category: radarLabel(c.name),
    value: c.max_score ? Math.round((c.score / c.max_score) * 100) : 0,
    fullMark: 100,
  }));

  const stats = report.question_type_stats ?? [];
  const weaknesses = report.weaknesses ?? [];
  const recs = report.practice_recommendations ?? [];

  if (isLegacy) {
    return (
      <Panel className="print-light mt-6 p-6">
        <Badge tone="slate">Legacy result</Badge>
        <p className="mt-3 text-sm text-slate-300">
          This session was saved with an older scoring format, so the weighted
          100-point breakdown and radar chart aren't available for it. New
          sessions will show the full report.
        </p>
        {report.summary && (
          <p className="mt-3 text-sm text-slate-400">{report.summary}</p>
        )}
      </Panel>
    );
  }

  return (
    <div>
      {report.is_demo && (
        <div className="no-print mt-4">
          <Badge tone="amber">
            Demo mode — deterministic scoring, not a full AI assessment
          </Badge>
        </div>
      )}

      {/* Section 1 + 2: Overall score + radar */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Panel className="print-light flex flex-col items-center justify-center p-8 text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Overall weighted score
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span className="text-7xl font-extrabold" style={{ color: "var(--accent, #2dd4bf)" }}>
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
            <Badge tone="slate">{report.completion_percentage}% completed</Badge>
            <Badge tone="slate">
              Active {formatTime(report.total_active_seconds)}
            </Badge>
          </div>
          {otLost > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold" style={OT_STYLE}>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Includes −{otLost} for overtime (was {report.overall_score_before_overtime})
            </p>
          )}
          {partial && (
            <p className="mt-4 text-xs text-amber-300/90">
              Partial assessment — {report.rounds_attempted} of 5 rounds
              attempted. Reflects demonstrated practice only, not a hiring
              prediction.
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
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-3">
            {(report.categories ?? []).map((c) => (
              <div key={c.name} className="flex items-center justify-between">
                <span className="truncate">{radarLabel(c.name)}</span>
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  {c.score}/{c.max_score}
                  {(c.overtime_deduction ?? 0) > 0 && <OvertimeChip points={c.overtime_deduction!} />}
                </span>
              </div>
            ))}
          </div>
          {otLost > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Scores are shown after overtime deductions. Each chip with a clock is points lost to
              overtime, spread across categories by their weight.
            </p>
          )}
        </Panel>
      </div>

      {/* Section scores + overtime deductions */}
      {hasSectionScores && anyOvertime && (
        <Panel className="print-light mt-5 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-400">
            <Clock className="h-4 w-4" aria-hidden="true" /> Time and overtime by question
          </h2>
          <p className="mt-2 text-xs text-slate-400">
            Each question is worth {report.round_reports[0]?.section_points_possible} points. Going
            over a question's time only reduces that question's points.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {report.round_reports.map((r) => (
              <li
                key={r.round_number}
                className={`rounded-lg px-3 py-1.5 ${r.overtime_deduction ? "font-semibold" : "text-slate-300"}`}
                style={r.overtime_deduction ? OT_STYLE : undefined}
              >
                {r.overtime_deduction ? <Clock className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /> : null}
                {sectionLine(r)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-bold text-slate-200">
            Total lost to overtime: {otLost} point{otLost === 1 ? "" : "s"}
          </p>
        </Panel>
      )}

      {/* Summary */}
      {report.summary && (
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
      )}

      {/* Competency breakdown */}
      <h2 className="mt-8 text-lg font-bold">Competency breakdown</h2>
      <div className="mt-3 space-y-3">
        {(report.categories ?? []).map((c) => (
          <Panel key={c.name} className="print-light p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{c.name}</span>
              <span className="text-sm font-bold text-teal-soft">
                {c.score}
                <span className="text-slate-500">/{c.max_score}</span>
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {CATEGORY_BLURB[c.name]}
            </div>
            {(c.overtime_deduction ?? 0) > 0 && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style={OT_STYLE}>
                <Clock className="h-3 w-3" aria-hidden="true" />
                Includes −{c.overtime_deduction} for overtime
              </div>
            )}
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

      {/* Section 3: Strengths / improvements / weaknesses */}
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

      {/* Detected weaknesses (observed vs potential) */}
      {weaknesses.length > 0 && (
        <Panel className="print-light mt-5 p-6">
          <div className="flex items-center gap-2 text-rose-300">
            <Target className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Where you struggled</h3>
          </div>
          <div className="mt-3 space-y-3">
            {weaknesses.map((w, i) => (
              <div key={i} className="rounded-xl border border-white/10 p-4">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">{w.label}</span>
                  <Badge tone={w.kind === "observed" ? "rose" : "slate"}>
                    {w.kind === "observed"
                      ? "Observed"
                      : "Observation (limited evidence)"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-400">{w.detail}</p>
                {w.evidence.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                    {w.evidence.map((e, j) => (
                      <li key={j}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Section 4: Question-type performance */}
      {stats.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Question-type performance</h2>
          <p className="mt-1 text-xs text-slate-500">
            A per-question indicator (0–100) used only to spot patterns. It does
            not affect your weighted score above.
          </p>
          <Panel className="print-light mt-3 p-5">
            <ResponsiveContainer width="100%" height={Math.max(160, stats.length * 46)}>
              <BarChart
                data={stats.map((s) => ({
                  name: s.question_type,
                  value: s.average_indicator,
                }))}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fill: "#475569", fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={180}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                  {stats.map((s, i) => (
                    <Cell
                      key={i}
                      fill={
                        s.average_indicator >= 70
                          ? "#2dd4bf"
                          : s.average_indicator >= 50
                          ? "#fbbf24"
                          : "#fb7185"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 space-y-2">
              {stats.map((s) => (
                <div
                  key={s.question_type}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-200">
                      {s.question_type}
                    </span>
                    <span className="text-xs text-slate-400">
                      {s.count} {s.count === 1 ? "question" : "questions"} ·{" "}
                      {s.average_indicator}/100
                    </span>
                  </div>
                  {s.common_mistakes.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                      {s.common_mistakes.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* Section 5: Detailed question breakdown (non-binary) */}
      <h2 className="mt-8 text-lg font-bold">Detailed question breakdown</h2>
      <div className="mt-3 space-y-3">
        {report.round_reports.map((r) => (
          <Panel key={r.round_number} className="print-light overflow-hidden">
            <button
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              onClick={() => setOpen(open === r.round_number ? null : r.round_number)}
            >
              <span className="flex flex-wrap items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-accent/15 text-sm font-bold text-teal-soft">
                  {r.round_number}
                </span>
                <span className="font-medium">Round {r.round_number}</span>
                {r.question_type && <Badge tone="slate">{r.question_type}</Badge>}
                {r.performance_level && (
                  <Badge tone={LEVEL_TONE[r.performance_level] ?? "slate"}>
                    {r.performance_level}
                  </Badge>
                )}
                {r.timed_out && <Badge tone="amber">Timed out</Badge>}
                {(r.overtime_deduction ?? 0) > 0 && (
                  <OvertimeChip points={r.overtime_deduction!} title={`${formatTime(r.overtime_seconds ?? 0)} over time`} />
                )}
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
                {(r.section_points_possible ?? 0) > 0 && (
                  <Field label="Question score" value={sectionLine(r).replace(/^Question \d+: /, "")} />
                )}
                {(r.secondary_types?.length || r.competencies?.length) && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.secondary_types?.map((t) => (
                      <Badge key={t} tone="slate">
                        {t}
                      </Badge>
                    ))}
                    {r.competencies?.map((c) => (
                      <Badge key={c} tone="teal">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
                <Field label="Your response" value={r.response} accent />
                {r.clarifications && r.clarifications.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Clarifying exchanges
                    </div>
                    {r.clarifications.map((c, i) => (
                      <div key={i} className="mt-1 text-xs text-slate-400">
                        <span className="text-amber-300">Q:</span> {c.question}
                        <br />
                        <span className="text-teal-soft">A:</span> {c.answer}
                      </div>
                    ))}
                  </div>
                )}
                {r.consequence && (
                  <Field label="What happened next" value={r.consequence} />
                )}
                {r.what_went_well && (
                  <Field label="What you did well" value={r.what_went_well} />
                )}
                {r.what_was_missed && (
                  <Field label="What you missed" value={r.what_was_missed} />
                )}
                {r.stronger_approach && (
                  <Field label="A stronger approach" value={r.stronger_approach} />
                )}
                {r.why_it_mattered && (
                  <Field label="Why your decision mattered" value={r.why_it_mattered} />
                )}
              </div>
            )}
          </Panel>
        ))}
      </div>

      {/* Section 6: Personalized practice recommendations */}
      {recs.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Recommended practice</h2>
          <div className="mt-3 space-y-3">
            {recs.map((r, i) => (
              <Panel key={i} className="print-light p-5">
                <div className="flex items-center gap-2 text-teal-soft">
                  <ListChecks className="h-4 w-4" />
                  <span className="text-sm font-semibold">{r.weakness}</span>
                </div>
                {r.evidence && (
                  <p className="mt-2 text-xs italic text-slate-500">
                    Evidence: {r.evidence}
                  </p>
                )}
                <p className="mt-2 text-sm text-slate-300">{r.recommendation}</p>
              </Panel>
            ))}
          </div>
        </>
      )}
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
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${toneClass}`}
              />
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
