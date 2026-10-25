import { useCallback, useEffect, useState } from "react";
import {
  THEMES,
  DEFAULT_THEME_ID,
  DEFAULT_DARK_THEME_ID,
  type Theme,
} from "./themes";

const STORAGE_KEY = "branchpoint-theme";

function getInitialThemeId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.find((t) => t.id === saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  // Fall back to light theme if system prefers light
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return DEFAULT_THEME_ID; // warm-light
  }
  return DEFAULT_DARK_THEME_ID; // midnight
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Smooth transition on all color properties
  root.style.setProperty("transition", "background 0.2s ease, color 0.2s ease");
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }
  root.style.setProperty("color-scheme", theme.vars["--color-scheme"] ?? "dark");
}

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(getInitialThemeId);

  // Apply on mount and whenever themeId changes
  useEffect(() => {
    const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* storage unavailable */
    }
  }, [themeId]);

  const selectTheme = useCallback((id: string) => {
    setThemeId(id);
  }, []);

  return { themeId, selectTheme, themes: THEMES };
}
