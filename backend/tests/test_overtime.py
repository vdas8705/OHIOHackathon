"""Overtime: escalating, per-section deductions instead of skipping a timed-out section."""
from fastapi.testclient import TestClient

from app.main import app
from app.overtime import (
    SECTION_POINTS,
    allocate_section_points,
    distribute_deduction,
    scaled_tiers,
    tier_for,
)

client = TestClient(app)


def test_tier_boundaries():
    assert tier_for(0) == (0, 0)
    assert tier_for(1) == (1, 5)
    assert tier_for(30) == (1, 5)
    assert tier_for(31) == (2, 15)
    assert tier_for(60) == (2, 15)
    assert tier_for(61) == (3, 30)
    assert tier_for(91) == (4, 50)
    assert tier_for(120) == (4, 50)
    assert tier_for(121) == (5, 60)
    assert tier_for(3600) == (5, 60)


def test_tiers_scale_with_section_limit():
    tiers = scaled_tiers(180)  # twice the reference limit -> twice as long per tier
    assert [t["ends_at_seconds"] for t in tiers] == [60, 120, 180, 240, None]
    assert tier_for(61, 180) == (2, 15)


def test_allocation_sums_and_caps():
    pts = allocate_section_points(37, [55, 25, 55, 25, 25])
    assert sum(pts) == 37 and all(0 <= p <= SECTION_POINTS for p in pts)
    pts = allocate_section_points(95, [85, 85, 85, 85, 25])
    assert sum(pts) == 95 and max(pts) <= SECTION_POINTS
    assert allocate_section_points(10, [0, 0]) == [5, 5]


def test_distribution_never_negative():
    shares = distribute_deduction(10, [30, 25, 20, 15, 10], [2, 2, 2, 2, 2])
    assert sum(shares) == 10 and all(s <= 2 for s in shares)


def _run(overtimes):
    sample = client.get("/api/demo-sample").json()
    state = client.post(
        "/api/simulations",
        json={k: sample[k] for k in ("company", "job_title", "job_description", "company_info")},
    ).json()
    assert state["overtime_tiers"][0]["penalty_pct"] == 5
    sid = state["session_id"]
    for i, ot in enumerate(overtimes, start=1):
        state = client.post(
            f"/api/simulations/{sid}/respond",
            json={
                "round_number": i,
                "response": sample["example_responses"][str(i)],
                "timed_out": False,
                "elapsed_active_seconds": 90,
                "overtime_seconds": ot,
            },
        ).json()["state"]
    assert state["completion_status"] == "completed"
    return sid, client.get(f"/api/simulations/{sid}/report").json()


def test_overtime_only_hits_its_own_section():
    _, base = _run([0, 0, 0, 0, 0])
    sid, over = _run([0, 72, 0, 0, 0])  # 1:12 over -> tier 3, 30%

    assert base["overtime_points_lost"] == 0
    r2 = over["round_reports"][1]
    assert (r2["overtime_tier"], r2["overtime_penalty_pct"]) == (3, 30)
    assert r2["overtime_deduction"] == min(r2["section_points_before_overtime"], 6)
    assert r2["section_points"] == r2["section_points_before_overtime"] - r2["overtime_deduction"]
    # Other sections are untouched.
    for i in (0, 2, 3, 4):
        rr = over["round_reports"][i]
        assert rr["overtime_deduction"] == 0
        assert rr["section_points"] == rr["section_points_before_overtime"]
    # Totals line up everywhere: overall, categories (radar), and sections.
    lost = over["overtime_points_lost"]
    assert lost == r2["overtime_deduction"]
    assert over["overall_score"] == over["overall_score_before_overtime"] - lost
    assert sum(c["score"] for c in over["categories"]) == over["overall_score"]
    assert sum(c["overtime_deduction"] for c in over["categories"]) == lost
    assert all(c["score"] >= 0 for c in over["categories"])

    # The walkthrough mentions it, and Past Sessions keeps the numbers.
    wt = client.post(f"/api/walkthrough/{sid}").json()
    if lost:
        assert "over time" in wt["questions"][1]["spoken"]
    assert "over time" not in wt["questions"][0]["spoken"]
    saved = client.get(f"/api/history/{sid}").json()["report"]
    assert saved["round_reports"][1]["overtime_seconds"] == 72
    assert saved["overtime_points_lost"] == lost


def test_section_never_below_zero():
    _, rep = _run([3600] * 5)
    for rr in rep["round_reports"]:
        assert rr["overtime_penalty_pct"] == 60
        assert rr["section_points"] >= 0
    assert rep["overall_score"] >= 0
