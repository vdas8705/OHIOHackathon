import type { ReactNode } from "react";
import { ArrowLeft, History, MessageSquare } from "lucide-react";
import { Button, Panel } from "../components/ui";
import type { SavedSession } from "../types";

interface ListProps {
  sessions: SavedSession[];
  picker: ReactNode;
  onBack: () => void;
  onOpen: (session: SavedSession) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SessionHistoryList({ sessions, picker, onBack, onOpen }: ListProps) {
  // Sort newest first
  const sorted = [...sessions].sort((a, b) => b.completedAt - a.completedAt);

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
        Your sessions are saved until you close this tab.
      </p>

      {sorted.length === 0 ? (
        <Panel className="mt-6 p-8 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-slate-500" />
          <p className="mt-4 text-sm text-slate-400">
            No completed sessions yet. Finish a full interview (all five rounds)
            to see it here.
          </p>
        </Panel>
      ) : (
        <div className="mt-5 space-y-3">
          {sorted.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onOpen(s)}
              className="w-full text-left"
            >
              <Panel className="flex items-center justify-between p-5 transition-all hover:border-teal-accent/30">
                <div className="flex items-center gap-4">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: "var(--badge-bg)",
                      color: "var(--accent)",
                    }}
                  >
                    {sorted.length - i}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-200">
                      {s.company} — {s.job_title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(s.completedAt)} at {formatTime(s.completedAt)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-lg font-bold"
                    style={{ color: "var(--accent)" }}
                  >
                    {s.score}/{s.total}
                  </div>
                  <div className="text-xs text-slate-500">score</div>
                </div>
              </Panel>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Read-only session viewer ──────────────────────────────────────────────────

interface ViewerProps {
  session: SavedSession;
  picker: ReactNode;
  onBack: () => void;
  onRestart: () => void;
}

export function SessionViewer({ session, picker, onBack, onRestart }: ViewerProps) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <Button variant="subtle" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Past Sessions
        </Button>
        <div className="flex items-center gap-2">
          {picker}
          <Button onClick={onRestart}>
            New session
          </Button>
        </div>
      </header>

      <div className="mt-6">
        <h1 className="text-xl font-bold">{session.company} — {session.job_title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {formatDate(session.completedAt)} at {formatTime(session.completedAt)} · Score: {session.score}/{session.total}
        </p>
      </div>

      {/* Read-only transcript */}
      <Panel className="mt-5 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Conversation
        </h2>
        <div className="space-y-3">
          {session.bubbles.map((b) => {
            const isCandidate = b.role === "candidate" || b.role === "clarify_q";
            return (
              <div
                key={b.id}
                className={`flex ${isCandidate ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={
                    isCandidate
                      ? {
                          background: "var(--bg-bubble-user)",
                          color: "var(--text-bubble-user)",
                        }
                      : {
                          background: "var(--bg-bubble-ai)",
                          color: "var(--text-bubble-ai)",
                          border: "1px solid var(--bg-bubble-border-ai)",
                        }
                  }
                >
                  {b.role === "clarify_q" && (
                    <span className="font-semibold text-amber-200">Clarifying: </span>
                  )}
                  {b.role === "clarify_a" && (
                    <span className="italic text-slate-400">{b.text}</span>
                  )}
                  {b.text}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Review if available */}
      {session.review && (
        <div className="mt-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Review
          </h2>
          <Panel className="p-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Score
            </div>
            <div className="mt-2 text-4xl font-extrabold" style={{ color: "var(--accent)" }}>
              {session.review.score} / {session.review.total}
            </div>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-300">
              {session.review.summary}
            </p>
          </Panel>

          {session.review.tips.length > 0 && (
            <Panel className="mt-3 p-5">
              <h3 className="text-sm font-semibold text-slate-200">Tips</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                {session.review.tips.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: "var(--accent)" }}>•</span>
                    {t}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
