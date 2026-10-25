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
| GET    | `/api/simulations/{id}/report`         | Fetch the weighted 100-point performance report.   |
| GET    | `/api/simulations/{id}/review`         | Per-question tutor-style review (legacy view).     |
| GET    | `/api/history`                         | List saved sessions (fixtures excluded by default).|
| GET    | `/api/history/{id}`                    | Read-only saved report + transcript (no AI re-run).|
| GET    | `/api/history-trends`                  | Cross-session trends (fixtures excluded by default).|
| DELETE | `/api/history/{id}`                    | Delete one saved session (dev-reset, gated).       |
| POST   | `/api/history/clear`                   | Clear all saved sessions (requires `confirm:true`).|

Interactive docs are available at `http://127.0.0.1:8000/docs`.

### Session origin & keeping test data out of history

Every saved session records an **origin** so synthetic data never shows up as real
performance:

- `user_demo` — a real user ran it in demo mode (legitimate; shown in history and analytics).
- `user_live` — a real user ran it with live AI.
- `test_fixture` — synthetic (verification scripts / manual API testing). **Excluded** from
  `/api/history` and `/api/history-trends` by default; pass `?include_fixtures=true` to see them.
- `unknown` — rows that predate origin tracking. Preserved and shown (we never guess origin from
  the score), but you can delete them with the Clear History controls.

To create a session without polluting real history (e.g. a demo-rehearsal or a smoke test),
send the header `X-BranchPoint-Fixture: true` on `POST /api/simulations`. The resulting session
is tagged `test_fixture` and stays out of the user-facing history and charts. Automated pytest
runs use an isolated temp DB (`tests/conftest.py` sets `BRANCHPOINT_DB`), so they never touch
`branchpoint.db` at all.

### Clearing history before a demo

The **Past Sessions** page has a **Clear history** button (and a per-session trash icon). Both
pop a confirmation dialog explaining exactly what will be permanently deleted, then call the
backend. Deletion touches only the `sessions` table — never code, scenario templates, or API
config — and the list/charts refresh immediately with an empty state. The destructive endpoints
are gated by `_destructive_enabled()` (on in demo mode, or when `BRANCHPOINT_ALLOW_RESET=1`), so
a public live deployment without the flag can't expose them. Nothing is ever deleted
automatically on startup.

### Scoring, classification, and weakness detection

- **Weighted score (restored).** The overall score is out of 100, computed by backend code as
  the sum of five competency scores: Technical reasoning (30), Decision-making and risk
  assessment (25), Adaptability (20), Communication and explanation (15), Clarifying questions
  and information gathering (10). The results dashboard shows a Recharts radar of these five
  dimensions normalized to a percentage of their maximum, with the raw point values alongside.
  Round feedback is qualitative (Strong / Developing / Needs Improvement), not correct/incorrect.
- **Question classification.** Every question is classified into a controlled taxonomy (ten
  primary types) with optional secondary types. Live mode asks the LLM and validates every
  returned label against the allowed list; demo mode uses predefined per-round metadata.
- **Per-question indicator.** A separate 0–100 indicator is computed per question for weakness
  detection only. It never affects the weighted 100-point score.
- **Weakness detection.** Single-session analysis distinguishes *observed* weaknesses (supported
  by evidence) from *potential* observations (e.g. only one question of a type). Cross-session
  trends require at least three scored questions of a type across two or more sessions before
  calling something a recurring weakness, and aggregate by primary type only (no double-counting
  secondary labels). Trends are computed only from real stored data; with fewer than two sessions
  the UI explicitly says there isn't enough data yet.

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

The `test_scoring_and_history.py` suite additionally covers the restored weighted scoring
(scores out of 100, correct 30/25/20/15/10 weights, categories summing to the total), removal of
binary correct/incorrect labels, question classification validated against the approved taxonomy,
per-question indicators kept separate from the weighted score, weakness detection using real data
(a single poor answer is a *potential* observation, not a recurring weakness), aggregation by
primary type only, all questions/responses/clarifications stored correctly, persistence surviving
a simulated restart, reopening saved sessions, cross-session trends requiring at least two
sessions, legacy reports handled safely, and demo/live schema compatibility. Live-model behavior
(real LLM scenario generation, classification, and evaluation) can't be tested without an API key
and is exercised via the deterministic demo/fallback paths; the structure and validation around
LLM output are tested, the live model output quality is not.

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

- **Active sessions are in memory; completed sessions are persisted.** A session in progress
  lives in memory, but once a session finishes (completed, timed out, or ended early) its full
  report and transcript are written to SQLite (`backend/branchpoint.db`) and survive restarts.
- **History is a LOCAL, SINGLE-USER feature.** There is no authentication. The `/api/history*`
  endpoints are not safe for a shared, multi-user deployment — anyone who can reach the backend
  can read all saved sessions. Treat history as a single-user local tool. To change the DB
  location, set the `BRANCHPOINT_DB` environment variable.
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
