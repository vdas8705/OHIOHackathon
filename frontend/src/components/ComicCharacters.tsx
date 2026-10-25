// Chest-up comic characters for the chat. Same flat style and head geometry as
// PersonAvatars (48-unit wide viewBox), extended downward to show a torso.
// Backdrops and the assistant's top use theme CSS variables.

import { useId } from "react";
import { PersonAvatars } from "./PersonAvatars";

export type Expression = "neutral" | "smiling" | "thinking";

const INK = "#2a1f1a";
const VIEW_W = 48;
const VIEW_H = 58;

// One top color per user avatar, chosen to read well against skin and hair.
const USER_SHIRTS = ["#3b82f6", "#10b981", "#f97316", "#8b5cf6", "#ef4444", "#14b8a6", "#eab308", "#64748b"];

interface Props {
  isAssistant?: boolean;
  index?: number;
  expression?: Expression;
  /** Animate the assistant's mouth while it speaks. */
  talking?: boolean;
  width: number;
}

export function ComicCharacterSVG({
  isAssistant = false,
  index = 0,
  expression = "neutral",
  talking = false,
  width,
}: Props) {
  const height = (width * VIEW_H) / VIEW_W;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {isAssistant ? (
        <AssistantFigure expression={expression} talking={talking} />
      ) : (
        <UserFigure index={index} />
      )}
    </svg>
  );
}

function Backdrop({ bg, ring }: { bg: string; ring: string }) {
  return <circle cx="24" cy="25" r="22" fill={bg} stroke={ring} strokeWidth="1.5" />;
}

function UserFigure({ index }: { index: number }) {
  const cfg = PersonAvatars[index % PersonAvatars.length];
  const shirt = USER_SHIRTS[index % USER_SHIRTS.length];
  const skin = cfg.skin;
  const hair = cfg.hair;

  return (
    <>
      <Backdrop bg="var(--avatar-user-bg)" ring="var(--avatar-user-ring)" />

      {/* Long hair falls behind the shoulders */}
      {cfg.hairStyle === "long" && (
        <path d="M14 22 Q14 10 24 10 Q34 10 34 22 L35 37 L13 37 Z" fill={hair} />
      )}

      {/* Neck and V-neck top */}
      <path d="M20 29 H28 V40 L24 45 L20 40 Z" fill={skin} />
      <path d="M4.5 58 Q5 42 17 39 L24 45 L31 39 Q43 42 43.5 58 Z" fill={shirt} stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />

      {/* Head */}
      <circle cx="24" cy="22" r="9" fill={skin} stroke={INK} strokeWidth="0.8" />

      {/* Hair styles (same shapes as the small avatars) */}
      {cfg.hairStyle === "short" && (
        <path d="M15 20 Q15 12 24 12 Q33 12 33 20 Q33 16 24 15 Q15 16 15 20 Z" fill={hair} />
      )}
      {cfg.hairStyle === "long" && (
        <path d="M14 22 Q14 10 24 10 Q34 10 34 22 L34 32 Q34 30 32 28 L32 18 Q28 14 24 14 Q20 14 16 18 L16 28 Q14 30 14 32 Z" fill={hair} />
      )}
      {cfg.hairStyle === "buzz" && (
        <path d="M16 18 Q16 12 24 12 Q32 12 32 18 Q28 14 24 14 Q20 14 16 18 Z" fill={hair} opacity="0.6" />
      )}
      {cfg.hairStyle === "bun" && (
        <>
          <circle cx="24" cy="10" r="5" fill={hair} />
          <path d="M16 20 Q16 13 24 13 Q32 13 32 20 Q28 15 24 15 Q20 15 16 20 Z" fill={hair} />
        </>
      )}
      {cfg.hairStyle === "wave" && (
        <path d="M14 20 Q14 10 24 10 Q34 10 34 20 Q30 14 24 13 Q18 14 14 20 Z M34 18 Q36 20 34 22" fill={hair} />
      )}
      {cfg.hairStyle === "afro" && <path d="M12.5 20 A12 11.5 0 1 1 35.5 20 Q31 13.5 24 13.5 Q17 13.5 12.5 20 Z" fill={hair} />}
      {cfg.hairStyle === "curly" && (
        <>
          <circle cx="18" cy="14" r="4" fill={hair} />
          <circle cx="24" cy="11" r="5" fill={hair} />
          <circle cx="30" cy="14" r="4" fill={hair} />
          <circle cx="15" cy="18" r="3" fill={hair} />
          <circle cx="33" cy="18" r="3" fill={hair} />
        </>
      )}

      {/* Face */}
      {cfg.hasGlasses ? (
        <>
          <circle cx="20" cy="22" r="3" fill="none" stroke="#333" strokeWidth="1" />
          <circle cx="28" cy="22" r="3" fill="none" stroke="#333" strokeWidth="1" />
          <line x1="23" y1="22" x2="25" y2="22" stroke="#333" strokeWidth="1" />
          <circle cx="20" cy="22" r="1" fill="#1a1a1a" />
          <circle cx="28" cy="22" r="1" fill="#1a1a1a" />
        </>
      ) : (
        <>
          <circle cx="20" cy="22" r="1.2" fill="#1a1a1a" />
          <circle cx="28" cy="22" r="1.2" fill="#1a1a1a" />
        </>
      )}
      <path d="M20 26 Q24 29 28 26" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </>
  );
}

const A_SKIN = "#d29a6f";
const A_HAIR = "#3b2418";
const A_MOUTH = "#5a2a20";

function AssistantFigure({ expression, talking }: { expression: Expression; talking: boolean }) {
  const clipId = `comic-assistant-${useId().replace(/:/g, "")}`;
  return (
    <>
      <Backdrop bg="var(--avatar-ai-bg)" ring="var(--avatar-ai-ring)" />

      {/* Hair behind the head, falling to the shoulders */}
      <path d="M14.5 21 Q14 11 24 10.5 Q34 11 33.5 21 L34.5 34 Q31 36 28 34 L20 34 Q17 36 13.5 34 Z" fill={A_HAIR} />

      {/* Neck, collared top in the theme accent */}
      <path d="M20.5 29 L27.5 29 L27.5 36 Q24 40 20.5 36 Z" fill={A_SKIN} />
      <defs>
        <clipPath id={clipId}>
          <path d="M4.5 58 Q5 39.5 19 35.5 L24 39 L29 35.5 Q43 39.5 43.5 58 Z" />
        </clipPath>
      </defs>
      <path d="M4.5 58 Q5 39.5 19 35.5 L24 39 L29 35.5 Q43 39.5 43.5 58 Z" fill="var(--avatar-ai-icon)" stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
      <g clipPath={`url(#${clipId})`}>
        <path d="M24 39 V58" stroke={INK} strokeWidth="0.6" opacity="0.35" />
      </g>
      <path d="M19 35.5 L24 39 L22 41.8 L17.3 36.7 Z M29 35.5 L24 39 L26 41.8 L30.7 36.7 Z" fill="#ffffff" stroke={INK} strokeWidth="0.6" strokeLinejoin="round" />

      {/* Ears and head */}
      <ellipse cx="15.6" cy="22.5" rx="1.6" ry="2.2" fill={A_SKIN} />
      <ellipse cx="32.4" cy="22.5" rx="1.6" ry="2.2" fill={A_SKIN} />
      <ellipse cx="24" cy="21.5" rx="8.5" ry="9.2" fill={A_SKIN} stroke={INK} strokeWidth="0.8" />

      {/* Side-swept fringe */}
      <path d="M15.4 20 Q15.5 12.2 24 12.2 Q32.6 12.2 32.6 20 Q30 15.5 25 16.2 Q20 17 15.4 20 Z" fill={A_HAIR} />

      {/* Cheeks */}
      <circle cx="18.6" cy="25" r="1.6" fill="#e8737a" opacity={expression === "smiling" ? 0.5 : 0.35} />
      <circle cx="29.4" cy="25" r="1.6" fill="#e8737a" opacity={expression === "smiling" ? 0.5 : 0.35} />

      {expression === "smiling" && (
        <>
          <path d="M18.4 18.2 Q20 17.2 21.6 18 M26.4 18 Q28 17.2 29.6 18.2" stroke={A_HAIR} strokeWidth="0.9" strokeLinecap="round" />
          <path d="M18.7 22 Q20 20.5 21.3 22 M26.7 22 Q28 20.5 29.3 22" stroke="#1a1a1a" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          {!talking && (
            <path d="M20 25 Q24 30.6 28 25 Q24 26.4 20 25 Z" fill={A_MOUTH} stroke={A_MOUTH} strokeWidth="0.6" strokeLinejoin="round" />
          )}
        </>
      )}

      {expression === "neutral" && (
        <>
          <path d="M18.4 18.6 Q20 17.7 21.6 18.4 M26.4 18.4 Q28 17.7 29.6 18.6" stroke={A_HAIR} strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="20" cy="21.6" r="1.15" fill="#1a1a1a" />
          <circle cx="28" cy="21.6" r="1.15" fill="#1a1a1a" />
          {!talking && (
            <path d="M20.6 25.6 Q24 28.6 27.4 25.6" stroke={A_MOUTH} strokeWidth="1.2" strokeLinecap="round" fill="none" />
          )}
        </>
      )}

      {talking && <ellipse className="comic-talk-mouth" cx="24" cy="26.6" rx="2.4" ry="1.8" fill={A_MOUTH} />}

      {expression === "thinking" && (
        <>
          <path d="M18.4 17.6 Q20 16.3 21.6 17.2 M26.4 18.4 Q28 17.9 29.6 18.6" stroke={A_HAIR} strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="20.7" cy="20.9" r="1.15" fill="#1a1a1a" />
          <circle cx="28.7" cy="20.9" r="1.15" fill="#1a1a1a" />
          {!talking && (
            <path d="M21.8 26.4 Q24.5 25.5 26.8 26.2" stroke={A_MOUTH} strokeWidth="1.2" strokeLinecap="round" fill="none" />
          )}
          {/* Thought puffs */}
          <g className="comic-think-dots">
            <circle cx="37.5" cy="13" r="1.1" fill="#ffffff" stroke={INK} strokeWidth="0.7" />
            <circle cx="40.6" cy="8.8" r="1.6" fill="#ffffff" stroke={INK} strokeWidth="0.7" />
            <circle cx="44.2" cy="4.2" r="2.2" fill="#ffffff" stroke={INK} strokeWidth="0.7" />
          </g>
        </>
      )}
    </>
  );
}
