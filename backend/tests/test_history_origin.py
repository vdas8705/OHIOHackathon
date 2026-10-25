"""Tests for session origin metadata, fixture exclusion, and clear-history.

Covers the Problem 1/4/5/6 fixes: synthetic fixtures are never silently
counted as real user performance, user demo sessions ARE legitimate, missing
scores stay missing, and clearing history is safe and confirmed.
"""
import os
import tempfile

from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import Engine
from app.storage import (
    HistoryStore,
    ORIGIN_TEST_FIXTURE,
    ORIGIN_UNKNOWN,
    ORIGIN_USER_DEMO,
)
from app.trends import compute_trends


STRONG = (
    "I would isolate the failing nodes and control variables one at a time, logging data to "
    "validate each hypothesis because the risk is high. I would verify sensors against ground "
    "truth and communicate trade-offs to stakeholders before committing to confirm the cause."
)


def demo_settings() -> Settings:
    s = Settings()
    s.llm_provider = "demo"
    s.openai_api_key = ""
    return s


def engine_with_store(path):
    return Engine(demo_settings(), store=HistoryStore(path))


def play(engine, is_fixture=False, response=STRONG):
    s = engine.create_session(
        company="Amazon", job_title="HW Eng",
        job_description="validate hardware", company_info="", is_fixture=is_fixture,
    )
    for r in range(1, 6):
        engine.respond(s, round_number=r, response=response, timed_out=False,
                       elapsed_active_seconds=30)
    return s


# 1. Empty storage creates no synthetic sessions.
def test_empty_storage_has_no_sessions():
    with tempfile.TemporaryDirectory() as d:
        store = HistoryStore(os.path.join(d, "h.db"))
        assert store.list_sessions() == []
        assert store.list_sessions(include_fixtures=True) == []
        store.close()


# 2. A user-created demo session is saved and labeled user_demo.
def test_user_demo_session_saved_as_user_demo():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        s = play(e, is_fixture=False)
        rows = e.store.list_sessions()
        assert len(rows) == 1
        assert rows[0]["origin"] == ORIGIN_USER_DEMO
        assert rows[0]["session_id"] == s.session_id


# 3. A fixture is never in the default (user-facing) list.
def test_fixture_excluded_by_default():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        play(e, is_fixture=True)   # synthetic
        play(e, is_fixture=False)  # real demo
        default = e.store.list_sessions()
        assert len(default) == 1
        assert default[0]["origin"] == ORIGIN_USER_DEMO
        # But it IS retrievable when explicitly requested.
        allrows = e.store.list_sessions(include_fixtures=True)
        assert len(allrows) == 2


# 10. Analytics exclude fixtures by default.
def test_trends_exclude_fixtures():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        play(e, is_fixture=True)
        play(e, is_fixture=True)
        # Two fixtures only -> analytics see zero real sessions.
        tr = compute_trends(e.store.get_all_reports())
        assert tr["completed_sessions"] == 0
        assert tr["has_enough_data"] is False
        # With fixtures included they count.
        tr2 = compute_trends(e.store.get_all_reports(include_fixtures=True))
        assert tr2["completed_sessions"] == 2


# 11. Missing scores stay missing (None), not zero.
def test_missing_score_is_none_not_zero():
    with tempfile.TemporaryDirectory() as d:
        store = HistoryStore(os.path.join(d, "h.db"))
        store.save_session(
            session_id="legacy1", company="X", job_title="Y", job_description="z",
            scenario_title="t", is_demo=True, completion_status="completed",
            rounds_completed=5, active_seconds=100, overall_score=None,
            schema_version=1, report={"schema_version": 1}, conversation=[],
            origin=ORIGIN_USER_DEMO,
        )
        row = store.list_sessions()[0]
        assert row["overall_score"] is None  # not coerced to 0
        store.close()


# 8. Empty responses never produce a perfect score (demo).
def test_empty_responses_not_perfect():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        s = play(e, response="")
        assert s.final_report.overall_score < 100
        assert s.final_report.overall_score >= 0


# 12. History survives a restart.
def test_history_survives_restart():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "h.db")
        e = engine_with_store(path)
        sid = play(e).session_id
        store2 = HistoryStore(path)
        assert any(r["session_id"] == sid for r in store2.list_sessions())
        store2.close()


# 13. Clear history deletes only intended records, by origin filter.
def test_clear_sessions_filters():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        play(e, is_fixture=True)
        play(e, is_fixture=False)
        # Clear only non-fixtures.
        removed = e.store.clear_sessions(include_fixtures=False)
        assert removed == 1
        remaining = e.store.list_sessions(include_fixtures=True)
        assert len(remaining) == 1
        assert remaining[0]["origin"] == ORIGIN_TEST_FIXTURE
        # Clear everything.
        removed2 = e.store.clear_sessions(include_fixtures=True)
        assert removed2 == 1
        assert e.store.list_sessions(include_fixtures=True) == []


def test_delete_single_session():
    with tempfile.TemporaryDirectory() as d:
        e = engine_with_store(os.path.join(d, "h.db"))
        sid = play(e).session_id
        assert e.store.delete_session(sid) is True
        assert e.store.delete_session(sid) is False  # already gone
        assert e.store.list_sessions() == []


# 14 (schema): migration labels pre-existing rows 'unknown', never deletes them.
def test_migration_labels_legacy_unknown():
    with tempfile.TemporaryDirectory() as d:
        import sqlite3

        path = os.path.join(d, "h.db")
        # Create a pre-migration table WITHOUT an origin column, insert a row.
        con = sqlite3.connect(path)
        con.execute(
            """CREATE TABLE sessions (
                session_id TEXT PRIMARY KEY, company TEXT NOT NULL, job_title TEXT NOT NULL,
                job_description TEXT NOT NULL, scenario_title TEXT NOT NULL, is_demo INTEGER NOT NULL,
                completion_status TEXT NOT NULL, rounds_completed INTEGER NOT NULL,
                active_seconds INTEGER NOT NULL, overall_score INTEGER, schema_version INTEGER NOT NULL DEFAULT 2,
                created_at TEXT NOT NULL, report_json TEXT NOT NULL, conversation_json TEXT NOT NULL)"""
        )
        con.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("old1", "X", "Y", "z", "t", 1, "completed", 5, 100, 88, 2,
             "2020-01-01T00:00:00+00:00", "{}", "[]"),
        )
        con.commit(); con.close()
        # Opening with HistoryStore runs the migration.
        store = HistoryStore(path)
        rows = store.list_sessions(include_fixtures=True)
        assert len(rows) == 1  # preserved, not deleted
        assert rows[0]["origin"] == ORIGIN_UNKNOWN
        assert rows[0]["overall_score"] == 88  # data unchanged
        store.close()


# API-level: clear requires confirmation; destructive gated (demo = enabled).
def test_api_clear_requires_confirmation():
    os.environ["LLM_PROVIDER"] = "demo"
    os.environ["OPENAI_API_KEY"] = ""
    tmp = os.path.join(tempfile.gettempdir(), "branchpoint_clear_test.db")
    if os.path.exists(tmp):
        os.remove(tmp)
    os.environ["BRANCHPOINT_DB"] = tmp
    # Import inside the test so env is applied before module import.
    import importlib
    import app.main as main
    importlib.reload(main)
    client = TestClient(main.app)

    # No confirm -> 400.
    r = client.request("POST", "/api/history/clear", json={"confirm": False})
    assert r.status_code == 400
    # With confirm -> 200 (and deletes zero on empty store).
    r2 = client.request("POST", "/api/history/clear", json={"confirm": True})
    assert r2.status_code == 200
    assert "deleted" in r2.json()


# Fixture sessions are never returned by the default /api/history endpoint.
def test_api_history_excludes_fixtures():
    os.environ["LLM_PROVIDER"] = "demo"
    os.environ["OPENAI_API_KEY"] = ""
    tmp = os.path.join(tempfile.gettempdir(), "branchpoint_fixture_api.db")
    if os.path.exists(tmp):
        os.remove(tmp)
    os.environ["BRANCHPOINT_DB"] = tmp
    import importlib
    import app.main as main
    importlib.reload(main)
    client = TestClient(main.app)

    setup = {
        "company": "Amazon", "job_title": "HW Eng",
        "job_description": "validate hardware", "company_info": "", "website_url": "",
    }
    # Create a FIXTURE session via header.
    sid = client.post(
        "/api/simulations", json=setup, headers={"X-BranchPoint-Fixture": "true"}
    ).json()["session_id"]
    for rnd in range(1, 6):
        client.post(
            f"/api/simulations/{sid}/respond",
            json={"round_number": rnd, "response": STRONG, "elapsed_active_seconds": 20},
        )
    # Default history list must NOT include the fixture.
    default = client.get("/api/history").json()["sessions"]
    assert all(s["session_id"] != sid for s in default)
    # include_fixtures=true reveals it.
    allrows = client.get("/api/history?include_fixtures=true").json()["sessions"]
    assert any(s["session_id"] == sid for s in allrows)
    if os.path.exists(tmp):
        os.remove(tmp)
