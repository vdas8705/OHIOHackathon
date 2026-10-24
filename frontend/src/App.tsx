import { useEffect, useState } from "react";
import Landing from "./views/Landing";
import Setup from "./views/Setup";
import Interview from "./views/Interview";
import Results from "./views/Results";
import { api } from "./api";
import type { HealthInfo } from "./types";

type View = "landing" | "setup" | "interview" | "results";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen">
      {view === "landing" && (
        <Landing onStart={() => setView("setup")} health={health} />
      )}

      {view === "setup" && (
        <Setup
          health={health}
          onBack={() => setView("landing")}
          onCreated={(id) => {
            setSessionId(id);
            setView("interview");
          }}
        />
      )}

      {view === "interview" && sessionId && (
        <Interview
          sessionId={sessionId}
          onComplete={() => setView("results")}
        />
      )}

      {view === "results" && sessionId && (
        <Results
          sessionId={sessionId}
          onRestart={() => {
            setSessionId(null);
            setView("setup");
          }}
        />
      )}
    </div>
  );
}
