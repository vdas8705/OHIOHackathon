import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Lightbulb,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { Button, Panel } from "../components/ui";
import { api } from "../api";
import type { Correctness, QuestionReview, SessionReview } from "../types";

interface Props {
  sessionId: string;
  picker: ReactNode;
  onRestart: () => void;
  onViewHistory: () => void;
}

const CORRECTNESS_META: Record<
  Correctness,
  { icon: typeof CheckCircle2; label: string; color: string; bg: string }
> = {
  correct: { icon: CheckCircle2, label: "Correct", color: "var(--badge-text)", bg: "var(--badge-bg)" },
  partly_correct: { icon: AlertCircle, label: "Partly correct", color: "var(--warn-text)", bg: "var(--warn-bg)" },
  incorrect: { icon: XCircle, label: "Incorrect", color: "var(--warn-max-bg)", bg: "color-mix(in srgb, var(--warn-max-bg) 12%, transparent)" },
};

export default function ReviewView({ sessionId, picker, onRestart, onViewHistory }: Props) {
  const [review, setReview] = useState<SessionReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = () => {
    setLoading(true);
    setError(null);
    api
      .review(sessionId)
      .then((r) => {
        setReview(r);
        setLoading(false);
      })
      .catch((e) => {
        setError((e as Error).message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="subtle" onClick={onViewHistory}>
          <ArrowLeft className="h-4 w-4" /> Past Sessions
        </Button>
        <div className="flex items-center gap-2">
          {picker}
          <Button onClick={onRestart} className="gap-2">
            <RefreshCw className="h-4 w-4" /> New session
          </Button>
        </div>
      </header>

      {/* Loading state */}
      {loading && (
        <div className="mt-20 flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-accent/10 ring-1 ring-teal-accent/20">
            <Loader2 className="h-8 w-8 animate-spin text-teal-accent" />
          </div>
          <h2 className="text-xl font-bold">Reviewing your answers…</h2>
          <p className="text-sm text-slate-400">
            We're going through each question to give you personalized feedback.
          </p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="mt-20 flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-10 w-10 text-rose-400" />
          <h2 className="text-xl font-bold">Couldn't generate review</h2>
          <p className="text-sm text-slate-400">{error}</p>
          <Button onClick={fetch} className="mt-2">
            Try again
          </Button>
        </div>
      )}

      {/* Review content */}
      {review && !loading && !error && (
        <>
          {/* Score + summary */}
          <Panel className="mt-6 p-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Your result
            </div>
            <div className="mt-3 flex items-end justify-center gap-1.5">
              <span
                className="text-6xl font-extrabold"
                style={{ color: "var(--accent)" }}
              >
                {review.score}
              </span>
              <span className="mb-1.5 text-2xl font-bold text-slate-500">
                out of {review.total}
              </span>
            </div>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-300">
              {review.summary}
            </p>
            {review.is_demo && (
              <p className="mt-3 text-xs text-amber-300/80">
                Demo mode — feedback uses rule-based assessment, not live AI.
              </p>
            )}
          </Panel>

          {/* Per-question breakdown */}
          <h2 className="mt-8 text-lg font-bold">Question-by-question breakdown</h2>
          <div className="mt-4 space-y-4">
            {review.question_reviews.map((qr) => (
              <QuestionCard key={qr.round_number} qr={qr} />
            ))}
          </div>

          {/* Tips */}
          {review.tips.length > 0 && (
            <Panel className="mt-6 p-6">
              <div className="flex items-center gap-2" style={{ color: "var(--accent)" }}>
                <Lightbulb className="h-5 w-5" />
                <h2 className="text-lg font-bold">What to work on</h2>
              </div>
              <ul className="mt-4 space-y-3">
                {review.tips.map((tip, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-300">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{ background: "var(--badge-bg)", color: "var(--accent)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="pt-0.5 leading-relaxed">{tip}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* New session button */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <Button onClick={onRestart} className="px-8 py-3 text-base">
              <Sparkles className="h-4 w-4" /> Start a new session
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function QuestionCard({ qr }: { qr: QuestionReview }) {
  const meta = CORRECTNESS_META[qr.correctness];
  const Icon = meta.icon;

  return (
    <Panel className="overflow-hidden p-5">
      {/* Question header */}
      <div className="flex items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: "var(--badge-bg)", color: "var(--accent)" }}
        >
          {qr.round_number}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: meta.bg, color: meta.color }}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-200">
            {qr.question}
          </p>
        </div>
      </div>

      {/* Answer */}
      <div className="mt-4 ml-11 space-y-3">
        <ReviewField label="Your answer" value={qr.user_answer} />
        {qr.what_did_well && (
          <ReviewField
            label="What you did well"
            value={qr.what_did_well}
            icon={<CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--badge-text)" }} />}
          />
        )}
        {qr.what_missed && (
          <ReviewField
            label="What you missed"
            value={qr.what_missed}
            icon={<AlertCircle className="h-3.5 w-3.5" style={{ color: "var(--warn-text)" }} />}
          />
        )}
        {qr.better_approach && (
          <ReviewField
            label="A better approach"
            value={qr.better_approach}
            icon={<Lightbulb className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />}
          />
        )}
        {qr.explanation && (
          <ReviewField
            label="Why"
            value={qr.explanation}
          />
        )}
      </div>
    </Panel>
  );
}

function ReviewField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">{value}</p>
    </div>
  );
}
