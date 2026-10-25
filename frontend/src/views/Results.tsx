import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  GitBranch,
  RefreshCw,
  Printer,
  History,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "../components/ui";
import ReportBody from "../components/ReportBody";
import TrendsPanel from "../components/TrendsPanel";
import { api } from "../api";
import type { HistoryTrends, PerformanceReport } from "../types";

export default function Results({
  sessionId,
  onRestart,
  onViewHistory,
  picker,
}: {
  sessionId: string;
  onRestart: () => void;
  onViewHistory?: () => void;
  picker: ReactNode;
}) {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [trends, setTrends] = useState<HistoryTrends | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .report(sessionId)
      .then(setReport)
      .catch((e) => setError((e as Error).message));
    // Trends are best-effort; the session is persisted on finish.
    api.historyTrends().then(setTrends).catch(() => setTrends(null));
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 text-teal-accent" />
          <span className="font-bold">BranchPoint · Performance Report</span>
        </div>
        <div className="flex gap-2">
          {picker}
          {onViewHistory && (
            <Button variant="ghost" onClick={onViewHistory}>
              <History className="h-4 w-4" /> Past sessions
            </Button>
          )}
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={onRestart}>
            <RefreshCw className="h-4 w-4" /> New simulation
          </Button>
        </div>
      </header>

      <ReportBody report={report} />

      {/* Section 7: Historical progress */}
      {trends && <TrendsPanel trends={trends} />}

      <div className="no-print mt-10 flex justify-center">
        <Button onClick={onRestart} className="px-8">
          <RefreshCw className="h-4 w-4" /> Run another simulation
        </Button>
      </div>
    </div>
  );
}
