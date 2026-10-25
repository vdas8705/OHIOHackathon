import type {
  ClarifyResponse,
  CreateSimulationInput,
  DemoSample,
  FetchJobResponse,
  HealthInfo,
  HistoryDetail,
  HistorySummary,
  HistoryTrends,
  InterpretResponse,
  PerformanceReport,
  SessionReview,
  SimulationState,
  Walkthrough,
  DecisionMap,
  DeliveryMetrics,
} from "./types";

// All requests go through Vite's /api proxy to the FastAPI backend.
const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthInfo>("/health"),

  demoSample: () => request<DemoSample>("/demo-sample"),

  fetchJob: (url: string) =>
    request<FetchJobResponse>("/fetch-job", {
      method: "POST",
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120_000), // 2 min for slow Gemini URL fetches
    }),

  createSimulation: (input: CreateSimulationInput) =>
    request<SimulationState>("/simulations", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getState: (sessionId: string) =>
    request<SimulationState>(`/simulations/${sessionId}`),

  respond: (
    sessionId: string,
    payload: {
      round_number: number;
      response: string;
      timed_out: boolean;
      elapsed_active_seconds: number;
      overtime_seconds?: number;
      delivery?: DeliveryMetrics;
    }
  ) =>
    request<{ state: SimulationState }>(`/simulations/${sessionId}/respond`, {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((r) => r.state),

  clarify: (sessionId: string, round_number: number, question: string) =>
    request<ClarifyResponse>(`/simulations/${sessionId}/clarify`, {
      method: "POST",
      body: JSON.stringify({ round_number, question }),
    }),

  finish: (sessionId: string) =>
    request<SimulationState>(`/simulations/${sessionId}/finish`, {
      method: "POST",
    }),

  report: (sessionId: string) =>
    request<PerformanceReport>(`/simulations/${sessionId}/report`),

  review: (sessionId: string) =>
    request<SessionReview>(`/simulations/${sessionId}/review`),

  interpret: (sessionId: string, round_number: number, response: string) =>
    request<InterpretResponse>(`/simulations/${sessionId}/interpret`, {
      method: "POST",
      body: JSON.stringify({ round_number, response }),
    }),

  // --- Spoken results walkthrough (generated once, saved with the session) ---
  walkthrough: (sessionId: string) =>
    request<Walkthrough>(`/walkthrough/${sessionId}`, { method: "POST" }),

  walkthroughViewed: (sessionId: string) =>
    request<Walkthrough>(`/walkthrough/${sessionId}/viewed`, { method: "POST" }),

  walkthroughAsk: (sessionId: string, round_number: number, question: string) =>
    request<{ answer: string }>(`/walkthrough/${sessionId}/ask`, {
      method: "POST",
      body: JSON.stringify({ round_number, question }),
    }),

  // --- "What if" decision map (generated once, saved with the session) ---
  decisionMap: (sessionId: string) =>
    request<DecisionMap>(`/decision-map/${sessionId}`, { method: "POST" }),

  // --- Persistent history (backend SQLite) ---
  historyList: () =>
    request<{ sessions: HistorySummary[] }>("/history").then((r) => r.sessions),

  historyDetail: (sessionId: string) =>
    request<HistoryDetail>(`/history/${sessionId}`),

  historyTrends: () => request<HistoryTrends>("/history-trends"),

  deleteHistorySession: (sessionId: string) =>
    request<{ deleted: number; session_id: string }>(`/history/${sessionId}`, {
      method: "DELETE",
    }),

  clearHistory: (includeFixtures = true) =>
    request<{ deleted: number }>("/history/clear", {
      method: "POST",
      body: JSON.stringify({ confirm: true, include_fixtures: includeFixtures }),
    }),
};
