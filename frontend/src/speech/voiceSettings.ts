// Persisted interviewer voice preferences (on/off and overall speed).

export interface VoiceSettings {
  enabled: boolean;
  rate: number;
}

const STORAGE_KEY = "branchpoint-voice-settings";
export const MIN_VOICE_RATE = 0.75;
export const MAX_VOICE_RATE = 1.5;
const DEFAULTS: VoiceSettings = { enabled: true, rate: 1 };

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    const rate = Number(parsed.rate);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      rate: Number.isFinite(rate)
        ? Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, rate))
        : DEFAULTS.rate,
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
