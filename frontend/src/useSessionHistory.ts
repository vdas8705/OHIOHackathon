import { useCallback, useState } from "react";
import type { SavedSession, SessionReview } from "./types";

const STORAGE_KEY = "branchpoint-sessions";

// In-memory fallback when sessionStorage is unavailable
let memoryStore: SavedSession[] = [];

function readStore(): SavedSession[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSession[];
  } catch {
    return memoryStore;
  }
}

function writeStore(sessions: SavedSession[]): void {
  memoryStore = sessions;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* sessionStorage unavailable — memory fallback is already set */
  }
}

export function useSessionHistory() {
  const [sessions, setSessions] = useState<SavedSession[]>(readStore);

  const saveSession = useCallback((session: SavedSession) => {
    setSessions((prev) => {
      // Replace if same id already exists, otherwise append
      const filtered = prev.filter((s) => s.id !== session.id);
      const next = [...filtered, session];
      writeStore(next);
      return next;
    });
  }, []);

  const updateReview = useCallback((sessionId: string, review: SessionReview) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId ? { ...s, review } : s
      );
      writeStore(next);
      return next;
    });
  }, []);

  const getSession = useCallback(
    (id: string) => sessions.find((s) => s.id === id) ?? null,
    [sessions]
  );

  return { sessions, saveSession, updateReview, getSession };
}
