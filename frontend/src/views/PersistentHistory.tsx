import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  History,
  MessageSquare,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  GitBranch,
  RefreshCw,
  Printer,
  Headphones,
} from "lucide-react";
import { Button, Panel, Badge, formatTime } from "../components/ui";
import ReportBody from "../components/ReportBody";
import { api } from "../api";
import type { HistoryDetail, HistorySummary } from "../types";
import { SavedWalkthrough } from "./Walkthrough";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const STATUS_BADGE: Record<string, { label: string; tone: "teal" | "amber" | "slate"; icon: any }> = {
  completed: { label: "Completed", tone: "teal", icon: CheckCircle2 },
  timed_out: { label: "Timed out", tone: "amber", icon: Clock },
  ended_early: { label: "Ended early", tone: "amber", icon: XCircle },
};

// ── List ───────────────────────────────────────────────────────────────────
export function PersistentHistoryList({
  picker,
  onBack,
  onOpen,
}: {
  picker: ReactNode;
  onBack: () => void;
  onOpen: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<HistorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .historyList()
      .then(setSessions)
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <Button variant="subtle" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {picker}
      </header>

      <div className="mt-6 flex items-center gap-2">
        <History className="h-5 w-5" style={{ color: "var(--accent)" }} />
        <h1 className="text-2xl font-bold">Past Sessions</h1>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Saved on the server and kept across restarts. This is a local
        single-user history — there is no login, so don't treat it as private on
        a shared machine.
      </p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {!sessions && !error && (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-teal-accent" />
        </div>
      )}

      {sessions && sessions.length === 0 && (
        <Panel className="mt-6 p-8 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-slate-500" />
          <p className="mt-4 text-sm text-slate-400">
            No saved sessions yet. Finish an interview to see it here.
          </p>
        </Panel>
      )}

      {sessions && sessions.length > 0 && (
        <div className="mt-5 space-y-3">
          {sessions.map((s) => {
            const badge = STATUS_BADGE[s.completion_status] ?? STATUS_BADGE.completed;
            return (
              <button key={s.session_id} onClick={() => onOpen(s.session_id)} className="w-full text-left">
                <Panel className="flex items-center justify-between p-5 transition-all hover:border-teal-accent/30">
                  <div>
                    <div className="font-semibold text-slate-200">
                      {s.company} — {s.job_title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>
                        {fmtDate(s.created_at)} at {fmtTime(s.created_at)}
                      </span>
                      <Badge tone={badge.tone}>
                        <badge.icon className="h-3 w-3" /> {badge.label}
                      </Badge>
                      {s.is_demo && <Badge tone="amber">Demo</Badge>}
                      <span>· {formatTime(s.active_seconds)} active</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {s.overall_score !== null ? (
                      <>
                        <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>
                          {s.overall_score}
                          <span className="text-sm text-slate-500">/100</span>
                        </div>
                        <div className="text-xs text-slate-500">score</div>
                      </>
                    ) : (
                      <Badge tone="slate">Legacy</Badge>
                    )}
                  </div>
                </Panel>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Detail (read-only) ───────────────────────────────────────────────────────
export function PersistentSessionViewer({
  sessionId,
  picker,
  userAvatarId,
  onWalkthrough,
  onBack,
  onRestart,
}: {
  sessionId: string;
  picker: ReactNode;
  userAvatarId: number;
  onWalkthrough: () => void;
  onBack: () => void;
  onRestart: () => void;
}) {
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .historyDetail(sessionId)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [sessionId]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="mt-4 text-slate-300">{error}</p>
        <Button className="mt-6" onClick={onBack}>
          Back to history
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 text-teal-accent" />
          <span className="font-bold">BranchPoint · Saved Session</span>
        </div>
        <div className="flex gap-2">
          {picker}
          <Button variant="subtle" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Past sessions
          </Button>
          <Button variant="ghost" onClick={onWalkthrough} title="Hear a spoken, question-by-question walkthrough">
            <Headphones className="h-4 w-4" /> Walk me through it
          </Button>
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={onRestart}>
            <RefreshCw className="h-4 w-4" /> New simulation
          </Button>
        </div>
      </header>

      <div className="mt-6">
        <h1 className="text-xl font-bold">
          {detail.company} — {detail.job_title}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          {fmtDate(detail.created_at)} at {fmtTime(detail.created_at)} ·{" "}
          {detail.scenario_title}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Read-only historical record — no AI was re-run to show this.
        </p>
      </div>

      {/* Full weighted report with radar, reused from the live results view */}
      <ReportBody report={detail.report} />

      {/* Saved spoken walkthrough, if the user went through it */}
      {detail.walkthrough?.viewed && (
        <>
          <h2 className="mt-8 text-lg font-bold">Results walkthrough</h2>
          <p className="mt-1 text-xs text-slate-500">
            What the interviewer said when walking you through these results. Press Play to hear any part again.
          </p>
          <div className="mt-3">
            <SavedWalkthrough walkthrough={detail.walkthrough} userAvatarId={userAvatarId} />
          </div>
        </>
      )}

      {/* Conversation transcript */}
      <h2 className="mt-8 text-lg font-bold">Conversation</h2>
      <Panel className="print-light mt-3 p-5">
        <div className="space-y-3">
          {detail.conversation.map((b, i) => {
            const isCandidate =
              b.role === "candidate" || b.role === "clarification_q";
            return (
              <div key={i} className={`flex ${isCandidate ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isCandidate
                      ? "rounded-br-sm bg-teal-accent/90 text-navy-900"
                      : "rounded-tl-sm border border-white/10 bg-navy-700/70 text-slate-100"
                  }`}
                >
                  {b.role === "clarification_q" && (
                    <span className="font-semibold text-amber-200">Clarifying: </span>
                  )}
                  {b.role === "clarification_a" && (
                    <span className="mr-1 text-xs italic text-slate-400">(answer)</span>
                  )}
                  {b.text}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
