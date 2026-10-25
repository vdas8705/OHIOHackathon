import { useCallback, useEffect, useRef, useState } from "react";
import {
  GitBranch,
  Send,
  StopCircle,
  HelpCircle,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Loader2,
  AlertTriangle,
  Bot,
  User,
} from "lucide-react";
import { Button, Panel, Badge, formatTime } from "../components/ui";
import {
  StatusPills,
  MicButton,
  ToggleIconButton,
} from "../components/VoiceControls";
import { api } from "../api";
import { useInterviewerVoice, useSpeechRecognition } from "../speech/useSpeech";
import type { SimulationState } from "../types";

interface Props {
  sessionId: string;
  onComplete: (
    sessionId: string,
    bubbles: { id: string; role: string; text: string; round: number }[],
    state: SimulationState
  ) => void;
  picker: React.ReactNode;
}

interface Bubble {
  id: string;
  role: "interviewer" | "candidate" | "clarify_q" | "clarify_a";
  text: string;
  round: number;
}

export default function Interview({ sessionId, onComplete, picker }: Props) {
  const [state, setState] = useState<SimulationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // Voice / mic
  const [interviewerMuted, setInterviewerMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const { speak, stop: stopSpeaking, speaking } = useInterviewerVoice(
    interviewerMuted
  );
  const rec = useSpeechRecognition();

  // Response composition
  const [answer, setAnswer] = useState("");
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(90);
  const roundActiveSecondsRef = useRef(0); // active seconds spent this round

  // Clarification
  const [clarifyMode, setClarifyMode] = useState(false);
  const [clarifyText, setClarifyText] = useState("");

  // Conversation transcript (UI bubbles)
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const spokenRoundRef = useRef<number>(0); // last round we auto-spoke

  // ---- load initial state ----
  useEffect(() => {
    let cancelled = false;
    api
      .getState(sessionId)
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setRemaining(s.response_seconds_per_round);
      })
      .catch((e) => setLoadError((e as Error).message));
    return () => {
      cancelled = true;
      stopSpeaking();
      rec.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ---- when a new round turn arrives, add bubble + speak it, then start timer ----
  useEffect(() => {
    if (!state || !state.current_turn) return;
    if (state.completion_status !== "in_progress") return;
    const turn = state.current_turn;
    if (spokenRoundRef.current === turn.round_number) return; // already handled
    spokenRoundRef.current = turn.round_number;

    const text = `${turn.development} ${turn.question}`.trim();
    setBubbles((b) => [
      ...b,
      {
        id: `int-${turn.round_number}`,
        role: "interviewer",
        text,
        round: turn.round_number,
      },
    ]);
    setAnswer("");
    roundActiveSecondsRef.current = 0;
    setRemaining(state.response_seconds_per_round);
    setTimerActive(false);

    // Speak, then begin the response timer only after playback completes.
    speak(text, () => {
      setTimerActive(true);
      // Auto-activate mic when supported and not muted.
      if (rec.supported && !micMuted) {
        startListening();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.current_turn?.round_number, state?.completion_status]);

  // ---- auto-scroll transcript ----
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [bubbles, rec.interim]);

  // ---- response countdown ----
  useEffect(() => {
    if (!timerActive || processing) return;
    if (remaining <= 0) {
      handleSubmit(true);
      return;
    }
    const id = setTimeout(() => {
      setRemaining((r) => r - 1);
      roundActiveSecondsRef.current += 1;
    }, 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerActive, remaining, processing]);

  // ---- global completion check ----
  useEffect(() => {
    if (state && state.completion_status !== "in_progress" && state.report_ready) {
      stopSpeaking();
      rec.abort();
      // Pass bubbles + final state to parent for session history
      const savedBubbles = bubbles.map((b) => ({
        id: b.id,
        role: b.role,
        text: b.text,
        round: b.round,
      }));
      onComplete(sessionId, savedBubbles, state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.completion_status, state?.report_ready]);

  const startListening = useCallback(() => {
    if (!rec.supported || micMuted) return;
    rec.start((full) => setAnswer(full), answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, micMuted, answer]);

  function toggleMic() {
    if (rec.listening) {
      rec.stop();
    } else {
      startListening();
    }
  }

  function toggleMicMute() {
    const next = !micMuted;
    setMicMuted(next);
    if (next && rec.listening) rec.stop();
  }

  function toggleInterviewerMute() {
    const next = !interviewerMuted;
    setInterviewerMuted(next);
    if (next) stopSpeaking();
  }

  async function handleSubmit(timedOut = false) {
    if (!state || processing) return;
    if (state.completion_status !== "in_progress") return;
    rec.stop();
    setTimerActive(false);
    setProcessing(true);

    const round = state.current_round;
    const text = answer.trim();

    setBubbles((b) => [
      ...b,
      {
        id: `cand-${round}`,
        role: "candidate",
        text: text || (timedOut ? "(No answer — time expired)" : "(No answer)"),
        round,
      },
    ]);

    try {
      const next = await api.respond(sessionId, {
        round_number: round,
        response: text,
        timed_out: timedOut,
        elapsed_active_seconds: Math.min(
          roundActiveSecondsRef.current,
          state.response_seconds_per_round
        ),
      });
      setState(next);
      setAnswer("");
    } catch (e) {
      // Conflict / network: keep the round, surface the error, let them retry.
      setLoadError((e as Error).message);
      setTimerActive(true);
    } finally {
      setProcessing(false);
    }
  }

  async function submitClarification() {
    if (!state || !clarifyText.trim() || processing) return;
    const round = state.current_round;
    const q = clarifyText.trim();
    setClarifyText("");
    setBubbles((b) => [
      ...b,
      { id: `cq-${Date.now()}`, role: "clarify_q", text: q, round },
    ]);
    // Pause the timer while clarifying (it resumes from where it left off).
    const wasActive = timerActive;
    setTimerActive(false);
    setProcessing(true);
    rec.stop();
    try {
      const res = await api.clarify(sessionId, round, q);
      setBubbles((b) => [
        ...b,
        { id: `ca-${Date.now()}`, role: "clarify_a", text: res.answer, round },
      ]);
      setState((s) =>
        s
          ? { ...s, clarifications_used_this_round: res.clarifications_used_this_round }
          : s
      );
      // Speak the clarification answer, then resume the timer.
      speak(res.answer, () => {
        if (wasActive) setTimerActive(true);
      });
    } catch (e) {
      setLoadError((e as Error).message);
      if (wasActive) setTimerActive(true);
    } finally {
      setProcessing(false);
      setClarifyMode(false);
    }
  }

  async function endEarly() {
    if (!state) return;
    stopSpeaking();
    rec.abort();
    setProcessing(true);
    try {
      const next = await api.finish(sessionId);
      setState(next);
      const savedBubbles = bubbles.map((b) => ({
        id: b.id,
        role: b.role,
        text: b.text,
        round: b.round,
      }));
      onComplete(sessionId, savedBubbles, next);
    } catch (e) {
      setLoadError((e as Error).message);
      setProcessing(false);
    }
  }

  function replayQuestion() {
    const turn = state?.current_turn;
    if (!turn) return;
    rec.stop();
    const text = `${turn.development} ${turn.question}`.trim();
    speak(text, () => {
      if (rec.supported && !micMuted) startListening();
    });
  }

  if (loadError && !state) {
    return (
      <ErrorScreen message={loadError} />
    );
  }
  if (!state) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-accent" />
      </div>
    );
  }

  const timerPct = (remaining / state.response_seconds_per_round) * 100;
  const timerTone =
    remaining <= 15 ? "text-rose-400" : remaining <= 30 ? "text-amber-300" : "text-teal-soft";
  const clarifyLeft =
    state.max_clarifications_per_round - state.clarifications_used_this_round;
  const micDenied = Boolean(rec.error && /denied|not-allowed/i.test(rec.error));

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 text-teal-accent" />
          <div>
            <div className="text-sm font-bold leading-none">{state.company}</div>
            <div className="text-xs text-slate-400">{state.job_title}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {picker}
          {state.is_demo && <Badge tone="amber">Demo mode</Badge>}
          <Badge tone="slate">
            Round {state.current_round} of {state.total_rounds}
          </Badge>
          <Badge tone="slate">
            Active {formatTime(state.elapsed_active_seconds)} /{" "}
            {formatTime(state.max_active_seconds)}
          </Badge>
        </div>
      </header>

      {/* Round progress */}
      <div className="mt-4 flex gap-1.5">
        {Array.from({ length: state.total_rounds }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i + 1 < state.current_round
                ? "bg-teal-accent"
                : i + 1 === state.current_round
                ? "bg-teal-accent/50"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>

      {/* Transcript */}
      <Panel className="mt-5 flex-1 overflow-hidden">
        <div
          ref={transcriptRef}
          className="scroll-slim h-[42vh] space-y-2 overflow-y-auto p-5 sm:h-[46vh]"
        >
          {bubbles.map((b, i) => {
            const prev = bubbles[i - 1];
            const sameGroup = (r: Bubble["role"]) =>
              r === "interviewer" || r === "clarify_a";
            const showAvatar =
              !prev ||
              (sameGroup(b.role) ? !sameGroup(prev.role) : sameGroup(prev.role) || prev.role !== b.role);
            return <ChatBubble key={b.id} bubble={b} showAvatar={showAvatar} />;
          })}
          {rec.interim && (
            <div className="flex items-end justify-end gap-2.5">
              <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-dashed border-teal-accent/30 bg-teal-accent/5 px-4 py-2.5 text-sm italic text-slate-400">
                {rec.interim}
              </div>
              {/* spacer to keep alignment consistent with avatar width */}
              <div className="w-9 shrink-0" />
            </div>
          )}
        </div>
      </Panel>

      {/* Status + timer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <StatusPills
          speaking={speaking}
          listening={rec.listening}
          processing={processing}
          micSupported={rec.supported}
          micDenied={micDenied}
        />
        <div className="flex items-center gap-3">
          <div className={`text-right ${timerTone}`}>
            <div className="text-xs font-medium text-slate-400">Response time</div>
            <div className="text-2xl font-bold tabular-nums">
              {formatTime(remaining)}
            </div>
          </div>
          <div className="relative h-12 w-12">
            <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray={`${(timerPct / 100) * 100.5} 100.5`}
                strokeLinecap="round"
                className={timerTone}
              />
            </svg>
          </div>
        </div>
      </div>

      {(rec.error || loadError) && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {loadError ?? rec.error}
            {micDenied && " You can still type your answer below."}
          </span>
        </div>
      )}

      {/* Composer */}
      <Panel className="mt-4 p-4">
        {clarifyMode ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">
                Ask a clarifying question
              </span>
              <Badge tone={clarifyLeft > 0 ? "teal" : "rose"}>
                {clarifyLeft} of {state.max_clarifications_per_round} left
              </Badge>
            </div>
            <textarea
              value={clarifyText}
              onChange={(e) => setClarifyText(e.target.value)}
              placeholder="e.g. What were the ambient conditions during the test?"
              className="min-h-[70px] w-full resize-y rounded-xl border border-white/10 bg-navy-900/60 px-4 py-3 text-sm focus:border-teal-accent/50 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="subtle" onClick={() => setClarifyMode(false)}>
                Cancel
              </Button>
              <Button
                onClick={submitClarification}
                disabled={!clarifyText.trim() || clarifyLeft <= 0 || processing}
              >
                Ask
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <MicButton
                listening={rec.listening}
                disabled={!rec.supported || micMuted || speaking || processing}
                onClick={toggleMic}
              />
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={
                  rec.supported
                    ? "Speak your answer, or type it here…"
                    : "Type your answer here…"
                }
                className="min-h-[70px] flex-1 resize-y rounded-xl border border-white/10 bg-navy-900/60 px-4 py-3 text-sm focus:border-teal-accent/50 focus:outline-none"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ToggleIconButton
                  active={!interviewerMuted}
                  onClick={toggleInterviewerMute}
                  onIcon={<Volume2 className="h-4 w-4" />}
                  offIcon={<VolumeX className="h-4 w-4" />}
                  title={
                    interviewerMuted
                      ? "Unmute interviewer"
                      : "Mute interviewer"
                  }
                />
                <ToggleIconButton
                  active={!micMuted}
                  onClick={toggleMicMute}
                  onIcon={<Mic className="h-4 w-4" />}
                  offIcon={<MicOff className="h-4 w-4" />}
                  title={micMuted ? "Enable microphone" : "Disable microphone"}
                />
                <Button
                  variant="ghost"
                  onClick={replayQuestion}
                  disabled={speaking || processing}
                  title="Replay the question"
                >
                  <Volume2 className="h-4 w-4" /> Replay
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setClarifyMode(true)}
                  disabled={processing || clarifyLeft <= 0}
                  title="Ask a clarifying question"
                >
                  <HelpCircle className="h-4 w-4" /> Clarify
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  onClick={endEarly}
                  disabled={processing}
                >
                  <StopCircle className="h-4 w-4" /> End
                </Button>
                <Button
                  onClick={() => handleSubmit(false)}
                  disabled={processing || speaking}
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Processing
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Submit response
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

// ── Avatar components ────────────────────────────────────────────────────────

function InterviewerAvatar({ visible }: { visible: boolean }) {
  return (
    <div className="shrink-0 w-9 h-9" aria-label={visible ? "Assistant" : undefined}>
      {visible && (
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            background: "var(--avatar-ai-bg)",
            boxShadow: "0 0 0 2px var(--avatar-ai-ring)",
          }}
        >
          <Bot className="h-4.5 w-4.5" aria-hidden="true"
            style={{ width: 18, height: 18, color: "var(--avatar-ai-icon)" }} />
        </div>
      )}
    </div>
  );
}

function UserAvatar({ visible }: { visible: boolean }) {
  return (
    <div className="shrink-0 w-9 h-9" aria-label={visible ? "You" : undefined}>
      {visible && (
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            background: "var(--avatar-user-bg)",
            boxShadow: "0 0 0 2px var(--avatar-user-ring)",
          }}
        >
          <User className="h-4.5 w-4.5" aria-hidden="true"
            style={{ width: 18, height: 18, color: "var(--avatar-user-icon)" }} />
        </div>
      )}
    </div>
  );
}

// ── ChatBubble ────────────────────────────────────────────────────────────────

function ChatBubble({ bubble, showAvatar }: { bubble: Bubble; showAvatar: boolean }) {
  if (bubble.role === "interviewer") {
    return (
      <div className="flex animate-fadeInUp items-start gap-2.5">
        <InterviewerAvatar visible={showAvatar} />
        <div className="max-w-[78%]">
          {showAvatar && (
            <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--avatar-ai-icon)" }}>
              Interviewer
            </div>
          )}
          <div
            className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm border"
            style={{
              background: "var(--bg-bubble-ai)",
              color: "var(--text-bubble-ai)",
              borderColor: "var(--bg-bubble-border-ai)",
            }}
          >
            {bubble.text}
          </div>
        </div>
      </div>
    );
  }

  if (bubble.role === "candidate") {
    return (
      <div className="flex animate-fadeInUp items-start justify-end gap-2.5">
        <div className="max-w-[78%]">
          {showAvatar && (
            <div className="mb-1.5 text-right text-xs font-semibold" style={{ color: "var(--avatar-user-icon)" }}>
              You
            </div>
          )}
          <div
            className="rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed shadow-sm"
            style={{
              background: "var(--bg-bubble-user)",
              color: "var(--text-bubble-user)",
            }}
          >
            {bubble.text}
          </div>
        </div>
        <UserAvatar visible={showAvatar} />
      </div>
    );
  }

  if (bubble.role === "clarify_q") {
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[75%]">
          {showAvatar && (
            <div className="mb-1.5 text-right text-xs font-semibold text-amber-400">
              You · clarifying
            </div>
          )}
          <div className="rounded-2xl rounded-br-sm border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100 shadow-sm">
            {bubble.text}
          </div>
        </div>
        <UserAvatar visible={showAvatar} />
      </div>
    );
  }

  // clarify_a
  return (
    <div className="flex items-start gap-2.5">
      <InterviewerAvatar visible={showAvatar} />
      <div className="max-w-[75%]">
        {showAvatar && (
          <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--avatar-ai-icon)" }}>
            Interviewer · clarifying
          </div>
        )}
        <div
          className="rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm italic shadow-sm"
          style={{
            background: "var(--bg-bubble-ai)",
            color: "var(--text-bubble-ai)",
            borderColor: "var(--bg-bubble-border-ai)",
            opacity: 0.85,
          }}
        >
          {bubble.text}
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-rose-400" />
      <h2 className="mt-4 text-xl font-bold">Something went wrong</h2>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}
