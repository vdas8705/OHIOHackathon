import { useCallback, useEffect, useState } from "react";
import Landing from "./views/Landing";
import Setup from "./views/Setup";
import Interview from "./views/Interview";
import ReviewView from "./views/ReviewView";
import { SessionHistoryList, SessionViewer } from "./views/SessionHistory";
import { api } from "./api";
import type { HealthInfo, SavedSession, SessionReview, SimulationState } from "./types";
import { useTheme } from "./useTheme";
import { ThemePicker } from "./components/ThemePicker";
import { useSessionHistory } from "./useSessionHistory";

type View = "landing" | "setup" | "interview" | "review" | "history" | "pastSession";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const { themeId, selectTheme, themes } = useTheme();
  const { sessions, saveSession, updateReview } = useSessionHistory();
  const [viewingSession, setViewingSession] = useState<SavedSession | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const picker = (
    <ThemePicker themeId={themeId} themes={themes} onSelect={selectTheme} />
  );

  // Called by Interview when the session completes (all 5 rounds or ended early)
  const handleComplete = useCallback(
    (id: string, bubbles: SavedSession["bubbles"], state: SimulationState) => {
      setSessionId(id);

      // Only save to history if all 5 rounds were answered (completed)
      if (state.completion_status === "completed" && state.report_ready) {
        const saved: SavedSession = {
          id,
          company: state.company,
          job_title: state.job_title,
          completedAt: Date.now(),
          score: 0,
          total: state.total_rounds,
          status: state.completion_status,
          bubbles,
          review: null,
        };
        saveSession(saved);

        // Fetch the report to get the overall score
        api.report(id).then((report) => {
          const score = Math.round((report.overall_score / report.max_score) * state.total_rounds);
          // Update the saved session with the score
          const existing = sessions.find((s) => s.id === id);
          if (existing) {
            saveSession({ ...existing, score });
          }
        }).catch(() => {});

        // Fetch the review and save it
        api.review(id).then((review: SessionReview) => {
          updateReview(id, review);
        }).catch(() => {});
      }

      setView("review");
    },
    [saveSession, updateReview, sessions]
  );

  return (
    <div className="min-h-screen">
      {view === "landing" && (
        <Landing
          onStart={() => setView("setup")}
          health={health}
          picker={picker}
          onViewHistory={() => setView("history")}
        />
      )}

      {view === "setup" && (
        <Setup
          health={health}
          onBack={() => setView("landing")}
          picker={picker}
          onCreated={(id) => {
            setSessionId(id);
            setView("interview");
          }}
        />
      )}

      {view === "interview" && sessionId && (
        <Interview
          sessionId={sessionId}
          onComplete={(id, bubbles, state) => handleComplete(id, bubbles, state)}
          picker={picker}
        />
      )}

      {view === "review" && sessionId && (
        <ReviewView
          sessionId={sessionId}
          picker={picker}
          onRestart={() => {
            setSessionId(null);
            setView("setup");
          }}
          onViewHistory={() => setView("history")}
        />
      )}

      {view === "history" && (
        <SessionHistoryList
          sessions={sessions}
          picker={picker}
          onBack={() => setView(sessionId ? "review" : "landing")}
          onOpen={(s) => {
            setViewingSession(s);
            setView("pastSession");
          }}
        />
      )}

      {view === "pastSession" && viewingSession && (
        <SessionViewer
          session={viewingSession}
          picker={picker}
          onBack={() => setView("history")}
          onRestart={() => {
            setSessionId(null);
            setView("setup");
          }}
        />
      )}
    </div>
  );
}
