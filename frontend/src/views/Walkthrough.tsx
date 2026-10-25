import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  MessageCircleQuestion,
  MinusCircle,
  Play,
  RotateCcw,
  Send,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react";
import { Button } from "../components/ui";
import { SpeakerTurn, ThinkingBubble, BubbleTail, type Speaker } from "../components/ComicChat";
import type { Expression } from "../components/ComicCharacters";
import { VoiceSettingsButton, VoiceStatusNote } from "../components/VoiceControls";
import { api } from "../api";
import { useInterviewerVoice } from "../speech/useSpeech";
import { voiceEngine } from "../speech/voiceEngine";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type KokoroVoiceId,
} from "../speech/voiceSettings";
import type { Walkthrough as WalkthroughData, WalkthroughCorrectness } from "../types";

const OFFER_TEXT =
  "Nice work, you finished all five questions! Want me to walk you through how you did before you see your results?";
const LOAD_FAILED_TEXT =
  "I couldn't put the walkthrough together just now, but your full results are ready.";

// ── Result marker: icon + text, never color alone ───────────────────────────

const MARKERS: Record<WalkthroughCorrectness, { label: string; Icon: typeof CheckCircle2 }> = {
  correct: { label: "Correct", Icon: CheckCircle2 },
  partly_correct: { label: "Partly correct", Icon: MinusCircle },
  incorrect: { label: "Incorrect", Icon: XCircle },
};

export function ResultMarker({ correctness, level }: { correctness: WalkthroughCorrectness; level: string }) {
  const { label, Icon } = MARKERS[correctness];
  return (
    <span className="comic-marker">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {label}
        <span className="comic-marker__level"> · {level}</span>
      </span>
    </span>
  );
}

// ── Transcript entries ──────────────────────────────────────────────────────

interface Entry {
  id: string;
  speaker: Speaker;
  text: string;
  label?: string;
  marker?: { correctness: WalkthroughCorrectness; level: string };
}

function groupEntries(entries: Entry[]) {
  const turns: { speaker: Speaker; entries: Entry[] }[] = [];
  for (const e of entries) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === e.speaker) last.entries.push(e);
    else turns.push({ speaker: e.speaker, entries: [e] });
  }
  return turns;
}

export function EntryBubble({ entry, action }: { entry: Entry; action?: ReactNode }) {
  const isAssistant = entry.speaker === "assistant";
  return (
    <div
      className={`comic-bubble comic-pop ${isAssistant ? "comic-bubble--ai" : "comic-bubble--user"} ${
        entry.text.length > 320 ? "comic-bubble--wide" : ""
      }`}
    >
      <BubbleTail side={isAssistant ? "left" : "right"} fill={isAssistant ? "var(--bg-bubble-ai)" : "var(--bg-bubble-user)"} />
      {(entry.label || entry.marker) && (
        <span className="comic-bubble__label flex flex-wrap items-center gap-2">
          {entry.label}
          {entry.marker && <ResultMarker correctness={entry.marker.correctness} level={entry.marker.level} />}
        </span>
      )}
      {entry.text}
      {action}
    </div>
  );
}

const isGood = (c?: WalkthroughCorrectness) => c === "correct";

// ── Live walkthrough ────────────────────────────────────────────────────────

type Phase = "offer" | "loading" | "intro" | "question" | "asking" | "answering" | "wrap";

export default function Walkthrough({
  sessionId,
  userAvatarId,
  picker,
  offer,
  onDone,
}: {
  sessionId: string;
  userAvatarId: number;
  picker: ReactNode;
  /** Ask first ("want me to walk you through it?") instead of starting right away. */
  offer: boolean;
  onDone: () => void;
}) {
  const [script, setScript] = useState<WalkthroughData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>(offer ? "offer" : "loading");
  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [controls, setControls] = useState(false);
  const [question, setQuestion] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const stoppedRef = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Voice: same settings as the interview.
  const [voiceSettings] = useState(loadVoiceSettings);
  const [muted, setMuted] = useState(!voiceSettings.enabled);
  const [rate, setRate] = useState(voiceSettings.rate);
  const [voiceId, setVoiceId] = useState(voiceSettings.voice);
  const { speak, stop, speaking, engine } = useInterviewerVoice(muted, rate, voiceId);

  // Generate (or fetch the saved) script right away so it's ready when needed.
  useEffect(() => {
    let cancelled = false;
    api
      .walkthrough(sessionId)
      .then((s) => !cancelled && setScript(s))
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
      voiceEngine.cancel();
    };
  }, [sessionId]);

  const add = (e: Entry) => setEntries((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));

  /** Speak (or, with voice off, just show) a line; reveal controls when it ends. */
  const say = useCallback(
    (text: string, after?: (natural: boolean) => void) => {
      stoppedRef.current = false;
      setControls(false);
      speak(text, () => {
        setControls(true);
        after?.(!stoppedRef.current);
      });
    },
    [speak]
  );

  function stopSpeech() {
    stoppedRef.current = true;
    stop();
    setControls(true);
  }

  function finish() {
    stoppedRef.current = true;
    stop();
    doneRef.current();
  }

  // ---- offer ----
  useEffect(() => {
    if (!offer) return;
    add({ id: "offer", speaker: "assistant", text: OFFER_TEXT });
    say(OFFER_TEXT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function accept() {
    stopSpeech();
    add({ id: "yes", speaker: "user", text: "Yes, walk me through it." });
    setPhase("loading");
  }

  // ---- couldn't build the script: say so, not just show it ----
  const failSpokenRef = useRef(false);
  useEffect(() => {
    if (!loadFailed || script || phase === "offer" || failSpokenRef.current) return;
    failSpokenRef.current = true;
    say(LOAD_FAILED_TEXT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFailed, script, phase]);

  // ---- start once the script is ready ----
  useEffect(() => {
    if (phase !== "loading" || !script) return;
    void api.walkthroughViewed(sessionId).catch(() => undefined);
    setPhase("intro");
    add({ id: "intro", speaker: "assistant", text: script.intro, label: `Your score: ${script.overall_score} / ${script.max_score}` });
    say(script.intro, (natural) => {
      if (natural && script.questions.length) showQuestion(0, script);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, script]);

  function showQuestion(i: number, s: WalkthroughData = script!) {
    const q = s.questions[i];
    setIndex(i);
    setPhase("question");
    add({
      id: `q-${q.round_number}`,
      speaker: "assistant",
      text: q.spoken,
      label: `Question ${i + 1} of ${s.questions.length}`,
      marker: { correctness: q.correctness, level: q.performance_level },
    });
    say(q.spoken);
  }

  function next() {
    if (!script) return;
    stopSpeech();
    if (phase === "intro" && script.questions.length) return showQuestion(0);
    if (phase !== "intro" && index + 1 < script.questions.length) return showQuestion(index + 1);
    setPhase("wrap");
    add({ id: "wrap", speaker: "assistant", text: script.wrap_up, label: "Wrap-up" });
    say(script.wrap_up, (natural) => {
      // The wrap-up ends with "Here are your full results", so move on by itself.
      if (natural && !muted) setTimeout(() => doneRef.current(), 900);
    });
  }

  function replay() {
    if (!script) return;
    stopSpeech();
    const text = phase === "wrap" ? script.wrap_up : phase === "intro" ? script.intro : script.questions[index].spoken;
    say(text);
  }

  async function ask() {
    const q = question.trim();
    if (!q || !script) return;
    const round = script.questions[index].round_number;
    const n = entries.length;
    setQuestion("");
    add({ id: `fq-${n}`, speaker: "user", text: q });
    setPhase("answering");
    let answer: string;
    try {
      answer = (await api.walkthroughAsk(sessionId, round, q)).answer;
    } catch {
      answer = "Sorry, I couldn't answer that just now. Let's keep going, and you can try again in a moment.";
    }
    setPhase("question");
    add({ id: `fa-${n}`, speaker: "assistant", text: answer });
    say(answer);
  }

  // Keep the newest bubble in view, and focus the main action when controls appear.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, phase, controls]);
  useEffect(() => {
    if (controls && phase !== "asking") primaryRef.current?.focus({ preventScroll: true });
  }, [controls, phase]);

  // ---- derived UI state ----
  const total = script?.questions.length ?? 0;
  const progress =
    phase === "question" || phase === "asking" || phase === "answering"
      ? `Question ${index + 1} of ${total}`
      : phase === "wrap"
      ? "Wrap-up"
      : phase === "intro"
      ? "Intro"
      : null;
  const current = phase === "question" || phase === "asking" ? script?.questions[index] : undefined;
  const busy = phase === "loading" || phase === "answering";
  const good =
    phase === "wrap" ||
    (phase === "intro" && (script?.overall_score ?? 0) >= 60) ||
    isGood(current?.correctness);
  const expression: Expression = busy ? "thinking" : good ? "smiling" : "neutral";
  const turns = groupEntries(entries);
  const lastAssistant = turns.map((t) => t.speaker).lastIndexOf("assistant");

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    saveVoiceSettings({ enabled: !nextMuted, rate, voice: voiceId });
    if (nextMuted) stopSpeech();
  }

  const controlsUi = (() => {
    if (phase === "offer") {
      return (
        <div className="comic-tags">
          <button ref={primaryRef} className="comic-tag comic-tag--primary" onClick={accept}>
            <Play className="h-4 w-4" aria-hidden="true" /> Yes, walk me through it
          </button>
          <button className="comic-tag comic-tag--secondary" onClick={finish}>
            <ArrowRight className="h-4 w-4" aria-hidden="true" /> No, show my results
          </button>
        </div>
      );
    }
    if (busy || phase === "asking") return null;
    if (speaking && !controls) {
      return (
        <div className="comic-tags">
          <button className="comic-tag comic-tag--secondary" onClick={stopSpeech}>
            <Square className="h-4 w-4" aria-hidden="true" /> Stop
          </button>
          <button className="comic-tag comic-tag--secondary" onClick={finish}>
            <SkipForward className="h-4 w-4" aria-hidden="true" /> Skip to my results
          </button>
        </div>
      );
    }
    if (!controls) return null;
    if (phase === "wrap") {
      return (
        <div className="comic-tags">
          <button ref={primaryRef} className="comic-tag comic-tag--primary" onClick={finish}>
            <ArrowRight className="h-4 w-4" aria-hidden="true" /> Show my full results
          </button>
          <button className="comic-tag comic-tag--secondary" onClick={replay}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Say that again
          </button>
        </div>
      );
    }
    const lastQuestion = phase === "question" && index + 1 >= total;
    return (
      <div className="comic-tags">
        <button ref={primaryRef} className="comic-tag comic-tag--primary" onClick={next}>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          {phase === "intro" ? (total ? "Start with question 1" : "Wrap up") : lastQuestion ? "Wrap up" : "Next question"}
        </button>
        <button className="comic-tag comic-tag--secondary" onClick={replay}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Say that again
        </button>
        {phase === "question" && (
          <button className="comic-tag comic-tag--secondary" onClick={() => setPhase("asking")}>
            <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" /> I have a question
          </button>
        )}
        <button className="comic-tag comic-tag--secondary" onClick={finish}>
          <SkipForward className="h-4 w-4" aria-hidden="true" /> Skip to my results
        </button>
      </div>
    );
  })();

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 text-teal-accent" />
          <span className="font-bold">Simul AI · Results walkthrough</span>
        </div>
        <div className="flex items-center gap-2">
          {picker}
          {phase !== "offer" && (
            <Button variant="ghost" onClick={finish}>
              <SkipForward className="h-4 w-4" /> Skip to my results
            </Button>
          )}
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-live="polite">
        {progress && <span className="comic-progress comic-font">{progress}</span>}
        <VoiceStatusNote engine={engine} enabled={!muted} />
        {muted && (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Voice is off, so the walkthrough is text only.
          </span>
        )}
      </div>

      <div className="comic-panel mt-3 flex-1 overflow-hidden">
        <div
          ref={transcriptRef}
          role="log"
          aria-live="polite"
          aria-label="Results walkthrough"
          className="comic-transcript comic-font scroll-slim h-[56vh] space-y-5 overflow-y-auto p-3 sm:h-[60vh] sm:p-5"
        >
          {turns.map((turn, ti) => {
            const isLast = ti === turns.length - 1;
            const isAssistantTurn = turn.speaker === "assistant";
            return (
              <SpeakerTurn
                key={turn.entries[0].id}
                speaker={turn.speaker}
                userAvatarId={userAvatarId}
                expression={isAssistantTurn && ti === lastAssistant ? expression : "neutral"}
                talking={isAssistantTurn && ti === lastAssistant && speaking && !busy}
              >
                {turn.entries.map((e) => (
                  <EntryBubble key={e.id} entry={e} />
                ))}
                {isLast && isAssistantTurn && busy && (
                  <ThinkingBubble label={phase === "loading" ? "Getting your results ready…" : undefined} />
                )}
                {isLast && isAssistantTurn && controlsUi}
              </SpeakerTurn>
            );
          })}
          {busy && turns[turns.length - 1]?.speaker !== "assistant" && (
            <SpeakerTurn speaker="assistant" userAvatarId={userAvatarId} expression="thinking">
              <ThinkingBubble label={phase === "loading" ? "Getting your results ready…" : undefined} />
            </SpeakerTurn>
          )}
          {loadFailed && !script && phase !== "offer" && (
            <SpeakerTurn speaker="assistant" userAvatarId={userAvatarId}>
              <div className="comic-bubble comic-bubble--ai">
                <BubbleTail side="left" fill="var(--bg-bubble-ai)" />
                {LOAD_FAILED_TEXT}
                <div className="comic-tags mt-2">
                  <button ref={primaryRef} className="comic-tag comic-tag--primary" onClick={finish}>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" /> Show my results
                  </button>
                </div>
              </div>
            </SpeakerTurn>
          )}
        </div>
      </div>

      {phase === "asking" && (
        <form
          className="comic-panel comic-font mt-4 p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label htmlFor="wt-question" className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            Your question about question {index + 1}
          </label>
          <textarea
            id="wt-question"
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            maxLength={1000}
            placeholder="For example: what would a strong answer have started with?"
            className="mt-2 min-h-[64px] w-full resize-y rounded-xl border px-3 py-2 text-[15px] focus:outline-none"
          />
          <div className="comic-tags mt-2 justify-end">
            <button type="button" className="comic-tag comic-tag--secondary" onClick={() => setPhase("question")}>
              Cancel
            </button>
            <button type="submit" className="comic-tag comic-tag--primary" disabled={!question.trim()}>
              <Send className="h-4 w-4" aria-hidden="true" /> Ask
            </button>
          </div>
        </form>
      )}

      <div className="mt-3 flex items-center gap-2">
        <VoiceSettingsButton
          enabled={!muted}
          rate={rate}
          voice={voiceId}
          engine={engine}
          onToggleEnabled={toggleMute}
          onRateChange={(r) => {
            setRate(r);
            saveVoiceSettings({ enabled: !muted, rate: r, voice: voiceId });
          }}
          onVoiceChange={(v: KokoroVoiceId) => {
            setVoiceId(v);
            saveVoiceSettings({ enabled: !muted, rate, voice: v });
          }}
        />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Voice settings
        </span>
      </div>
    </div>
  );
}

// ── Saved (read-only) walkthrough for Past Sessions ─────────────────────────

export function SavedWalkthrough({ walkthrough, userAvatarId }: { walkthrough: WalkthroughData; userAvatarId: number }) {
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => voiceEngine.cancel(), []);

  function play(id: string, text: string) {
    if (playing === id) {
      voiceEngine.cancel();
      setPlaying(null);
      return;
    }
    const { rate, voice } = loadVoiceSettings();
    void voiceEngine.preload();
    setPlaying(id);
    voiceEngine.speak(text, { rate, voice, onEnd: () => setPlaying((p) => (p === id ? null : p)) });
  }

  const entries: Entry[] = [
    { id: "intro", speaker: "assistant", text: walkthrough.intro, label: `Your score: ${walkthrough.overall_score} / ${walkthrough.max_score}` },
  ];
  walkthrough.questions.forEach((q, i) => {
    entries.push({
      id: `q-${q.round_number}`,
      speaker: "assistant",
      text: q.spoken,
      label: `Question ${i + 1} of ${walkthrough.questions.length}`,
      marker: { correctness: q.correctness, level: q.performance_level },
    });
    walkthrough.followups
      .filter((f) => f.round_number === q.round_number)
      .forEach((f, j) => {
        entries.push({ id: `fq-${q.round_number}-${j}`, speaker: "user", text: f.question });
        entries.push({ id: `fa-${q.round_number}-${j}`, speaker: "assistant", text: f.answer });
      });
  });
  entries.push({ id: "wrap", speaker: "assistant", text: walkthrough.wrap_up, label: "Wrap-up" });

  return (
    <div className="comic-panel print-light">
      <div className="comic-transcript comic-font space-y-5 p-3 sm:p-5">
        {groupEntries(entries).map((turn) => (
          <SpeakerTurn key={turn.entries[0].id} speaker={turn.speaker} userAvatarId={userAvatarId}>
            {turn.entries.map((e) => (
              <EntryBubble
                key={e.id}
                entry={e}
                action={
                  e.speaker === "assistant" ? (
                    <div className="mt-2">
                      <button
                        className="comic-tag comic-tag--secondary no-print"
                        onClick={() => play(e.id, e.text)}
                        aria-label={`${playing === e.id ? "Stop" : "Play"} ${e.label ?? "this explanation"}`}
                      >
                        {playing === e.id ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                        {playing === e.id ? "Stop" : "Play"}
                      </button>
                    </div>
                  ) : undefined
                }
              />
            ))}
          </SpeakerTurn>
        ))}
      </div>
    </div>
  );
}
