"""API-level smoke tests using FastAPI's TestClient (demo mode)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SETUP = {
    "company": "Acme",
    "job_title": "Cloud Hardware Development Engineer",
    "job_description": "Design and validate server hardware; debug thermal issues.",
    "company_info": "",
    "website_url": "",
}

STRONG = (
    "I would isolate the failing nodes and control variables one at a time, logging data to "
    "validate each hypothesis because the risk is high. I would verify the sensors and "
    "communicate trade-offs to stakeholders before committing to confirm the root cause."
)


def test_health_reports_demo_mode():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["demo_mode"] is True


def test_full_flow_via_api():
    r = client.post("/api/simulations", json=SETUP)
    assert r.status_code == 200
    state = r.json()
    sid = state["session_id"]
    assert state["current_round"] == 1
    assert state["current_turn"]["question"]
    assert state["is_demo"] is True

    for rnd in range(1, 6):
        resp = client.post(
            f"/api/simulations/{sid}/respond",
            json={"round_number": rnd, "response": STRONG, "timed_out": False,
                  "elapsed_active_seconds": 30},
        )
        assert resp.status_code == 200

    final = client.get(f"/api/simulations/{sid}").json()
    assert final["completion_status"] == "completed"
    assert final["report_ready"] is True

    report = client.get(f"/api/simulations/{sid}/report").json()
    assert report["overall_score"] == sum(c["score"] for c in report["categories"])
    assert report["rounds_attempted"] == 5


def test_text_fallback_empty_answer_ok():
    """Text input path works even with an empty (timed-out) answer."""
    sid = client.post("/api/simulations", json=SETUP).json()["session_id"]
    r = client.post(
        f"/api/simulations/{sid}/respond",
        json={"round_number": 1, "response": "", "timed_out": True,
              "elapsed_active_seconds": 90},
    )
    assert r.status_code == 200
    assert r.json()["state"]["current_round"] == 2


def test_duplicate_submission_conflict():
    sid = client.post("/api/simulations", json=SETUP).json()["session_id"]
    client.post(
        f"/api/simulations/{sid}/respond",
        json={"round_number": 1, "response": STRONG, "elapsed_active_seconds": 10},
    )
    dup = client.post(
        f"/api/simulations/{sid}/respond",
        json={"round_number": 1, "response": "again", "elapsed_active_seconds": 10},
    )
    assert dup.status_code == 409


def test_invalid_session_404():
    assert client.get("/api/simulations/does-not-exist").status_code == 404
