import { useEffect, useState } from "react";
import { ArrowLeft, Sparkles, Loader2, GitBranch, Link2 } from "lucide-react";
import { Button, Panel, Badge } from "../components/ui";
import { api } from "../api";
import type { CreateSimulationInput, HealthInfo } from "../types";
import type { ReactNode } from "react";
import { VoiceStatusNote } from "../components/VoiceControls";
import { useVoiceEngineState, voiceEngine } from "../speech/voiceEngine";
import { loadVoiceSettings } from "../speech/voiceSettings";

interface Props {
  onBack: () => void;
  onCreated: (sessionId: string) => void;
  health: HealthInfo | null;
  picker: ReactNode;
}

const EMPTY: CreateSimulationInput = {
  company: "",
  job_title: "",
  job_description: "",
  company_info: "",
  website_url: "",
};

export default function Setup({ onBack, onCreated, health, picker }: Props) {
  const [form, setForm] = useState<CreateSimulationInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [urlFetched, setUrlFetched] = useState(false);
  const [voiceEnabled] = useState(() => loadVoiceSettings().enabled);
  const voiceState = useVoiceEngineState();

  // Download the interviewer voice while the user fills in the form, so it's
  // ready before the first question.
  useEffect(() => {
    if (voiceEnabled) void voiceEngine.preload();
  }, [voiceEnabled]);

  const update =
    (field: keyof CreateSimulationInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      // If the user edits the URL field reset the fetched state
      if (field === "website_url") {
        setUrlFetched(false);
        setFetchError(null);
      }
    };

  async function fetchFromUrl() {
    const url = form.website_url.trim();
    if (!url) {
      setFetchError("Paste a job posting URL first.");
      return;
    }
    setFetchError(null);
    setFetching(true);
    try {
      const result = await api.fetchJob(url);
      setForm((f) => ({
        ...f,
        company: result.company || f.company,
        job_title: result.job_title || f.job_title,
        job_description: result.job_description || f.job_description,
        company_info: result.company_info || f.company_info,
      }));
      setErrors({});
      setUrlFetched(true);
    } catch (e) {
      setFetchError((e as Error).message);
    } finally {
      setFetching(false);
    }
  }

  async function loadDemo() {
    try {
      const sample = await api.demoSample();
      setForm({
        company: sample.company,
        job_title: sample.job_title,
        job_description: sample.job_description,
        company_info: sample.company_info,
        website_url: sample.website_url,
      });
      setErrors({});
      setUrlFetched(false);
      setFetchError(null);
    } catch (e) {
      setServerError((e as Error).message);
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.company.trim()) next.company = "Company name is required.";
    if (!form.job_title.trim()) next.job_title = "Job title is required.";
    if (!form.job_description.trim())
      next.job_description = "A job description is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const state = await api.createSimulation({
        ...form,
        company: form.company.trim(),
        job_title: form.job_title.trim(),
        job_description: form.job_description.trim(),
      });
      onCreated(state.session_id);
    } catch (e) {
      setServerError((e as Error).message);
      setLoading(false);
    }
  }

  const field =
    "w-full rounded-xl border border-white/10 bg-navy-900/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-accent/50 focus:outline-none focus:ring-2 focus:ring-teal-accent/30";

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-accent/10 ring-1 ring-teal-accent/20">
          <Loader2 className="h-8 w-8 animate-spin text-teal-accent" />
        </div>
        <h2 className="mt-6 text-2xl font-bold">
          Preparing your interview scenario…
        </h2>
        <p className="mt-3 text-sm text-slate-400">
          We're analyzing the role and building a realistic, five-round
          situational challenge for{" "}
          <span className="text-slate-200">{form.job_title}</span>.
        </p>
      </div>
    );
  }

  const hasManualData =
    form.company.trim() || form.job_title.trim() || form.job_description.trim();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Button variant="subtle" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {picker}
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-teal-accent" />
            <span className="font-bold">BranchPoint</span>
          </div>
        </div>
      </div>

      <h1 className="text-3xl font-bold">Set up your simulation</h1>
      <p className="mt-2 text-slate-400">
        Paste a job posting link and we'll pull everything automatically — or
        fill in the fields yourself.
      </p>
      <div className="mt-3">
        <VoiceStatusNote engine={voiceState} enabled={voiceEnabled} />
      </div>

      {health?.demo_mode && (
        <div className="mt-4">
          <Badge tone="amber">
            Demo mode — using a built-in scenario (no API key configured)
          </Badge>
        </div>
      )}

      <Panel className="mt-6 p-6">
        <form onSubmit={submit} className="space-y-5">
          {/* ── URL fetch row ─────────────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Job posting URL
            </label>
            <div className="flex gap-2">
              <input
                className={`${field} flex-1`}
                value={form.website_url}
                onChange={update("website_url")}
                placeholder="https://jobs.example.com/software-engineer-12345"
                type="url"
              />
              <Button
                type="button"
                variant="subtle"
                onClick={fetchFromUrl}
                disabled={fetching || health?.demo_mode}
                className="shrink-0 gap-1.5"
              >
                {fetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {fetching ? "Fetching…" : "Fetch"}
              </Button>
            </div>

            {/* status feedback */}
            {fetchError && (
              <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {fetchError}
              </div>
            )}
            {urlFetched && !fetchError && (
              <p className="mt-1.5 text-xs text-teal-accent">
                ✓ Job info loaded — review and edit below if needed.
              </p>
            )}
            {health?.demo_mode && (
              <p className="mt-1.5 text-xs text-slate-500">
                URL fetching requires a live LLM key — unavailable in demo mode.
              </p>
            )}
          </div>

          {/* divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-slate-500">or fill in manually</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* ── Manual fields ─────────────────────────────────────────────── */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Company name <span className="text-teal-accent">*</span>
              </label>
              <input
                className={field}
                value={form.company}
                onChange={update("company")}
                placeholder="e.g. Amazon"
              />
              {errors.company && (
                <p className="mt-1 text-xs text-rose-400">{errors.company}</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Job title <span className="text-teal-accent">*</span>
              </label>
              <input
                className={field}
                value={form.job_title}
                onChange={update("job_title")}
                placeholder="e.g. Cloud Hardware Development Engineer"
              />
              {errors.job_title && (
                <p className="mt-1 text-xs text-rose-400">
                  {errors.job_title}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Full job description <span className="text-teal-accent">*</span>
            </label>
            <textarea
              className={`${field} min-h-[160px] resize-y`}
              value={form.job_description}
              onChange={update("job_description")}
              placeholder="Paste the responsibilities, qualifications, and requirements here…"
            />
            {errors.job_description && (
              <p className="mt-1 text-xs text-rose-400">
                {errors.job_description}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Company information{" "}
              <span className="text-slate-500">(optional)</span>
            </label>
            <textarea
              className={`${field} min-h-[90px] resize-y`}
              value={form.company_info}
              onChange={update("company_info")}
              placeholder="Mission, values, technical priorities, or context that shapes tone…"
            />
          </div>

          {serverError && (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {serverError}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={loadDemo}
              className="text-slate-400"
            >
              <Sparkles className="h-4 w-4" /> Fill with sample role
            </Button>
            <Button
              type="submit"
              className="px-7"
              disabled={!hasManualData && !urlFetched}
            >
              Generate scenario & begin
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
