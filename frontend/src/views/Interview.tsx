import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
  Check,
  MessageSquarePlus,
} from "lucide-react";
import { Button, Panel, Badge, formatTime } from "../components/ui";
import {
  StatusPills,
  MicButton,
  ToggleIconButton,
  VoiceSettingsButton,
  VoiceStatusNote,
} from "../components/VoiceControls";
import type { Expression } from "../components/ComicCharacters";
import { BubbleTail, SpeakerTurn, ThinkingBubble, type Speaker } from "../components/ComicChat";
import { api } from "../api";
import { ResponseTimer } from "../components/ResponseTimer";
import { useInterviewerVoice, useSpeechRecognition } from "../speech/useSpeech";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type KokoroVoiceId,
} from "../speech/voiceSettings";
import type { SimulationState } from "../types";

interface Props {
  sessionId: string;
  userAvatarId: number;
  onComplete: (
    sessionId: string,
    bubbles: { id: string; role: string; text: string; round: number }[],
    state: SimulationState
  ) => void;
  picker: React.ReactNode;
}

const OVERTIME_NOTICE =
  "Time's up, but take the time you need. The longer you go, the more points it'll cost.";

interface Bubble {
  id: string;
  role: "interviewer" | "candidate" | "clarify_q" | "clarify_a" | "interpretation" | "notice";
  text: string;
  round: number;
}

export default function Interview({ sessionId, userAvatarId, onComplete, picker }: Props) {
  const [state, setState] = useState<SimulationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // Answer confirmation flow
  const [interpreting, setInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState("");
  const [clarificationCount, setClarificationCount] = useState(0);
  const [clarifyingMore, setClarifyingMore] = useState(false);
  const [extraText, setExtraText] = useState("");

  // Voice / mic
  const [voiceSettings] = useState(loadVoiceSettings);
  const [interviewerMuted, setInterviewerMuted] = useState(!voiceSettings.enabled);
  const [voiceRate, setVoiceRate] = useState(voiceSettings.rate);
  const [voiceId, setVoiceId] = useState(voiceSettings.voice);
  const [micMuted, setMicMuted] = useState(false);
  const { speak, stop: stopSpeaking, speaking, engine: voiceEngineState } = useInterviewerVoice(
    interviewerMuted,
    voiceRate,
    voiceId
  );
  const rec = useSpeechRecognition();

  // Response composition
  const [answer, setAnswer] = useState("");
  const [timerActive, setTimerActive] = useState(false);
  const [remaining, setRemaining] = useState(90);
  const roundActiveSecondsRef = useRef(0); // active seconds spent this round
  // Overtime: frozen at the first submit; heads-up shown once per section.
  const overtimeAtSubmitRef = useRef(0);
  const overtimeNoticeRoundRef = useRef(0);
  const answerRef = useRef("");
  answerRef.current = answer;

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
    overtimeAtSubmitRef.current = 0;
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
  }, [bubbles, rec.interim, processing, interpreting, interpretation]);

  // ---- response countdown ----
  // Running out of time no longer submits: the timer keeps going into overtime
  // (negative `remaining`) and that section loses points by tier.
  useEffect(() => {
    if (!timerActive || processing) return;
    const id = setTimeout(() => {
      setRemaining((r) => r - 1);
      roundActiveSecondsRef.current += 1;
    }, 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerActive, remaining, processing]);

  // ---- one friendly heads-up when a section goes into overtime ----
  useEffect(() => {
    if (!state || !timerActive || remaining > 0) return;
    const round = state.current_round;
    if (overtimeNoticeRoundRef.current === round) return;
    overtimeNoticeRoundRef.current = round;
    setBubbles((b) => [...b, { id: `ot-${round}`, role: "notice", text: OVERTIME_NOTICE, round }]);
    if (interviewerMuted) return;
    // Pause the mic so the spoken heads-up isn't transcribed into the answer.
    const resumeMic = rec.listening;
    if (resumeMic) rec.stop();
    speak(OVERTIME_NOTICE, () => {
      if (resumeMic && rec.supported && !micMuted) {
        rec.start((full) => setAnswer(full), answerRef.current);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, timerActive]);

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
    saveVoiceSettings({ enabled: !next, rate: voiceRate, voice: voiceId });
    if (next) stopSpeaking();
  }

  function changeVoiceRate(rate: number) {
    setVoiceRate(rate);
    saveVoiceSettings({ enabled: !interviewerMuted, rate, voice: voiceId });
  }

  function changeVoice(voice: KokoroVoiceId) {
    setVoiceId(voice);
    saveVoiceSettings({ enabled: !interviewerMuted, rate: voiceRate, voice });
  }

  async function handleSubmit(timedOut = false) {
    if (!state || processing || interpreting) return;
    if (state.completion_status !== "in_progress") return;
    rec.stop();
    const round = state.current_round;
    const text = answer.trim();

    // The section timer stops at the first submit; confirmation and any
    // follow-up clarification time don't count toward overtime.
    setTimerActive(false);
    overtimeAtSubmitRef.current = Math.max(overtimeAtSubmitRef.current, -remaining, 0);

    // If timed out, skip interpretation and submit directly
    if (timedOut) {
      setBubbles((b) => [
        ...b,
        { id: `cand-${round}`, role: "candidate", text: text || "(No answer — time expired)", round },
      ]);
      await submitForGrading(text, true);
      return;
    }

    // Start the interpretation confirmation flow
    setPendingAnswer(text);
    setClarificationCount(0);
    setInterpretation(null);
    setInterpreting(true);

    try {
      const res = await api.interpret(sessionId, round, text);
      setInterpretation(res.interpretation);
      setBubbles((b) => [
        ...b,
        { id: `cand-${round}`, role: "candidate", text, round },
        { id: `interp-${round}`, role: "interpretation", text: res.interpretation, round },
      ]);
    } catch (e) {
      // Fallback: skip interpretation, go straight to grading
      setBubbles((b) => [
        ...b,
        { id: `cand-${round}`, role: "candidate", text, round },
      ]);
      await submitForGrading(text, false);
      return;
    } finally {
      setInterpreting(false);
    }
  }

  async function confirmAndSubmit() {
    setInterpretation(null);
    await submitForGrading(pendingAnswer, false);
  }

  async function requestClarification() {
    setClarifyingMore(true);
    setExtraText("");
    setInterpretation(null);
  }

  async function submitAnswerClarification() {
    if (!state || !extraText.trim() || interpreting) return;
    const round = state.current_round;
    const combined = (pendingAnswer + " " + extraText.trim()).trim();
    const newCount = clarificationCount + 1;
    setClarificationCount(newCount);
    setPendingAnswer(combined);
    setExtraText("");
    setClarifyingMore(false);
    setInterpreting(true);

    try {
      const res = await api.interpret(sessionId, round, combined);
      setInterpretation(res.interpretation);
      setBubbles((b) => [
        ...b,
        { id: `cand-cl-${round}-${newCount}`, role: "candidate", text: `(Clarification) ${extraText.trim()}`, round },
        { id: `interp-${round}-${newCount}`, role: "interpretation", text: res.interpretation, round },
      ]);
    } catch {
      // If interpret fails on clarification, just submit what we have
      await submitForGrading(combined, false);
      return;
    } finally {
      setInterpreting(false);
    }
  }

  async function submitForGrading(text: string, timedOut: boolean) {
    if (!state) return;
    setTimerActive(false);
    setProcessing(true);
    setInterpretation(null);
    setClarifyingMore(false);

    try {
      const next = await api.respond(sessionId, {
        round_number: state.current_round,
        response: text,
        timed_out: timedOut,
        elapsed_active_seconds: Math.min(
          roundActiveSecondsRef.current,
          state.response_seconds_per_round
        ),
        overtime_seconds: overtimeAtSubmitRef.current,
      });
      setState(next);
      setAnswer("");
    } catch (e) {
      setLoadError((e as Error).message);
      setTimerActive(true);
    } finally {
      setProcessing(false);
      setPendingAnswer("");
      setClarificationCount(0);
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

  const clarifyLeft =
    state.max_clarifications_per_round - state.clarifications_used_this_round;
  const micDenied = Boolean(rec.error && /denied|not-allowed/i.test(rec.error));

  // Comic transcript: group consecutive bubbles by speaker.
  const turns = groupTurns(bubbles);
  const lastAssistantTurn = turns.map((t) => t.speaker).lastIndexOf("assistant");
  const assistantBusy = processing || interpreting;
  const assistantExpression: Expression = assistantBusy ? "thinking" : speaking ? "smiling" : "neutral";
  const thinkingLabel = interpreting ? "Summarizing your answer…" : undefined;
  const confirmPending = Boolean(interpretation && !interpreting && !clarifyingMore);
  const confirmBubbleId = confirmPending
    ? [...bubbles].reverse().find((b) => b.role === "interpretation")?.id
    : undefined;

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
      <div className="comic-panel mt-5 flex-1 overflow-hidden">
        <div
          ref={transcriptRef}
          className="comic-transcript comic-font scroll-slim h-[50vh] space-y-5 overflow-y-auto p-3 sm:h-[56vh] sm:p-5"
        >
          {turns.map((turn, ti) => {
            const isLastTurn = ti === turns.length - 1;
            const isAssistant = turn.speaker === "assistant";
            return (
              <SpeakerTurn
                key={turn.bubbles[0].id}
                speaker={turn.speaker}
                userAvatarId={userAvatarId}
                expression={isAssistant && ti === lastAssistantTurn ? assistantExpression : "neutral"}
                talking={isAssistant && ti === lastAssistantTurn && speaking && !assistantBusy}
              >
                {turn.bubbles.map((b) => (
                  <Fragment key={b.id}>
                    <ChatBubble bubble={b} />
                    {b.id === confirmBubbleId && (
                      <div className="comic-tags">
                        <button className="comic-tag comic-tag--primary" onClick={confirmAndSubmit} disabled={processing}>
                          <Check className="h-4 w-4" /> That's right, submit it
                        </button>
                        {clarificationCount < 2 ? (
                          <button className="comic-tag comic-tag--secondary" onClick={requestClarification} disabled={processing}>
                            <MessageSquarePlus className="h-4 w-4" /> Let me explain more
                          </button>
                        ) : (
                          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                            Max clarifications reached — please submit your answer.
                          </span>
                        )}
                      </div>
                    )}
                  </Fragment>
                ))}
                {isLastTurn && isAssistant && assistantBusy && <ThinkingBubble label={thinkingLabel} />}
              </SpeakerTurn>
            );
          })}
          {assistantBusy && turns[turns.length - 1]?.speaker !== "assistant" && (
            <SpeakerTurn speaker="assistant" userAvatarId={userAvatarId} expression="thinking">
              <ThinkingBubble label={thinkingLabel} />
            </SpeakerTurn>
          )}
          {rec.interim && (
            <SpeakerTurn
              speaker="user"
              userAvatarId={userAvatarId}
              showCharacter={turns[turns.length - 1]?.speaker !== "user"}
            >
              <div className="comic-bubble comic-bubble--draft">
                <BubbleTail side="right" fill="var(--bg-panel)" />
                {rec.interim}
              </div>
            </SpeakerTurn>
          )}
        </div>
      </div>

      {clarifyingMore && !interpreting && (
        <div className="mt-4 rounded-xl border p-4"
          style={{ borderColor: "var(--bg-interpret-border)", background: "var(--bg-interpret)" }}>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--text-interpret)" }}>
            Add more detail to your answer:
          </p>
          <textarea
            value={extraText}
            onChange={(e) => setExtraText(e.target.value)}
            placeholder="Add any clarification or additional details…"
            className="min-h-[60px] w-full resize-y rounded-xl border px-4 py-3 text-sm focus:outline-none"
            style={{
              background: "var(--bg-panel)",
              borderColor: "var(--bg-panel-border)",
              color: "var(--text-primary)",
            }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="subtle" onClick={() => { setClarifyingMore(false); setInterpretation(null); }}>
              Cancel
            </Button>
            <Button onClick={submitAnswerClarification} disabled={!extraText.trim() || interpreting}>
              Update & re-check
            </Button>
          </div>
        </div>
      )}

      {/* Status + timer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPills
            speaking={speaking}
            listening={rec.listening}
            processing={processing}
            micSupported={rec.supported}
            micDenied={micDenied}
          />
          <VoiceStatusNote
            engine={voiceEngineState}
            enabled={!interviewerMuted}
            hint="mute to skip"
          />
        </div>
        <ResponseTimer
          remaining={remaining}
          limit={state.response_seconds_per_round}
          tiers={state.overtime_tiers ?? []}
        />
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
                <VoiceSettingsButton
                  enabled={!interviewerMuted}
                  rate={voiceRate}
                  voice={voiceId}
                  engine={voiceEngineState}
                  onToggleEnabled={toggleInterviewerMute}
                  onRateChange={changeVoiceRate}
                  onVoiceChange={changeVoice}
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
                  disabled={processing || speaking || interpreting || !!interpretation}
                >
                  {processing || interpreting ? (
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

// ── Comic transcript components ──────────────────────────────────────────────

const speakerOf = (role: Bubble["role"]): Speaker =>
  role === "candidate" || role === "clarify_q" ? "user" : "assistant";

function groupTurns(bubbles: Bubble[]): { speaker: Speaker; bubbles: Bubble[] }[] {
  const turns: { speaker: Speaker; bubbles: Bubble[] }[] = [];
  for (const b of bubbles) {
    const speaker = speakerOf(b.role);
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.bubbles.push(b);
    else turns.push({ speaker, bubbles: [b] });
  }
  return turns;
}

const BUBBLE_STYLE: Record<Bubble["role"], { variant: string; fill: string; label?: string }> = {
  interviewer: { variant: "comic-bubble--ai", fill: "var(--bg-bubble-ai)" },
  clarify_a: { variant: "comic-bubble--ai", fill: "var(--bg-bubble-ai)", label: "Clarification" },
  interpretation: { variant: "comic-bubble--interpret", fill: "var(--bg-interpret)", label: "Here's how I understood it" },
  candidate: { variant: "comic-bubble--user", fill: "var(--bg-bubble-user)" },
  notice: { variant: "comic-bubble--ai", fill: "var(--bg-bubble-ai)", label: "Heads-up" },
  clarify_q: { variant: "comic-bubble--plain", fill: "var(--bg-panel)", label: "Clarifying question" },
};

const LONG_MESSAGE_CHARS = 320;

function ChatBubble({ bubble }: { bubble: Bubble }) {
  const style = BUBBLE_STYLE[bubble.role];
  const side = speakerOf(bubble.role) === "assistant" ? "left" : "right";
  const wide = bubble.text.length > LONG_MESSAGE_CHARS ? "comic-bubble--wide" : "";
  return (
    <div className={`comic-bubble comic-pop ${style.variant} ${wide}`}>
      <BubbleTail side={side} fill={style.fill} />
      {style.label && <span className="comic-bubble__label">{style.label}</span>}
      {bubble.text}
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
