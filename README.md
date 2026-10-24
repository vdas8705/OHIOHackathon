# BranchPoint

**Experience the interview before it happens.**

BranchPoint is a voice-first, AI-powered adaptive interview simulation. You paste a real job
description, and BranchPoint generates a realistic, role-specific professional scenario. You
then work through **five connected, timed rounds** — speaking your answers aloud — while the AI
interviewer introduces consequences and new complications based on your decisions. At the end
you get a detailed, evidence-backed performance report out of 100.

Unlike a generic chatbot or a trivia-style mock interviewer, BranchPoint runs a single evolving
scenario where your choices shape what happens next, then grades the demonstrated behavior.

---

## Why it's different

- **Voice-first conversation.** The interviewer speaks each development and question aloud
  (text-to-speech). When it finishes, your microphone activates automatically and your speech is
  transcribed live. Typing is always available as a fallback.
- **One evolving scenario.** Facts are fixed up front; each round develops the same situation
  rather than jumping to an unrelated question.
- **Deterministic length.** Exactly five rounds, 90 seconds each, a 10-minute cumulative active
  cap. The **backend** — not the LLM — owns the round number and termination.
- **Evidence-backed scoring.** Five rubric categories summing to 100, computed by backend code,
  with per-round review.

---

## Architecture

```
OHIOHackathon/
├── backend/                 FastAPI + Pydantic simulation engine
│   ├── app/
│   │   ├── main.py          HTTP routes (the API contract)
│   │   ├── engine.py        Deterministic simulation controller (source of truth)
│   │   ├── models.py        Pydantic models: scenario, state, report, requests
│   │   ├── llm.py           LLM service (OpenAI-compatible), isolated behind one class
│   │   ├── demo_content.py  Predefined scenario + deterministic demo/fallback behavior
│   │   └── config.py        Env-based settings (decides demo vs. live)
│   └── tests/               pytest suite covering the spec's success criteria
├── frontend/                React + TypeScript + Vite + Tailwind
│   └── src/
│       ├── views/           Landing, Setup, Interview (voice loop), Results (dashboard)
│       ├── speech/          Speech services behind reusable interfaces + React hooks
│       ├── components/      UI primitives and voice controls
│       ├── api.ts           Typed client for the backend
│       └── types.ts         TS mirror of the backend contracts
├── scripts/                 run-backend.sh / run-frontend.sh helpers
├── .env.example             Copy to backend/.env to enable live AI
└── .toolchain/              Locally downloaded Node runtime (this machine had no Node)
```

**Request flow:** React → `/api/*` (Vite dev proxy) → FastAPI. The backend validates every
round submission, applies bounded state transitions, and controls completion. The LLM only
*proposes* narrative and deltas; the backend clamps and validates everything.

### Key design choices

- **The LLM never controls simulation logic.** Round number, timing, and completion are owned by
  `engine.py`. LLM outputs are validated with Pydantic; invalid output falls back to a safe,
  predefined development so the demo never breaks.
- **Speech is behind interfaces** (`frontend/src/speech/types.ts`). The browser implementation
  can be swapped for a cloud STT/TTS provider without touching the UI.
- **Never overlap** interviewer audio and recording. The response timer starts only after speech
  playback completes.

---

## Setup

### Prerequisites

- **Python 3.10+** (tested on 3.14)
- **Node.js 18+** — if Node isn't installed, a local copy was downloaded to `.toolchain/` and the
  `scripts/run-frontend.sh` helper uses it automatically.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Or just: `./scripts/run-backend.sh`

The backend runs at `http://127.0.0.1:8000`. Check `http://127.0.0.1:8000/api/health` to see
whether it's in demo or live mode.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Or just: `./scripts/run-frontend.sh`

Open **http://localhost:5173**. The Vite dev server proxies `/api` to the backend, so no CORS
configuration is needed in development.

---

## Environment variables

BranchPoint runs **without any API key** in a clearly labeled **demo mode**. To enable live AI,
copy `.env.example` to `backend/.env` and fill in the values:

| Variable             | Required | Default                       | Purpose                                             |
| -------------------- | -------- | ----------------------------- | --------------------------------------------------- |
| `OPENAI_API_KEY`     | For live | _(empty → demo mode)_         | API key for scenario generation, turns, evaluation. |
| `OPENAI_MODEL`       | No       | `gpt-4o-mini`                 | Chat model to use.                                  |
| `OPENAI_BASE_URL`    | No       | `https://api.openai.com/v1`   | Override for OpenAI-compatible providers.           |
| `LLM_PROVIDER`       | No       | `openai`                      | Set to `demo` to force demo mode.                   |
| `LLM_TIMEOUT_SECONDS`| No       | `45`                          | Bounded timeout per LLM call.                       |
| `LLM_MAX_RETRIES`    | No       | `2`                           | Retries on malformed JSON output.                   |
| `CORS_ORIGINS`       | No       | `http://localhost:5173,...`   | Allowed frontend origins (for non-proxy setups).    |

**As soon as a valid `OPENAI_API_KEY` is present in `backend/.env`, the app automatically uses
live AI** for scenario generation, interviewer turns, response analysis, and the final
evaluation. No code changes needed — restart the backend to pick up the new `.env`.

The key is only ever read on the backend. It is never exposed to the frontend; all LLM calls go
through backend routes.

---

## Demo mode

When no API key is configured, BranchPoint uses a built-in, deterministic scenario — a **Cloud
Hardware Development Engineer** facing a thermal anomaly during server validation — with:

- A full five-round narrative
- Deterministic consequences keyed to a heuristic quality classification of your answers
- A deterministic, evidence-based performance report

Demo mode is clearly labeled in the UI (an amber "Demo mode" badge on every screen and in the
report). On the setup form, **"Fill with sample role"** populates the demo job in one click so
judges can start immediately.

Demo mode is also the automatic **fallback** for any individual LLM call that fails or returns
invalid output in live mode, so a live demo stays reliable even if the model misbehaves.

---

## API

| Method | Path                                   | Purpose                                            |
| ------ | -------------------------------------- | -------------------------------------------------- |
| GET    | `/api/health`                          | Status + whether demo mode is active.              |
| GET    | `/api/demo-sample`                     | Sample inputs for one-click form fill.             |
| POST   | `/api/simulations`                     | Create a session; returns round 1.                 |
| GET    | `/api/simulations/{id}`                | Current candidate-facing state.                    |
| POST   | `/api/simulations/{id}/respond`        | Submit a round response; advances the simulation.  |
| POST   | `/api/simulations/{id}/clarify`        | Ask a clarifying question (does not advance round).|
| POST   | `/api/simulations/{id}/finish`         | End early and generate a partial report.           |
| GET    | `/api/simulations/{id}/report`         | Fetch the performance report.                      |

Interactive docs are available at `http://127.0.0.1:8000/docs`.

---

## Testing

The backend test suite covers the specification's success criteria (section 16):

```bash
cd backend
LLM_PROVIDER=demo .venv/bin/python -m pytest
```

Covered: five-round termination, no sixth round, timeout advancing a round, the 10-minute cap,
clarifications not incrementing the round, invalid LLM deltas being clamped, category scores
summing to the overall, duplicate-submission rejection, reports referencing real responses,
support for non-default job descriptions, the text fallback, and accurate early-termination
reports.

Type-check / build the frontend:

```bash
cd frontend && npm run build
```

---

## Voice support & browser notes

- Interviewer speech uses the browser **SpeechSynthesis** API.
- Candidate speech uses the browser **SpeechRecognition** API (best support in Chrome/Edge;
  Safari support is partial).
- If speech recognition is unavailable or the microphone is denied, the UI shows a clear status
  and you can **type** your answer — the full flow still works.
- The interviewer audio and the microphone are never active at the same time; the 90-second
  response timer starts only after the interviewer finishes speaking.
- Mute controls are provided for both the interviewer audio and the microphone.

---

## Known limitations

- **Session storage is in-memory.** Restarting the backend clears active sessions. This is
  intentional for the MVP; swap in JSON or a database for persistence.
- **Website URL is informational only.** No live web retrieval is performed for the MVP.
- **Browser speech varies.** Quality and availability of TTS voices and recognition depend on the
  browser/OS. Chrome/Edge give the most reliable experience.
- **In live mode**, scenario quality depends on the model. Malformed outputs fall back to the
  safe predefined development, which may be less tailored than a successful live generation.
- **Not a hiring prediction.** Scores reflect demonstrated practice performance only.

---

## Definition of done — status

A user can open BranchPoint, enter a company/title/job description, start an AI-generated,
job-specific scenario, answer five connected timed situational questions by voice or text,
experience plausible consequences, reach a deterministic end, and receive a detailed,
evidence-backed report out of 100 with a round-by-round review. Verified end-to-end in demo mode;
live mode activates automatically when an API key is provided.
