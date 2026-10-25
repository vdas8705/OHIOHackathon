import { useEffect, useState } from "react";
import { Flag, GitBranch, Loader2, Sparkles } from "lucide-react";
import { api } from "../api";
import { ResultMarker } from "../views/Walkthrough";
import type { DecisionMap as DecisionMapData, EnvironmentState } from "../types";

const METERS: { key: keyof EnvironmentState; label: string; lowerIsBetter?: boolean }[] = [
  { key: "technical_stability", label: "Stability" },
  { key: "risk_level", label: "Risk", lowerIsBetter: true },
  { key: "stakeholder_confidence", label: "Confidence" },
  { key: "progress", label: "Progress" },
];

function ScenarioMeters({ env }: { env: EnvironmentState }) {
  return (
    <dl className="dm-meters" aria-label="Scenario after this round">
      {METERS.map((m) => {
        const v = Math.max(0, Math.min(100, Math.round(env[m.key])));
        return (
          <div key={m.key} className="dm-meter">
            <dt>{m.label}</dt>
            <dd>
              <span className="dm-meter__bar" aria-hidden="true">
                <span className={m.lowerIsBetter ? "is-risk" : ""} style={{ width: `${v}%` }} />
              </span>
              <span className="dm-meter__value">{v}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * "What if" decision map: the path the candidate took through the scenario,
 * next to the branch a different answer would have opened. Built from the
 * saved report on the backend, so it matches the results above it.
 */
export default function DecisionMap({ sessionId }: { sessionId: string }) {
  const [map, setMap] = useState<DecisionMapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [showWhatIf, setShowWhatIf] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    setFailed(false);
    api
      .decisionMap(sessionId)
      .then((m) => !cancelled && setMap(m))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (failed) {
    return (
      <p className="mt-8 text-sm text-slate-400">
        The decision map couldn't be drawn right now. Your results above are unaffected.
      </p>
    );
  }

  return (
    <section className="mt-8" aria-labelledby="decision-map-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="decision-map-title" className="flex items-center gap-2 text-lg font-bold">
          <GitBranch className="h-5 w-5" aria-hidden="true" /> What if? Your decision map
        </h2>
        {map && map.rounds.length > 0 && (
          <button
            className="dm-toggle comic-font"
            aria-pressed={showWhatIf}
            onClick={() => setShowWhatIf((v) => !v)}
          >
            {showWhatIf ? "Hide what-ifs" : "Show what-ifs"}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Solid panels show the path you took. Dashed panels show where a different answer would have
        taken the scenario.
      </p>

      {!map ? (
        <div className="comic-panel comic-font mt-3 flex items-center gap-3 p-5" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Drawing your decision map…
        </div>
      ) : (
        <DecisionMapView map={map} showWhatIf={showWhatIf} />
      )}
    </section>
  );
}

/** Pure view of the map (no data loading). */
export function DecisionMapView({ map, showWhatIf }: { map: DecisionMapData; showWhatIf: boolean }) {
  return (
        <div className="comic-panel comic-font mt-3 p-3 sm:p-5">
          <ol className="dm-list">
            {map.rounds.map((r) => (
              <li key={r.round_number} className="dm-row">
                <span className="dm-node" aria-hidden="true">
                  {r.round_number}
                </span>
                <div className={`dm-cards ${showWhatIf ? "has-whatif" : ""}`}>
                  <article className="dm-card dm-card--taken" aria-label={`Round ${r.round_number}, your path`}>
                    <header className="dm-card__head">
                      <span className="font-bold">Round {r.round_number}</span>
                      <ResultMarker correctness={r.correctness} level={r.performance_level} />
                    </header>
                    <p className="dm-card__question">{r.question}</p>
                    <p>
                      <strong>You:</strong> {r.your_choice}
                    </p>
                    <p className="mt-1">
                      <strong>What happened:</strong> {r.what_happened}
                    </p>
                    {r.environment_after && <ScenarioMeters env={r.environment_after} />}
                  </article>
                  {showWhatIf && (
                    <article className="dm-card dm-card--whatif" aria-label={`Round ${r.round_number}, what if`}>
                      <header className="dm-card__head">
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <GitBranch className="h-4 w-4" aria-hidden="true" /> What if… {r.what_if.label.toLowerCase()}
                        </span>
                      </header>
                      <p>{r.what_if.approach}</p>
                      <p className="mt-1">
                        <strong>That leads to:</strong> {r.what_if.outcome}
                      </p>
                    </article>
                  )}
                </div>
              </li>
            ))}
            <li className="dm-row dm-row--end">
              <span className="dm-node dm-node--end" aria-hidden="true">
                <Flag className="h-4 w-4" />
              </span>
              <div className={`dm-cards ${showWhatIf ? "has-whatif" : ""}`}>
                <article className="dm-card dm-card--taken">
                  <header className="dm-card__head font-bold">Your ending</header>
                  <p>{map.your_ending}</p>
                </article>
                {showWhatIf && (
                  <article className="dm-card dm-card--whatif">
                    <header className="dm-card__head">
                      <span className="inline-flex items-center gap-1.5 font-bold">
                        <Sparkles className="h-4 w-4" aria-hidden="true" /> Best-case ending
                      </span>
                    </header>
                    <p>{map.best_ending}</p>
                  </article>
                )}
              </div>
            </li>
          </ol>
        </div>
  );
}
