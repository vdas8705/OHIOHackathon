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
  Trash2,
} from "lucide-react";
import { Button, Panel, Badge, formatTime } from "../components/ui";
import ReportBody from "../components/ReportBody";
import { api } from "../api";
import type { HistoryDetail, HistorySummary, SessionOrigin } from "../types";
import { SavedWalkthrough } from "./Walkthrough";
import DecisionMap from "../components/DecisionMap";

const ORIGIN_BADGE: Record<
  SessionOrigin,
  { label: string; tone: "teal" | "amber" | "rose" | "slate" }
> = {
  user_demo: { label: "Demo", tone: "amber" },
  user_live: { label: "Live AI", tone: "teal" },
  test_fixture: { label: "Test fixture", tone: "rose" },
  unknown: { label: "Origin unknown", tone: "slate" },
};

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
  const [confirm, setConfirm] = useState<null | { kind: "all" } | { kind: "one"; id: string; label: string }>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .historyList()
      .then(setSessions)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(load, []);

  async function doClearAll() {
    setBusy(true);
    try {
      const res = await api.clearHistory(true);
      setNotice(`Deleted ${res.deleted} session${res.deleted === 1 ? "" : "s"}.`);
      setConfirm(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDeleteOne(id: string) {
    setBusy(true);
    try {
      await api.deleteHistorySession(id);
      setNotice("Session deleted.");
      setConfirm(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasSessions = !!sessions && sessions.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <Button variant="subtle" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {picker}
      </header>

      <div className="mt-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5" style={{ color: "var(--accent)" }} />
          <h1 className="text-2xl font-bold">Past Sessions</h1>
        </div>
        {hasSessions && (
          <Button variant="danger" onClick={() => setConfirm({ kind: "all" })}>
            <Trash2 className="h-4 w-4" /> Clear history
          </Button>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Saved on the server and kept across restarts. This is a local
        single-user history — there is no login, so don't treat it as private on
        a shared machine. Synthetic test fixtures are hidden here by default.
      </p>

      {notice && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-teal-accent/30 bg-teal-accent/10 px-4 py-2.5 text-sm text-teal-soft">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      )}
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

      {hasSessions && (
        <div className="mt-5 space-y-3">
          {sessions!.map((s) => {
            const badge = STATUS_BADGE[s.completion_status] ?? STATUS_BADGE.completed;
            const origin = ORIGIN_BADGE[s.origin] ?? ORIGIN_BADGE.unknown;
            const completed = s.completion_status === "completed";
            return (
              <Panel
                key={s.session_id}
                className="flex items-center justify-between p-5 transition-all hover:border-teal-accent/30"
              >
                <button
                  onClick={() => onOpen(s.session_id)}
                  className="flex-1 text-left"
                >
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
                    <Badge tone={origin.tone}>{origin.label}</Badge>
                    <span>
                      · {s.rounds_completed}/5 rounds · {formatTime(s.active_seconds)} active
                    </span>
                  </div>
                </button>
                <div className="ml-4 flex items-center gap-3">
                  <div className="text-right">
                    {completed && s.overall_score !== null ? (
                      <>
                        <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>
                          {s.overall_score}
                          <span className="text-sm text-slate-500">/100</span>
                        </div>
                        <div className="text-xs text-slate-500">score</div>
                      </>
                    ) : s.schema_version < 2 ? (
                      <Badge tone="slate">Legacy</Badge>
                    ) : (
                      <Badge tone="amber">Incomplete</Badge>
                    )}
                  </div>
                  <button
                    title="Delete this session"
                    onClick={() =>
                      setConfirm({
                        kind: "one",
                        id: s.session_id,
                        label: `${s.company} — ${s.job_title}`,
                      })
                    }
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Panel className="max-w-md p-6">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertCircle className="h-5 w-5" />
              <h2 className="text-lg font-bold">
                {confirm.kind === "all"
                  ? "Clear all interview history?"
                  : "Delete this session?"}
              </h2>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              {confirm.kind === "all" ? (
                <>
                  This permanently deletes <strong>all</strong> locally stored
                  interview sessions, including their reports and transcripts.
                  This cannot be undone. It only affects saved history — your
                  scenarios, settings, and API configuration are untouched.
                </>
              ) : (
                <>
                  This permanently deletes the saved session{" "}
                  <strong>{(confirm as any).label}</strong>, including its report
                  and transcript. This cannot be undone.
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="subtle" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirm.kind === "all"
                    ? doClearAll()
                    : doDeleteOne((confirm as any).id)
                }
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                  </>
                ) : confirm.kind === "all" ? (
                  "Delete all"
                ) : (
                  "Delete"
                )}
              </Button>
            </div>
          </Panel>
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
          <span className="font-bold">Simul AI · Saved Session</span>
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

      {/* "What if" decision map (saved with the session) */}
      <DecisionMap sessionId={sessionId} />

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
