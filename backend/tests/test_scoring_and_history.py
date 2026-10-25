"""Tests for restored weighted scoring, classification, weakness detection,
persistence, and cross-session trends (demo mode)."""
import os
import tempfile

import pytest

from app.config import Settings
from app.engine import Engine
from app.models import QUESTION_TYPES, TOTAL_ROUNDS, normalize_question_type
from app.storage import HistoryStore
from app.trends import compute_trends


def demo_settings() -> Settings:
    s = Settings()
    s.llm_provider = "demo"
    s.openai_api_key = ""
    return s


STRONG = (
    "I would isolate the failing nodes and control variables one at a time, logging data to "
    "validate each hypothesis because the risk is high. I would verify sensors against ground "
    "truth and communicate trade-offs to stakeholders before committing to confirm the cause."
)
WEAK = "no idea"


def play(engine, session, response=STRONG):
    for r in range(1, TOTAL_ROUNDS + 1):
        engine.respond(
            session, round_number=r, response=response, timed_out=False,
            elapsed_active_seconds=30,
        )
    return session.final_report


def new_engine(store=None) -> Engine:
    return Engine(demo_settings(), store=store)


def make(engine):
    return engine.create_session(
        company="Amazon", job_title="Cloud HW Eng",
        job_description="validate server hardware; thermal analysis", company_info="",
    )


# 1. Overall scores are out of 100.
def test_overall_out_of_100():
    rep = play(new_engine(), make(new_engine()))
    # rebuild cleanly to avoid cross-engine confusion
    e = new_engine(); rep = play(e, make(e))
    assert rep.max_score == 100
    assert 0 <= rep.overall_score <= 100


# 2 + 3. Five weighted competencies, correct weights, sum to total.
def test_weighted_categories_sum():
    e = new_engine(); rep = play(e, make(e))
    expected = {
        "Technical reasoning": 30,
        "Decision-making and risk assessment": 25,
        "Adaptability": 20,
        "Communication and explanation": 15,
        "Clarifying questions and information gathering": 10,
    }
    assert len(rep.categories) == 5
    for c in rep.categories:
        assert c.max_score == expected[c.name]
        assert c.score <= c.max_score
    assert sum(c.score for c in rep.categories) == rep.overall_score


# 5. No correct/incorrect binary labels on round reports.
def test_no_binary_labels():
    e = new_engine(); rep = play(e, make(e))
    allowed = {"Strong", "Developing", "Needs Improvement", "Not attempted"}
    for rr in rep.round_reports:
        assert rr.performance_level in allowed
        # Non-binary qualitative fields exist.
        assert hasattr(rr, "what_went_well")
        assert rr.question_type  # classified


# 12. Question categories validated against the approved taxonomy.
def test_classification_in_taxonomy():
    e = new_engine(); rep = play(e, make(e))
    for rr in rep.round_reports:
        assert rr.question_type in QUESTION_TYPES
        for s in rr.secondary_types:
            assert s in QUESTION_TYPES


def test_normalize_question_type():
    assert normalize_question_type("Technical troubleshooting") == "Technical troubleshooting"
    assert normalize_question_type("technical troubleshooting") == "Technical troubleshooting"
    assert normalize_question_type("total nonsense xyz") is None


# 13 + 14. Weakness detection uses real data; one question != recurring weakness.
def test_weakness_single_question_is_potential():
    e = new_engine(); rep = play(e, make(e), response=WEAK)
    # Each type appears once -> any type-based weakness must be 'potential'.
    type_weaknesses = [w for w in rep.weaknesses if w.label in QUESTION_TYPES]
    assert type_weaknesses, "weak answers should surface some weakness"
    for w in type_weaknesses:
        assert w.kind == "potential"


def test_strong_run_has_few_weaknesses():
    e = new_engine(); rep = play(e, make(e), response=STRONG)
    # A strong run should not flag observed competency weaknesses.
    observed = [w for w in rep.weaknesses if w.kind == "observed"]
    assert len(observed) == 0


# Per-question performance indicators exist and are 0..100, not the final score.
def test_question_performance_indicators():
    e = new_engine(); rep = play(e, make(e))
    assert len(rep.question_performance) == TOTAL_ROUNDS
    for qp in rep.question_performance:
        assert 0 <= qp.indicator <= 100
        assert qp.question_type in QUESTION_TYPES


# Aggregation does not double-count secondary labels (by primary type only).
def test_aggregation_by_primary_only():
    e = new_engine(); rep = play(e, make(e))
    total_counted = sum(s.count for s in rep.question_type_stats)
    assert total_counted == TOTAL_ROUNDS  # each round counted exactly once


# 6 + 8. All questions stored, responses match their questions.
def test_questions_and_responses_stored():
    e = new_engine(); s = make(e)
    marker = "RECALIBRATE-SENSORS-UNIQUE"
    for r in range(1, TOTAL_ROUNDS + 1):
        e.respond(s, round_number=r, response=f"{marker} round {r} {STRONG}",
                  timed_out=False, elapsed_active_seconds=20)
    rep = s.final_report
    assert len(rep.round_reports) == TOTAL_ROUNDS
    for rr in rep.round_reports:
        assert rr.question  # exact question stored
        assert marker in rr.response


# 9. Clarifications saved within the round, not counted as new rounds.
def test_clarifications_saved_in_round():
    e = new_engine(); s = make(e)
    e.clarify(s, round_number=1, question="What are the ambient conditions?")
    assert s.current_round == 1  # clarify did not advance
    for r in range(1, TOTAL_ROUNDS + 1):
        e.respond(s, round_number=r, response=STRONG, timed_out=False, elapsed_active_seconds=20)
    rep = s.final_report
    r1 = rep.round_reports[0]
    assert len(r1.clarifications) == 1
    assert "ambient" in r1.clarifications[0]["question"].lower()
    assert len(rep.round_reports) == TOTAL_ROUNDS  # still 5 rounds


# 7 + 10. Persistence survives a backend restart; sessions reopenable.
def test_persistence_survives_restart():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.db")
        store = HistoryStore(path)
        e = new_engine(store=store)
        s = make(e)
        play(e, s)
        sid = s.session_id
        # Simulate restart: new store from same file, no in-memory session.
        store2 = HistoryStore(path)
        sessions = store2.list_sessions()
        assert len(sessions) == 1
        detail = store2.get_session(sid)
        assert detail is not None
        assert len(detail["report"]["round_reports"]) == TOTAL_ROUNDS
        assert detail["overall_score"] == s.final_report.overall_score
        store.close(); store2.close()


# 15. Cross-session trends use only real stored results; need >=2 sessions.
def test_trends_require_two_sessions():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.db")
        store = HistoryStore(path)
        e = new_engine(store=store)
        # One session -> not enough data.
        play(e, make(e))
        tr = compute_trends(store.get_all_reports())
        assert tr["has_enough_data"] is False
        assert tr["completed_sessions"] == 1
        # Second session -> enough.
        play(e, make(e))
        tr2 = compute_trends(store.get_all_reports())
        assert tr2["has_enough_data"] is True
        assert tr2["completed_sessions"] == 2
        assert len(tr2["overall_score_series"]) == 2
        store.close()


# 16. Demo and live modes return compatible schemas (demo has all fields).
def test_demo_report_schema_complete():
    e = new_engine(); rep = play(e, make(e))
    d = rep.model_dump()
    for key in (
        "overall_score", "max_score", "categories", "round_reports",
        "question_performance", "question_type_stats", "weaknesses",
        "practice_recommendations", "schema_version",
    ):
        assert key in d
    assert d["schema_version"] == 2


# 17. Older/legacy reports handled safely by trends (schema_version 1 ignored).
def test_trends_ignores_legacy_reports():
    legacy = [{
        "session_id": "old1", "created_at": "2020-01-01", "overall_score": 80,
        "report": {"schema_version": 1, "categories": []},
    }]
    tr = compute_trends(legacy)
    assert tr["has_enough_data"] is False
    assert tr["completed_sessions"] == 0
