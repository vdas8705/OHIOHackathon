// Turns display text into a sequence of short spoken segments, each with its
// own rate, pitch, and trailing pause. The Web Speech API has no reliable SSML
// support (Chrome reads the tags aloud), so prosody is applied per utterance.

export interface SpeechSegment {
  text: string;
  rate: number; // multiplier, 1 = voice default
  pitch: number; // multiplier, 1 = voice default
  pauseAfterMs: number;
}

const PAUSE_CLAUSE_MS = 70; // commas; utterance startup adds a little more
const PAUSE_BREATH_MS = 150; // semicolons, colons, dashes
const PAUSE_SENTENCE_MS = 320;
const PAUSE_QUESTION_MS = 380;
const PAUSE_PARAGRAPH_MS = 600;

const RATE_VARIATION = 0.04; // ±4%
const PITCH_VARIATION = 0.05; // ±5%

const ENCOURAGING =
  /^(nice|great|good (job|work|point|answer|start|call)|well done|excellent|awesome|perfect|fantastic|exactly|love (that|it)|that's (great|a great|a strong)|strong (answer|start|point)|you've got this|keep it up)\b/i;

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|approx|e\.g|i\.e|U\.S)\.$/i;

/** Strip markdown, code, links, and emoji so only speakable words remain. */
export function cleanForSpeech(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "");
  t = t.replace(/(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, "$2");
  t = t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, "");
  t = t.replace(/(^|\s)[:;]-?[)(DPp](?=\s|$)/g, "$1");
  t = t.replace(/\s&\s/g, " and ");
  t = t.replace(/[*_#`~|<>{}[\]\\^=]+/g, " ");

  // Keep paragraph breaks; turn single line breaks into sentence ends so
  // list items and headings don't run together.
  return t
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .map((line, i, lines) =>
          i < lines.length - 1 && !/[.!?…:;,]$/.test(line) ? `${line}.` : line
        )
        .join(" ")
    )
    .filter(Boolean)
    .join("\n\n");
}

function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const end = m.index + m[0].length;
    const candidate = paragraph.slice(last, end).trim();
    if (ABBREVIATION.test(candidate)) continue;
    if (candidate) out.push(candidate);
    last = end;
  }
  const rest = paragraph.slice(last).trim();
  if (rest) out.push(rest);
  return out;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Split a sentence at commas/semicolons/dashes when both sides are long enough. */
function splitClauses(sentence: string): { text: string; pauseAfterMs: number }[] {
  // No lookbehind here: older iOS Safari can't parse it.
  const parts = sentence
    .replace(/([,;:])\s+/g, "$1\u0000")
    .replace(/\s+[—–]\s+|\s+-\s+/g, "\u0000")
    .split("\u0000");
  const clauses: { text: string; pauseAfterMs: number }[] = [];
  let buffer = "";
  for (let i = 0; i < parts.length; i++) {
    buffer = buffer ? `${buffer} ${parts[i]}` : parts[i];
    const isLast = i === parts.length - 1;
    const remaining = parts.slice(i + 1).join(" ");
    if (isLast || (wordCount(buffer) >= 4 && wordCount(remaining) >= 3)) {
      clauses.push({
        text: buffer,
        pauseAfterMs: /,$/.test(buffer) ? PAUSE_CLAUSE_MS : PAUSE_BREATH_MS,
      });
      buffer = "";
    }
  }
  return clauses;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Bounded random walk so delivery drifts gently instead of jumping. */
function drift(prev: number): number {
  const next = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
  return Math.max(-1, Math.min(1, next));
}

export function planSegments(raw: string): SpeechSegment[] {
  const text = cleanForSpeech(raw);
  const segments: SpeechSegment[] = [];
  let rateWalk = 0;
  let pitchWalk = 0;

  const paragraphs = text.split("\n\n");
  paragraphs.forEach((para, pi) => {
    const sentences = splitSentences(para);
    sentences.forEach((sentence, si) => {
      rateWalk = drift(rateWalk);
      pitchWalk = drift(pitchWalk);

      const isQuestion = /\?["'”’)\]]*$/.test(sentence);
      const isEncouraging = ENCOURAGING.test(sentence) || /!["'”’)\]]*$/.test(sentence);
      const isExplanation = !isEncouraging && wordCount(sentence) >= 16;

      let rate = 1 + RATE_VARIATION * rateWalk;
      let pitch = 1 + PITCH_VARIATION * (isExplanation ? pitchWalk * 0.5 : pitchWalk);
      if (isEncouraging) {
        rate *= 1.04;
        pitch *= 1.05;
      } else if (isExplanation) {
        rate *= 0.97;
      }
      // Keep the combined effect subtle so nothing sounds sing-song.
      rate = clamp(rate, 0.94, 1.07);
      pitch = clamp(pitch, 0.94, 1.08);

      const lastSentence = si === sentences.length - 1;
      const lastParagraph = pi === paragraphs.length - 1;
      const sentencePause = lastSentence
        ? lastParagraph ? 0 : PAUSE_PARAGRAPH_MS
        : isQuestion ? PAUSE_QUESTION_MS : PAUSE_SENTENCE_MS;

      const clauses = splitClauses(sentence);
      clauses.forEach((clause, ci) => {
        const finalClause = ci === clauses.length - 1;
        // Tiny per-clause variation; questions lift on the final clause.
        const clausePitch = clamp(
          pitch * (1 + (Math.random() * 2 - 1) * 0.01) * (isQuestion && finalClause ? 1.06 : 1),
          0.93,
          1.1
        );
        segments.push({
          text: clause.text,
          rate,
          pitch: clausePitch,
          pauseAfterMs: finalClause ? sentencePause : clause.pauseAfterMs,
        });
      });
    });
  });
  return segments;
}
