// Voice delivery coaching: pace, filler words, hedging, and long pauses,
// measured from speech-recognition events while the candidate answers aloud.
// Coaching only — the backend never uses these numbers for scoring.

export interface DeliveryMetrics {
  voice_words: number;
  speaking_seconds: number;
  wpm: number | null;
  filler_count: number;
  fillers: Record<string, number>;
  hedge_count: number;
  hedges: Record<string, number>;
  long_pauses: number;
}

// "like" is left out on purpose: in plain transcripts it's usually not a filler.
// Note: some browsers' speech recognition drops "um"/"uh" before we see them.
const FILLERS = ["you know", "i mean", "um", "uh", "uhm", "erm", "hmm", "basically", "literally", "actually"];
const HEDGES = ["i'm not sure", "i feel like", "i think", "i guess", "kind of", "sort of", "maybe", "probably", "perhaps", "possibly"];

// A gap this long between recognition events counts as a long pause.
export const LONG_PAUSE_MS = 2500;
const MIN_WORDS_FOR_PACE = 10;
const MIN_SECONDS_FOR_PACE = 5;

function countPhrases(text: string, phrases: string[]): Record<string, number> {
  // Longest phrases first, and cut each match out so "kind of" isn't also "of".
  // (No regex lookbehind: older iOS Safari can't parse it.)
  let rest = ` ${text.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]+/g, " ")} `.replace(/\s+/g, " ");
  const counts: Record<string, number> = {};
  for (const p of [...phrases].sort((a, b) => b.length - a.length)) {
    const needle = ` ${p} `;
    let n = 0;
    let idx = rest.indexOf(needle);
    while (idx !== -1) {
      n += 1;
      rest = rest.slice(0, idx) + rest.slice(idx + needle.length - 1);
      idx = rest.indexOf(needle);
    }
    if (n) counts[p] = n;
  }
  return counts;
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export class DeliveryTracker {
  private finals: string[] = [];
  private lastEvent: number | null = null;
  private speakingMs = 0;
  private longPauses = 0;

  /** A new listening session started (gaps across sessions aren't pauses). */
  begin() {
    this.lastEvent = null;
  }

  /** Call for every recognition result, interim or final. */
  activity(chunk: string, isFinal: boolean, now: number = Date.now()) {
    if (this.lastEvent !== null) {
      const gap = now - this.lastEvent;
      if (gap > LONG_PAUSE_MS) this.longPauses += 1;
      else this.speakingMs += gap;
    }
    this.lastEvent = now;
    if (isFinal && chunk.trim()) this.finals.push(chunk);
  }

  end() {
    this.lastEvent = null;
  }

  reset() {
    this.finals = [];
    this.lastEvent = null;
    this.speakingMs = 0;
    this.longPauses = 0;
  }

  metrics(): DeliveryMetrics | null {
    const text = this.finals.join(" ");
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!words) return null;
    const seconds = Math.round((this.speakingMs / 1000) * 10) / 10;
    const fillers = countPhrases(text, FILLERS);
    const hedges = countPhrases(text, HEDGES);
    return {
      voice_words: words,
      speaking_seconds: seconds,
      wpm:
        words >= MIN_WORDS_FOR_PACE && seconds >= MIN_SECONDS_FOR_PACE
          ? Math.round(words / (seconds / 60))
          : null,
      filler_count: sum(fillers),
      fillers,
      hedge_count: sum(hedges),
      hedges,
      long_pauses: this.longPauses,
    };
  }
}

/** Display form of a counted phrase ("i think" -> "I think"). */
export function displayPhrase(p: string): string {
  return p.replace(/\bi\b/g, "I").replace(/\bi'm\b/g, "I'm");
}

export function paceLabel(wpm: number | null): string {
  if (wpm === null) return "measuring…";
  if (wpm < 110) return "a little slow";
  if (wpm > 170) return "a little fast";
  return "conversational";
}
