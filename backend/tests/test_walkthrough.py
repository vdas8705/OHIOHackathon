"""Spoken results walkthrough: derived from the report, saved with the session."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _complete_session(answers):
    sample = client.get("/api/demo-sample").json()
    state = client.post(
        "/api/simulations",
        json={k: sample[k] for k in ("company", "job_title", "job_description", "company_info")},
    ).json()
    sid = state["session_id"]
    for i, text in enumerate(answers, start=1):
        state = client.post(
            f"/api/simulations/{sid}/respond",
            json={"round_number": i, "response": text, "timed_out": False, "elapsed_active_seconds": 30},
        ).json()["state"]
    assert state["completion_status"] == "completed"
    return sid


def test_walkthrough_matches_report_and_is_saved():
    sample = client.get("/api/demo-sample").json()
    sid = _complete_session(sample["example_responses"][:5] if isinstance(sample["example_responses"], list) else ["I would check logs, form a hypothesis, validate it, and roll back if risky."] * 5)
    report = client.get(f"/api/simulations/{sid}/report").json()

    wt = client.post(f"/api/walkthrough/{sid}").json()
    assert wt["overall_score"] == report["overall_score"]
    assert str(report["overall_score"]) in wt["intro"]
    assert len(wt["questions"]) == len(report["round_reports"])
    level_map = {"Strong": "correct", "Developing": "partly_correct",
                 "Needs Improvement": "incorrect", "Not attempted": "incorrect"}
    for q, rr in zip(wt["questions"], report["round_reports"]):
        assert q["performance_level"] == rr["performance_level"]
        assert q["correctness"] == level_map[rr["performance_level"]]
        assert q["spoken"] and "*" not in q["spoken"] and "#" not in q["spoken"]
    assert wt["wrap_up"].endswith("Here are your full results.")
    assert wt["viewed"] is False

    # Same script on repeat calls; then viewed + follow-up are persisted.
    assert client.post(f"/api/walkthrough/{sid}").json()["intro"] == wt["intro"]
    assert client.post(f"/api/walkthrough/{sid}/viewed").json()["viewed"] is True
    ans = client.post(f"/api/walkthrough/{sid}/ask", json={"round_number": 2, "question": "What should I have said?"}).json()
    assert ans["answer"]

    saved = client.get(f"/api/history/{sid}").json()
    assert saved["walkthrough"]["viewed"] is True
    assert saved["walkthrough"]["followups"][0]["round_number"] == 2


def test_walkthrough_unknown_session_404():
    assert client.post("/api/walkthrough/doesnotexist").status_code == 404
