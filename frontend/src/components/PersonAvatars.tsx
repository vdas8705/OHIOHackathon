// Inline SVG person avatars — 8 diverse user options plus the assistant.
// Flat, simple head-and-shoulders illustrations.
// User avatars have fixed skin/hair tones; the assistant is a distinct person
// whose background, ring, and top come from the active theme's CSS variables.

import { useId } from "react";

export const NUM_AVATARS = 8;

interface AvatarConfig {
  skin: string;
  hair: string;
  hairStyle: "short" | "long" | "curly" | "bald" | "bun" | "buzz" | "wave" | "afro";
  hasGlasses?: boolean;
}

const AVATAR_CONFIGS: AvatarConfig[] = [
  { skin: "#8d5524", hair: "#1a1a1a", hairStyle: "short" },
  { skin: "#ffdbac", hair: "#3d2317", hairStyle: "long" },
  { skin: "#c68642", hair: "#0d0d0d", hairStyle: "buzz", hasGlasses: true },
  { skin: "#e0ac69", hair: "#2c1810", hairStyle: "bun" },
  { skin: "#f8c4a0", hair: "#6b4423", hairStyle: "wave" },
  { skin: "#a56a3d", hair: "#1a1a1a", hairStyle: "afro" },
  { skin: "#ffd5b8", hair: "#4a3520", hairStyle: "curly" },
  { skin: "#8d5524", hair: "#555555", hairStyle: "bald" },
];

export const PersonAvatars = AVATAR_CONFIGS;

interface Props {
  index: number;
  size?: number;
  isAssistant?: boolean;
}

/** Renders a single person avatar as inline SVG. */
export function PersonAvatarSVG({ index, size = 36, isAssistant = false }: Props) {
  if (isAssistant) return <AssistantAvatarSVG size={size} />;

  const cfg = AVATAR_CONFIGS[index % AVATAR_CONFIGS.length];
  const w = size;
  const h = size;

  const skinColor = cfg.skin;
  const hairColor = cfg.hair;
  const bgColor = "var(--avatar-user-bg)";
  const ringColor = "var(--avatar-user-ring)";

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Background circle */}
      <circle cx="24" cy="24" r="23" fill={bgColor} stroke={ringColor} strokeWidth="1.5" />

      {/* Shoulders */}
      <path
        d="M10 48 Q10 36 24 36 Q38 36 38 48 Z"
        fill={skinColor}
        opacity="0.7"
      />

      {/* Neck */}
      <rect x="20" y="30" width="8" height="8" rx="2" fill={skinColor} />

      {/* Head */}
      <circle cx="24" cy="22" r="9" fill={skinColor} />

      {/* Hair styles */}
      {cfg.hairStyle === "short" && (
        <path d="M15 20 Q15 12 24 12 Q33 12 33 20 Q33 16 24 15 Q15 16 15 20 Z" fill={hairColor} />
      )}
      {cfg.hairStyle === "long" && (
        <>
          <path d="M14 22 Q14 10 24 10 Q34 10 34 22 L34 32 Q34 30 32 28 L32 18 Q28 14 24 14 Q20 14 16 18 L16 28 Q14 30 14 32 Z" fill={hairColor} />
        </>
      )}
      {cfg.hairStyle === "buzz" && (
        <path d="M16 18 Q16 12 24 12 Q32 12 32 18 Q28 14 24 14 Q20 14 16 18 Z" fill={hairColor} opacity="0.6" />
      )}
      {cfg.hairStyle === "bald" && null}
      {cfg.hairStyle === "bun" && (
        <>
          <circle cx="24" cy="10" r="5" fill={hairColor} />
          <path d="M16 20 Q16 13 24 13 Q32 13 32 20 Q28 15 24 15 Q20 15 16 20 Z" fill={hairColor} />
        </>
      )}
      {cfg.hairStyle === "wave" && (
        <path d="M14 20 Q14 10 24 10 Q34 10 34 20 Q30 14 24 13 Q18 14 14 20 Z M34 18 Q36 20 34 22" fill={hairColor} />
      )}
      {cfg.hairStyle === "afro" && (
        <circle cx="24" cy="14" r="12" fill={hairColor} opacity="0.9" />
      )}
      {cfg.hairStyle === "curly" && (
        <>
          <circle cx="18" cy="14" r="4" fill={hairColor} />
          <circle cx="24" cy="11" r="5" fill={hairColor} />
          <circle cx="30" cy="14" r="4" fill={hairColor} />
          <circle cx="15" cy="18" r="3" fill={hairColor} />
          <circle cx="33" cy="18" r="3" fill={hairColor} />
        </>
      )}

      {/* Eyes */}
      {!cfg.hasGlasses && (
        <>
          <circle cx="20" cy="22" r="1.2" fill="#1a1a1a" />
          <circle cx="28" cy="22" r="1.2" fill="#1a1a1a" />
        </>
      )}

      {/* Glasses */}
      {cfg.hasGlasses && (
        <>
          <circle cx="20" cy="22" r="3" fill="none" stroke="#333" strokeWidth="1" />
          <circle cx="28" cy="22" r="3" fill="none" stroke="#333" strokeWidth="1" />
          <line x1="23" y1="22" x2="25" y2="22" stroke="#333" strokeWidth="1" />
        </>
      )}

      {/* Smile */}
      <path d="M20 26 Q24 29 28 26" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const ASSISTANT_SKIN = "#d29a6f";
const ASSISTANT_HAIR = "#3b2418";

/** The interviewer: a smiling person with shoulder-length hair and a collared top. */
export function AssistantAvatarSVG({ size = 36 }: { size?: number }) {
  const clipId = `assistant-clip-${useId().replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="24" cy="24" r="23" />
        </clipPath>
      </defs>

      {/* Background circle */}
      <circle cx="24" cy="24" r="23" fill="var(--avatar-ai-bg)" stroke="var(--avatar-ai-ring)" strokeWidth="1.5" />

      <g clipPath={`url(#${clipId})`}>
        {/* Hair behind the head, falling to the shoulders */}
        <path d="M14.5 21 Q14 11 24 10.5 Q34 11 33.5 21 L34.5 33 Q31 35 28 33 L20 33 Q17 35 13.5 33 Z" fill={ASSISTANT_HAIR} />

        {/* Top in the theme accent, with a lighter collar */}
        <path d="M8 48 Q8.5 37 19 35.5 L24 39 L29 35.5 Q39.5 37 40 48 Z" fill="var(--avatar-ai-icon)" />
        <path d="M19 35.5 L24 39 L22 41.5 L17.5 36.6 Z M29 35.5 L24 39 L26 41.5 L30.5 36.6 Z" fill="#ffffff" opacity="0.85" />

        {/* Neck */}
        <path d="M20.5 29 L27.5 29 L27.5 35 Q24 39 20.5 35 Z" fill={ASSISTANT_SKIN} />

        {/* Ears and head */}
        <ellipse cx="15.6" cy="22.5" rx="1.6" ry="2.2" fill={ASSISTANT_SKIN} />
        <ellipse cx="32.4" cy="22.5" rx="1.6" ry="2.2" fill={ASSISTANT_SKIN} />
        <ellipse cx="24" cy="21.5" rx="8.5" ry="9.2" fill={ASSISTANT_SKIN} />

        {/* Side-swept fringe */}
        <path d="M15.4 20 Q15.5 12.2 24 12.2 Q32.6 12.2 32.6 20 Q30 15.5 25 16.2 Q20 17 15.4 20 Z" fill={ASSISTANT_HAIR} />

        {/* Brows, eyes, cheeks, smile */}
        <path d="M18.4 18.6 Q20 17.7 21.6 18.4 M26.4 18.4 Q28 17.7 29.6 18.6" stroke={ASSISTANT_HAIR} strokeWidth="0.9" strokeLinecap="round" />
        <circle cx="20" cy="21.6" r="1.15" fill="#1a1a1a" />
        <circle cx="28" cy="21.6" r="1.15" fill="#1a1a1a" />
        <circle cx="18.6" cy="25" r="1.6" fill="#e8737a" opacity="0.35" />
        <circle cx="29.4" cy="25" r="1.6" fill="#e8737a" opacity="0.35" />
        <path d="M20.2 25.4 Q24 29.4 27.8 25.4" stroke="#5a2a20" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
