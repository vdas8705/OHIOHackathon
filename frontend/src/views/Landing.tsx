import {
  ArrowRight,
  Mic,
  GitBranch,
  BarChart3,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button, Badge } from "../components/ui";
import type { HealthInfo } from "../types";

const STEPS = [
  {
    icon: GitBranch,
    title: "Role-specific scenario",
    body: "Paste a job description and we generate one evolving, realistic situational challenge for that exact role.",
  },
  {
    icon: Mic,
    title: "Voice-first conversation",
    body: "The AI interviewer speaks each development aloud. You answer by voice — or type if you prefer.",
  },
  {
    icon: Clock,
    title: "Five timed rounds",
    body: "Exactly five connected rounds, 90 seconds each. Your decisions shape what happens next.",
  },
  {
    icon: BarChart3,
    title: "Evidence-backed report",
    body: "Get a 100-point breakdown with strengths, gaps, and a round-by-round review of your answers.",
  },
];

export default function Landing({
  onStart,
  health,
}: {
  onStart: () => void;
  health: HealthInfo | null;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Nav */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-accent/15 ring-1 ring-teal-accent/30">
            <GitBranch className="h-5 w-5 text-teal-accent" />
          </div>
          <span className="text-lg font-bold tracking-tight">BranchPoint</span>
        </div>
        {health &&
          (health.demo_mode ? (
            <Badge tone="amber">Demo mode</Badge>
          ) : (
            <Badge tone="teal">
              <ShieldCheck className="h-3.5 w-3.5" /> Live AI · {health.model}
            </Badge>
          ))}
      </header>

      {/* Hero */}
      <section className="mt-20 flex flex-col items-center text-center">
        <Badge tone="slate">AI-powered adaptive interview simulation</Badge>
        <h1 className="mt-6 max-w-3xl text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Experience the interview{" "}
          <span className="text-teal-accent">before it happens.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-300">
          BranchPoint drops you into a realistic, role-specific professional
          scenario. You make decisions out loud, face the consequences, and
          adapt across five rounds — then get a detailed performance report.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Button onClick={onStart} className="px-7 py-3 text-base">
            Start Simulation <ArrowRight className="h-4 w-4" />
          </Button>
          <span className="text-sm text-slate-400">
            Takes about 10 minutes · Voice or text
          </span>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-24">
        <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-slate-400">
          How it works
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="rounded-2xl border border-white/10 bg-navy-800/60 p-6"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-accent/10 ring-1 ring-teal-accent/20">
                  <s.icon className="h-5 w-5 text-teal-accent" />
                </div>
                <span className="text-sm font-bold text-slate-400">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-24 border-t border-white/10 pt-6 text-center text-xs text-slate-500">
        BranchPoint is a practice tool. Reports reflect demonstrated practice
        performance and are not a prediction of hiring outcomes.
      </footer>
    </div>
  );
}
