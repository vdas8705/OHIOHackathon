// Shared comic-chat building blocks: a speaker turn (big character + stacked
// bubbles), balloon tails, and the "thinking" bubble. Used by the interview
// transcript and the results walkthrough.

import type { ReactNode } from "react";
import { ComicCharacterSVG, type Expression } from "./ComicCharacters";

export type Speaker = "assistant" | "user";

/** One speaker turn: a large character with that speaker's bubbles stacked beside it. */
export function SpeakerTurn({
  speaker,
  userAvatarId,
  expression = "neutral",
  talking = false,
  showCharacter = true,
  children,
}: {
  speaker: Speaker;
  userAvatarId: number;
  expression?: Expression;
  talking?: boolean;
  showCharacter?: boolean;
  children: ReactNode;
}) {
  const isAssistant = speaker === "assistant";
  return (
    <div className={`comic-turn ${isAssistant ? "" : "comic-turn--right"}`}>
      <div className="comic-char" role={showCharacter ? "img" : undefined} aria-label={showCharacter ? (isAssistant ? "Assistant" : "You") : undefined}>
        {showCharacter && (
          <>
            <CharacterArt isAssistant={isAssistant} userAvatarId={userAvatarId} expression={expression} talking={talking} />
            <div className="comic-char__name" aria-hidden="true">
              {isAssistant ? "Interviewer" : "You"}
            </div>
          </>
        )}
      </div>
      <div className="comic-stack">{children}</div>
    </div>
  );
}

/** Renders at the turn's CSS width (72px mobile, 112px desktop). */
function CharacterArt({
  isAssistant,
  userAvatarId,
  expression,
  talking,
}: {
  isAssistant: boolean;
  userAvatarId: number;
  expression: Expression;
  talking: boolean;
}) {
  return (
    <div className="w-full [&>svg]:h-auto [&>svg]:w-full">
      <ComicCharacterSVG isAssistant={isAssistant} index={userAvatarId} expression={expression} talking={talking} width={112} />
    </div>
  );
}

/** Comic balloon tail; overlaps the bubble border so the outline flows into it. */
export function BubbleTail({ side, fill }: { side: "left" | "right"; fill: string }) {
  return (
    <svg className={`comic-tail comic-tail--${side}`} viewBox="0 0 25 20" aria-hidden="true">
      <path d="M22.5 2 Q11 5.5 0.5 11 Q11 12.5 22.5 18 L25 18 L25 2 Z" fill={fill} />
      <path
        d="M21.3 2.2 Q11 5.5 0.5 11 Q11 12.5 21.3 17.8"
        fill="none"
        stroke="var(--comic-ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThinkingBubble({ label }: { label?: string }) {
  return (
    <div className="comic-bubble comic-pop comic-bubble--ai" role="status" aria-live="polite">
      <BubbleTail side="left" fill="var(--bg-bubble-ai)" />
      <span className="inline-flex items-center gap-2">
        <span className="comic-typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className={label ? "" : "sr-only"}>{label ?? "Interviewer is thinking…"}</span>
      </span>
    </div>
  );
}
