"""Voice delivery coaching and the "what if" decision map (both additive)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

VOICE = {
    "voice_words": 120, "speaking_seconds": 40.0, "wpm": 180,
    "filler_count": 6, "fillers": {"basically": 4, "you know": 2},
    "hedge_count": 4, "hedges": {"i think": 3, "maybe": 1}, "long_pauses": 1,
}


def _run(deliveries):
    sample = client.get("/api/demo-sample").json()
    sid = client.post(
        "/api/simulations",
        json={k: sample[k] for k in ("company", "job_title", "job_description", "company_info")},
    ).json()["session_id"]
    for i, d in enumerate(deliveries, start=1):
        payload = {"round_number": i, "response": sample["example_responses"][str(i)],
                   "timed_out": False, "elapsed_active_seconds": 60}
        if d is not None:
            payload["delivery"] = d
        client.post(f"/api/simulations/{sid}/respond", json=payload)
    return sid, client.get(f"/api/simulations/{sid}/report").json()


def test_delivery_is_coaching_only_and_summarized():
    _, typed = _run([None] * 5)
    _, voiced = _run([VOICE, None, VOICE, None, None])
    assert typed["delivery_summary"] is None
    # Same answers -> same score: delivery never affects scoring.
    assert voiced["overall_score"] == typed["overall_score"]
    s = voiced["delivery_summary"]
    assert s["answers_with_voice"] == 2 and s["total_words"] == 240
    assert s["average_wpm"] == 180 and s["pace_label"] == "a little fast"
    assert s["top_fillers"][0] == {"phrase": "basically", "count": 8}
    assert 1 <= len(s["tips"]) <= 3
    assert voiced["round_reports"][0]["delivery"]["filler_count"] == 6
    assert voiced["round_reports"][1]["delivery"] is None


def test_decision_map_matches_report_and_is_saved():
    sid, rep = _run([VOICE, None, None, None, None])
    m = client.post(f"/api/decision-map/{sid}").json()
    assert len(m["rounds"]) == len(rep["round_reports"])
    level_map = {"Strong": "correct", "Developing": "partly_correct",
                 "Needs Improvement": "incorrect", "Not attempted": "incorrect"}
    for r, rr in zip(m["rounds"], rep["round_reports"]):
        assert r["correctness"] == level_map[rr["performance_level"]]
        assert r["what_happened"] and r["what_if"]["outcome"] and r["what_if"]["approach"]
        assert r["environment_after"] == rr["environment_after"]
        expected = "If you'd rushed it" if r["correctness"] == "correct" else "With a stronger answer"
        assert r["what_if"]["label"] == expected
    assert m["your_ending"] and m["best_ending"]
    # Cached, and saved with the session for Past Sessions.
    assert client.post(f"/api/decision-map/{sid}").json() == m
    assert client.get(f"/api/history/{sid}").status_code == 200


def test_walkthrough_mentions_delivery_tip_for_voice():
    sid, _ = _run([VOICE, VOICE, None, None, None])
    wt = client.post(f"/api/walkthrough/{sid}").json()
    assert "On delivery:" in wt["wrap_up"] and wt["wrap_up"].endswith("Here are your full results.")
