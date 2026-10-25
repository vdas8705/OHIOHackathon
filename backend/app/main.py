"""FastAPI application exposing the BranchPoint simulation API."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
)
from .storage import HistoryStore
from .trends import compute_trends

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
def create_simulation(req: CreateSimulationRequest) -> SimulationStateResponse:
    try:
        session = engine.create_session(
            company=req.company.strip(),
            job_title=req.job_title.strip(),
            job_description=req.job_description.strip(),
            company_info=req.company_info.strip(),
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
# Persistent session history (LOCAL, SINGLE-USER MVP — see README/storage.py).
# --------------------------------------------------------------------------- #
@app.get("/api/history")
def history_list() -> dict:
    """List completed sessions saved to disk (survives backend restarts)."""
    return {"sessions": store.list_sessions()}


@app.get("/api/history/{session_id}")
def history_detail(session_id: str) -> dict:
    """Read-only historical record. Does NOT rerun the AI."""
    data = store.get_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Saved session not found")
    return data


@app.get("/api/history-trends")
def history_trends() -> dict:
    """Cross-session trend analysis computed only from stored results."""
    return compute_trends(store.get_all_reports())
