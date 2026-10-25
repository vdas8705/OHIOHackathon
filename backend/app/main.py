"""FastAPI application exposing the BranchPoint simulation API."""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_settings
from .demo_content import (
    DEMO_COMPANY,
    DEMO_COMPANY_INFO,
    DEMO_EXAMPLE_RESPONSES,
    DEMO_JOB_DESCRIPTION,
    DEMO_JOB_TITLE,
)
from .engine import Engine, Session
from .models import (
    ClarifyRequest,
    ClarifyResponse,
    CreateSimulationRequest,
    FetchJobRequest,
    FetchJobResponse,
    InterpretRequest,
    InterpretResponse,
    PublicScenario,
    QuestionReview,
    RespondRequest,
    RespondResponse,
    SessionReview,
    SimulationStateResponse,
    Walkthrough,
    WalkthroughAskRequest,
    WalkthroughAskResponse,
    WalkthroughFollowup,
)
from .storage import HistoryStore
from .trends import compute_trends
from .walkthrough import answer_followup, build_walkthrough

import threading

settings = get_settings()
store = HistoryStore()
engine = Engine(settings, store=store)

app = FastAPI(title="BranchPoint API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _public_scenario(session: Session) -> PublicScenario:
    bp = session.blueprint
    return PublicScenario(
        scenario_title=bp.scenario_title,
        target_role=bp.target_role,
        challenge_summary=bp.challenge_summary,
        initial_context=bp.initial_context,
        stakeholders=bp.stakeholders,
    )


def _state(session: Session) -> SimulationStateResponse:
    return SimulationStateResponse(
        session_id=session.session_id,
        company=session.company,
        job_title=session.job_title,
        scenario=_public_scenario(session),
        current_round=session.current_round,
        completion_status=session.completion_status,
        elapsed_active_seconds=session.elapsed_active_seconds,
        clarifications_used_this_round=session.clarifications_this_round,
        current_turn=session.current_turn,
        is_demo=session.is_demo,
        report_ready=session.report_ready,
    )


def _require(session_id: str) -> Session:
    session = engine.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/health")
def health() -> dict:
    model = None
    if not engine.demo_mode:
        provider = settings.llm_provider
        if provider == "anthropic":
            model = settings.anthropic_model
        elif provider == "gemini":
            model = settings.gemini_model
        else:
            model = settings.openai_model
    return {
        "status": "ok",
        "demo_mode": engine.demo_mode,
        "model": model,
    }


@app.get("/api/demo-sample")
def demo_sample() -> dict:
    """One-click sample inputs for the setup form."""
    return {
        "company": DEMO_COMPANY,
        "job_title": DEMO_JOB_TITLE,
        "job_description": DEMO_JOB_DESCRIPTION,
        "company_info": DEMO_COMPANY_INFO,
        "website_url": "",
        "example_responses": DEMO_EXAMPLE_RESPONSES,
    }


@app.post("/api/fetch-job", response_model=FetchJobResponse)
async def fetch_job(req: FetchJobRequest) -> FetchJobResponse:
    """Fetch a job posting URL and extract structured fields using the LLM."""
    if engine.demo_mode or not engine.llm.available:
        raise HTTPException(
            status_code=503,
            detail="Job URL extraction requires a live LLM — no API key is configured.",
        )
    try:
        import asyncio
        from .llm import LLMError
        # Run the blocking LLM call in a thread pool so it doesn't block the event loop
        result = await asyncio.get_event_loop().run_in_executor(
            None, engine.llm.fetch_job, req.url
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return FetchJobResponse(**result)


@app.post("/api/simulations", response_model=SimulationStateResponse)
def create_simulation(
    req: CreateSimulationRequest,
    x_branchpoint_fixture: Optional[str] = Header(default=None),
) -> SimulationStateResponse:
    # Scripts and automated/manual verification can set this header so the
    # resulting session is recorded as a synthetic fixture and excluded from
    # user-facing analytics. Normal UI traffic never sends it.
    is_fixture = str(x_branchpoint_fixture or "").strip().lower() in ("1", "true", "yes")
    try:
        session = engine.create_session(
            company=req.company.strip(),
            job_title=req.job_title.strip(),
            job_description=req.job_description.strip(),
            company_info=req.company_info.strip(),
            is_fixture=is_fixture,
        )
    except Exception as e:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Failed to create simulation: {e}")
    return _state(session)


@app.get("/api/simulations/{session_id}", response_model=SimulationStateResponse)
def get_simulation(session_id: str) -> SimulationStateResponse:
    return _state(_require(session_id))


@app.post("/api/simulations/{session_id}/respond", response_model=RespondResponse)
def respond(session_id: str, req: RespondRequest) -> RespondResponse:
    session = _require(session_id)
    try:
        engine.respond(
            session,
            round_number=req.round_number,
            response=req.response.strip(),
            timed_out=req.timed_out,
            elapsed_active_seconds=req.elapsed_active_seconds,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return RespondResponse(state=_state(session))


@app.post("/api/simulations/{session_id}/interpret", response_model=InterpretResponse)
def interpret(session_id: str, req: InterpretRequest) -> InterpretResponse:
    """Neutral restatement of the candidate's answer before grading."""
    session = _require(session_id)
    if not session.is_active:
        raise HTTPException(status_code=409, detail="Session is not active")
    if req.round_number != session.current_round:
        raise HTTPException(status_code=409, detail="Interpretation must target the current round")
    question = session.current_turn.question if session.current_turn else ""
    try:
        if session.is_demo or not engine.llm.available:
            # Simple heuristic restatement in demo mode
            text = req.response.strip() if req.response.strip() else "(no answer provided)"
            interpretation = f"Here's how I understood your answer: you said {text[:200]}. Did I get that right?"
        else:
            interpretation = engine.llm.interpret(question, req.response)
    except Exception as exc:
        # Fallback: simple restatement
        text = req.response.strip() if req.response.strip() else "(no answer provided)"
        interpretation = f"Here's how I understood your answer: {text[:200]}. Did I get that right?"
    return InterpretResponse(interpretation=interpretation)


@app.post("/api/simulations/{session_id}/clarify", response_model=ClarifyResponse)
def clarify(session_id: str, req: ClarifyRequest) -> ClarifyResponse:
    session = _require(session_id)
    try:
        answer, used = engine.clarify(session, req.round_number, req.question.strip())
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return ClarifyResponse(answer=answer, clarifications_used_this_round=used)


@app.post("/api/simulations/{session_id}/finish", response_model=SimulationStateResponse)
def finish(session_id: str) -> SimulationStateResponse:
    session = _require(session_id)
    engine.finish_early(session)
    return _state(session)


@app.get("/api/simulations/{session_id}/report")
def report(session_id: str) -> dict:
    session = _require(session_id)
    if session.final_report is None:
        raise HTTPException(status_code=409, detail="Report not ready")
    return session.final_report.model_dump()


@app.get("/api/simulations/{session_id}/review", response_model=SessionReview)
def review(session_id: str) -> SessionReview:
    session = _require(session_id)
    if session.final_report is None:
        raise HTTPException(status_code=409, detail="Report not ready")
    return engine.generate_review(session)


# --------------------------------------------------------------------------- #
# Spoken results walkthrough. Works for live sessions and saved ones, because
# it is derived only from the persisted report.
# --------------------------------------------------------------------------- #
_walkthrough_locks: dict[str, threading.Lock] = {}
_walkthrough_locks_guard = threading.Lock()
# Fallback cache for sessions that aren't in the history store.
_walkthrough_cache: dict[str, dict] = {}


def _walkthrough_lock(session_id: str) -> threading.Lock:
    with _walkthrough_locks_guard:
        return _walkthrough_locks.setdefault(session_id, threading.Lock())


def _report_for(session_id: str) -> tuple[dict, bool]:
    """Return (report dict, is_demo) from the live session or the saved history."""
    session = engine.get(session_id)
    if session is not None and session.final_report is not None:
        return session.final_report.model_dump(), session.is_demo
    saved = store.get_report(session_id)
    if saved is None:
        raise HTTPException(status_code=404, detail="Results not found for this session")
    return saved["report"], bool(saved["report"].get("is_demo"))


def _load_walkthrough(session_id: str) -> Optional[dict]:
    return store.get_walkthrough(session_id) or _walkthrough_cache.get(session_id)


def _save_walkthrough(session_id: str, data: dict) -> None:
    _walkthrough_cache[session_id] = data
    try:
        store.save_walkthrough(session_id, data)
    except Exception:
        pass  # persistence is best-effort; the cache still serves this run


@app.post("/api/walkthrough/{session_id}", response_model=Walkthrough)
def walkthrough(session_id: str) -> Walkthrough:
    """Get (generating once if needed) the spoken walkthrough for a session's results."""
    with _walkthrough_lock(session_id):
        existing = _load_walkthrough(session_id)
        if existing:
            return Walkthrough(**existing)
        report, is_demo = _report_for(session_id)
        use_llm = (not is_demo) and engine.llm.available
        result = build_walkthrough(report, engine.llm, use_llm)
        _save_walkthrough(session_id, result.model_dump())
        return result


@app.post("/api/walkthrough/{session_id}/viewed", response_model=Walkthrough)
def walkthrough_viewed(session_id: str) -> Walkthrough:
    """Mark that the user actually went through the walkthrough (shown in Past Sessions)."""
    with _walkthrough_lock(session_id):
        existing = _load_walkthrough(session_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Walkthrough not generated yet")
        existing["viewed"] = True
        _save_walkthrough(session_id, existing)
        return Walkthrough(**existing)


@app.post("/api/walkthrough/{session_id}/ask", response_model=WalkthroughAskResponse)
def walkthrough_ask(session_id: str, req: WalkthroughAskRequest) -> WalkthroughAskResponse:
    """Answer a follow-up about one question, and save it with the walkthrough."""
    report, is_demo = _report_for(session_id)
    use_llm = (not is_demo) and engine.llm.available
    answer = answer_followup(report, req.round_number, req.question.strip(), engine.llm, use_llm)
    with _walkthrough_lock(session_id):
        existing = _load_walkthrough(session_id)
        if existing:
            existing.setdefault("followups", []).append(
                WalkthroughFollowup(
                    round_number=req.round_number, question=req.question.strip(), answer=answer
                ).model_dump()
            )
            _save_walkthrough(session_id, existing)
    return WalkthroughAskResponse(answer=answer)


# --------------------------------------------------------------------------- #
# Persistent session history (LOCAL, SINGLE-USER MVP — see README/storage.py).
# --------------------------------------------------------------------------- #
@app.get("/api/history")
def history_list(include_fixtures: bool = False) -> dict:
    """List completed sessions saved to disk (survives backend restarts).

    Synthetic test fixtures are excluded unless include_fixtures=true.
    """
    return {"sessions": store.list_sessions(include_fixtures=include_fixtures)}


@app.get("/api/history/{session_id}")
def history_detail(session_id: str) -> dict:
    """Read-only historical record. Does NOT rerun the AI."""
    data = store.get_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Saved session not found")
    return data


@app.get("/api/history-trends")
def history_trends(include_fixtures: bool = False) -> dict:
    """Cross-session trend analysis computed only from stored, non-fixture results."""
    return compute_trends(store.get_all_reports(include_fixtures=include_fixtures))


# --- Destructive: clear history (DEV-ONLY, gated) -------------------------- #
def _destructive_enabled() -> bool:
    """Guard: only allow destructive reset for local/dev use.

    Enabled when demo mode is on OR BRANCHPOINT_ALLOW_RESET=1. A publicly
    deployed live instance without the flag cannot expose this endpoint.
    """
    if os.getenv("BRANCHPOINT_ALLOW_RESET", "").strip() in ("1", "true", "yes"):
        return True
    return engine.demo_mode


class ClearHistoryRequest(BaseModel):
    confirm: bool = False
    include_fixtures: bool = True


@app.delete("/api/history/{session_id}")
def delete_history_session(session_id: str) -> dict:
    """Delete a single saved session. Requires the dev-reset guard."""
    if not _destructive_enabled():
        raise HTTPException(
            status_code=403,
            detail="History deletion is disabled on this instance.",
        )
    removed = store.delete_session(session_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Saved session not found")
    return {"deleted": 1, "session_id": session_id}


@app.post("/api/history/clear")
def clear_history(req: ClearHistoryRequest) -> dict:
    """Delete all locally stored sessions. Requires explicit confirmation.

    Development-only reset: guarded by _destructive_enabled(). Touches only the
    sessions table — never code, scenario templates, or API configuration.
    """
    if not _destructive_enabled():
        raise HTTPException(
            status_code=403,
            detail="History reset is disabled on this instance.",
        )
    if not req.confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirmation required: set confirm=true to clear history.",
        )
    count = store.clear_sessions(include_fixtures=req.include_fixtures)
    return {"deleted": count}
