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
import { NUM_AVATARS } from "./components/PersonAvatars";

type View = "landing" | "setup" | "interview" | "review" | "history" | "pastSession";

const AVATAR_KEY = "branchpoint-avatar";

function getSavedAvatar(): number {
  try {
    const v = localStorage.getItem(AVATAR_KEY);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (n >= 0 && n < NUM_AVATARS) return n;
    }
  } catch { /* storage unavailable */ }
  return 1; // default user avatar
}

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const { themeId, selectTheme, themes } = useTheme();
  const { sessions, saveSession, updateReview } = useSessionHistory();
  const [viewingSession, setViewingSession] = useState<SavedSession | null>(null);
  const [userAvatarId, setUserAvatarId] = useState<number>(getSavedAvatar);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const handleAvatarSelect = useCallback((id: number) => {
    setUserAvatarId(id);
    try { localStorage.setItem(AVATAR_KEY, String(id)); } catch { /* storage unavailable */ }
  }, []);

  const picker = (
    <ThemePicker
      themeId={themeId}
      themes={themes}
      onSelect={selectTheme}
      userAvatarId={userAvatarId}
      onAvatarSelect={handleAvatarSelect}
    />
  );

  const handleComplete = useCallback(
    (id: string, bubbles: SavedSession["bubbles"], state: SimulationState) => {
      setSessionId(id);
      if (state.completion_status === "completed" && state.report_ready) {
        const saved: SavedSession = {
          id, company: state.company, job_title: state.job_title,
          completedAt: Date.now(), score: 0, total: state.total_rounds,
          status: state.completion_status, bubbles, review: null,
        };
        saveSession(saved);
        api.report(id).then((report) => {
          const score = Math.round((report.overall_score / report.max_score) * state.total_rounds);
          const existing = sessions.find((s) => s.id === id);
          if (existing) saveSession({ ...existing, score });
        }).catch(() => {});
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
        <Landing onStart={() => setView("setup")} health={health} picker={picker}
          onViewHistory={() => setView("history")} />
      )}
      {view === "setup" && (
        <Setup health={health} onBack={() => setView("landing")} picker={picker}
          onCreated={(id) => { setSessionId(id); setView("interview"); }} />
      )}
      {view === "interview" && sessionId && (
        <Interview sessionId={sessionId} userAvatarId={userAvatarId}
          onComplete={(id, bubbles, state) => handleComplete(id, bubbles, state)} picker={picker} />
      )}
      {view === "review" && sessionId && (
        <ReviewView sessionId={sessionId} picker={picker}
          onRestart={() => { setSessionId(null); setView("setup"); }}
          onViewHistory={() => setView("history")} />
      )}
      {view === "history" && (
        <SessionHistoryList sessions={sessions} picker={picker}
          onBack={() => setView(sessionId ? "review" : "landing")}
          onOpen={(s) => { setViewingSession(s); setView("pastSession"); }} />
      )}
      {view === "pastSession" && viewingSession && (
        <SessionViewer session={viewingSession} picker={picker}
          onBack={() => setView("history")}
          onRestart={() => { setSessionId(null); setView("setup"); }} />
      )}
    </div>
  );
}
