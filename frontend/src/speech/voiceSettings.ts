// Persisted interviewer voice preferences (on/off, speed, and Kokoro voice).

export const KOKORO_VOICES = [
  { id: "af_heart", name: "Heart", description: "Warm · American" },
  { id: "af_bella", name: "Bella", description: "Bright · American" },
  { id: "am_michael", name: "Michael", description: "Calm · American" },
  { id: "bf_emma", name: "Emma", description: "Friendly · British" },
  { id: "bm_george", name: "George", description: "Steady · British" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"];

export interface VoiceSettings {
  enabled: boolean;
  rate: number;
  voice: KokoroVoiceId;
}

const STORAGE_KEY = "branchpoint-voice-settings";
export const MIN_VOICE_RATE = 0.8;
export const MAX_VOICE_RATE = 1.3;
const DEFAULTS: VoiceSettings = { enabled: true, rate: 1, voice: "af_heart" };

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    const rate = Number(parsed.rate);
    const voice = KOKORO_VOICES.find((v) => v.id === parsed.voice)?.id;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      rate: Number.isFinite(rate)
        ? Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, rate))
        : DEFAULTS.rate,
      voice: voice ?? DEFAULTS.voice,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveVoiceSettings(settings: VoiceSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}
