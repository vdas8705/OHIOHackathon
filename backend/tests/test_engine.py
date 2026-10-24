"""Tests for the deterministic simulation engine (demo mode).

Covers the success criteria from the specification, section 16.
"""
import pytest

from app.config import Settings
from app.engine import Engine
from app.models import (
    MAX_ACTIVE_SECONDS,
    MAX_CLARIFICATIONS_PER_ROUND,
    RESPONSE_SECONDS_PER_ROUND,
    TOTAL_ROUNDS,
    CompletionStatus,
    ScenarioBlueprint,
    StateDelta,
)


def demo_settings() -> Settings:
    s = Settings()
    s.llm_provider = "demo"
    s.openai_api_key = ""
    return s


def new_engine() -> Engine:
    return Engine(demo_settings())


def make_session(engine: Engine):
    return engine.create_session(
        company="Acme",
        job_title="Cloud Hardware Development Engineer",
        job_description="Design and validate server hardware, debug thermal issues.",
        company_info="",
    )


STRONG = (
    "I would isolate the failing nodes and control variables one at a time, logging "
    "per-component temperature data to validate each hypothesis. Because risk is high I would "
    "compare against passing nodes, verify sensors, and communicate the trade-offs to "
    "stakeholders before committing to a plan to confirm the root cause."
)


def play_full(engine: Engine, session, response=STRONG):
    for r in range(1, TOTAL_ROUNDS + 1):
        engine.respond(
            session,
            round_number=r,
            response=response,
            timed_out=False,
            elapsed_active_seconds=30,
        )
    return session


# 1. A simulation always ends after five completed decision rounds.
def test_ends_after_five_rounds():
    engine = new_engine()
    session = make_session(engine)
    play_full(engine, session)
    assert session.completion_status == CompletionStatus.COMPLETED
    assert session.completed_rounds == TOTAL_ROUNDS
    assert session.report_ready


# 2. No sixth round can be generated.
def test_no_sixth_round():
    engine = new_engine()
    session = make_session(engine)
    play_full(engine, session)
    assert session.current_turn is None
    # Attempting another respond is idempotent and does not advance.
    engine.respond(session, round_number=5, response="late", timed_out=False, elapsed_active_seconds=5)
    assert session.completed_rounds == TOTAL_ROUNDS
    assert len(session.decision_history) == TOTAL_ROUNDS


# 3. A 90-second response timeout advances appropriately (empty counts as a round).
def test_timeout_advances_with_empty_answer():
    engine = new_engine()
    session = make_session(engine)
    engine.respond(
        session, round_number=1, response="", timed_out=True,
        elapsed_active_seconds=RESPONSE_SECONDS_PER_ROUND,
    )
    assert session.current_round == 2
    assert session.decision_history[0].timed_out is True
    assert session.decision_history[0].response == ""


# 4. The 10-minute cumulative active-time cap terminates the session.
def test_global_timeout_terminates():
    engine = new_engine()
    session = make_session(engine)
    # Each round contributes the per-round cap; after enough rounds we hit the global cap.
    # 90s * 5 = 450 < 600, so the session should complete at round 5 normally. To force the
    # global cap, inflate the active time on an early round.
    session.elapsed_active_seconds = MAX_ACTIVE_SECONDS - 10
    engine.respond(
        session, round_number=1, response=STRONG, timed_out=False, elapsed_active_seconds=90
    )
    assert session.elapsed_active_seconds >= MAX_ACTIVE_SECONDS
    assert session.completion_status == CompletionStatus.TIMED_OUT
    assert session.current_round == 1  # never advanced past the cap
    assert session.report_ready


# 5. Clarification exchanges do not increment the round number.
def test_clarify_does_not_advance_round():
    engine = new_engine()
    session = make_session(engine)
    before = session.current_round
    answer, used = engine.clarify(session, round_number=1, question="What's the ambient temp?")
    assert session.current_round == before
    assert used == 1
    answer2, used2 = engine.clarify(session, round_number=1, question="And the lot?")
    assert used2 == 2
    # Third clarification is capped and does not increment beyond the max.
    _, used3 = engine.clarify(session, round_number=1, question="More?")
    assert used3 == MAX_CLARIFICATIONS_PER_ROUND
    assert session.current_round == before


# 6. Invalid LLM output cannot corrupt simulation state (deltas are clamped).
def test_state_delta_clamped():
    d = StateDelta(technical_stability=9999, risk_level=-9999, stakeholder_confidence=500, progress=-500)
    assert d.technical_stability == 40
    assert d.risk_level == -40
    assert d.stakeholder_confidence == 40
    assert d.progress == -40


def test_blueprint_requires_five_stages():
    from app.demo_content import demo_blueprint
    bp = demo_blueprint().model_dump()
    bp["stages"] = bp["stages"][:4]
    with pytest.raises(Exception):
        ScenarioBlueprint.model_validate(bp)


# 7. Category scores sum correctly to the overall score.
def test_scores_sum_to_overall():
    engine = new_engine()
    session = make_session(engine)
    play_full(engine, session)
    report = session.final_report
    assert report is not None
    assert sum(c.score for c in report.categories) == report.overall_score
    for c in report.categories:
        assert c.score <= c.max_score
    assert report.overall_score <= report.max_score == 100


# 8. Sessions cannot receive duplicate / out-of-order round submissions.
def test_duplicate_submission_rejected():
    engine = new_engine()
    session = make_session(engine)
    engine.respond(session, round_number=1, response=STRONG, timed_out=False, elapsed_active_seconds=30)
    # Round is now 2; submitting round 1 again must raise.
    with pytest.raises(ValueError):
        engine.respond(session, round_number=1, response="dup", timed_out=False, elapsed_active_seconds=5)


# 9. The final report references actual candidate responses.
def test_report_references_responses():
    engine = new_engine()
    session = make_session(engine)
    unique = "I will recalibrate the thermal sensors using a ground-truth probe comparison."
    play_full(engine, session, response=unique)
    report = session.final_report
    joined = " ".join(r.response for r in report.round_reports)
    assert unique in joined


# 10. Supports a job description different from the default demo role.
def test_supports_different_job():
    engine = new_engine()
    session = engine.create_session(
        company="Globex",
        job_title="Business Analyst",
        job_description="Reconcile conflicting stakeholder requirements and define process KPIs.",
        company_info="",
    )
    assert session.current_turn is not None
    assert session.current_round == 1
    # In demo mode the demo blueprint is used, but the session still runs end to end.
    play_full(engine, session)
    assert session.completion_status == CompletionStatus.COMPLETED


# 12. Early termination produces an accurate partial report.
def test_early_termination_partial_report():
    engine = new_engine()
    session = make_session(engine)
    engine.respond(session, round_number=1, response=STRONG, timed_out=False, elapsed_active_seconds=30)
    engine.respond(session, round_number=2, response=STRONG, timed_out=False, elapsed_active_seconds=30)
    engine.finish_early(session)
    report = session.final_report
    assert report.completion_status == CompletionStatus.ENDED_EARLY
    assert report.rounds_attempted == 2
    assert report.completion_percentage == 40
    assert len(report.round_reports) == 2


def test_environment_stays_in_bounds():
    engine = new_engine()
    session = make_session(engine)
    play_full(engine, session)
    env = session.environment
    for v in (env.technical_stability, env.risk_level, env.stakeholder_confidence, env.progress):
        assert 0 <= v <= 100
