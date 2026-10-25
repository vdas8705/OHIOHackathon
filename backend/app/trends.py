"""Cross-session trend analysis built only from stored performance data.

Guardrails (per spec):
- Require at least 3 scored questions of a type across at least 2 completed
  sessions before calling it a recurring weakness.
- Aggregate by PRIMARY question type only (never double-count secondary labels).
- Never invent trends; "insufficient data" is an explicit, allowed result.
"""
from __future__ import annotations

from typing import Any


COMPETENCIES = [
    "Technical reasoning",
    "Decision-making and risk assessment",
    "Adaptability",
    "Communication and explanation",
    "Clarifying questions and information gathering",
]


def compute_trends(session_reports: list[dict]) -> dict[str, Any]:
    """session_reports: list of {created_at, overall_score, report:{...}} newest-last."""
    # Only consider v2+ reports with a weighted 100-point score.
    scored = [
        s
        for s in session_reports
        if s.get("report")
        and s["report"].get("schema_version", 1) >= 2
        and s.get("overall_score") is not None
    ]
    completed_sessions = len(scored)

    if completed_sessions < 2:
        return {
            "has_enough_data": False,
            "completed_sessions": completed_sessions,
            "message": (
                "Complete at least two interviews to unlock cross-session trends. "
                f"You have {completed_sessions} so far."
            ),
            "overall_score_series": [
                {"created_at": s["created_at"], "score": s["overall_score"]}
                for s in scored
            ],
            "competency_series": {},
            "recurring_weaknesses": [],
            "improvements": [],
        }

    # Overall score series (chronological).
    overall_series = [
        {"created_at": s["created_at"], "score": s["overall_score"]} for s in scored
    ]

    # Competency series: normalized percentage per session.
    competency_series: dict[str, list[dict]] = {c: [] for c in COMPETENCIES}
    for s in scored:
        for cat in s["report"].get("categories", []):
            name = cat.get("name")
            if name in competency_series and cat.get("max_score"):
                pct = round(100 * cat["score"] / cat["max_score"])
                competency_series[name].append(
                    {"created_at": s["created_at"], "value": pct}
                )

    # Aggregate per PRIMARY question type across sessions.
    type_totals: dict[str, dict] = {}
    for s in scored:
        for qp in s["report"].get("question_performance", []):
            qtype = qp.get("question_type", "")
            if not qtype:
                continue
            bucket = type_totals.setdefault(
                qtype, {"indicators": [], "sessions": set()}
            )
            bucket["indicators"].append(int(qp.get("indicator", 0)))
            bucket["sessions"].add(s["session_id"])

    recurring: list[dict] = []
    for qtype, bucket in type_totals.items():
        n_questions = len(bucket["indicators"])
        n_sessions = len(bucket["sessions"])
        avg = round(sum(bucket["indicators"]) / n_questions) if n_questions else 0
        # Recurring weakness requires >=3 scored questions across >=2 sessions.
        if n_questions >= 3 and n_sessions >= 2 and avg < 60:
            recurring.append(
                {
                    "question_type": qtype,
                    "average_indicator": avg,
                    "questions_counted": n_questions,
                    "sessions_counted": n_sessions,
                    "detail": (
                        f"You have averaged {avg}/100 on {qtype.lower()} across "
                        f"{n_questions} questions in {n_sessions} sessions."
                    ),
                }
            )
    recurring.sort(key=lambda r: r["average_indicator"])

    # Detect competency improvement/decline across first vs. last (needs >=2 points).
    improvements: list[dict] = []
    for name, series in competency_series.items():
        if len(series) >= 2:
            first, last = series[0]["value"], series[-1]["value"]
            delta = last - first
            if abs(delta) >= 10:
                improvements.append(
                    {
                        "competency": name,
                        "direction": "improving" if delta > 0 else "declining",
                        "delta": delta,
                        "detail": (
                            f"Your {name.lower()} has gone from {first}% to {last}% "
                            f"over your last {len(series)} sessions."
                        ),
                    }
                )

    return {
        "has_enough_data": True,
        "completed_sessions": completed_sessions,
        "message": "",
        "overall_score_series": overall_series,
        "competency_series": competency_series,
        "recurring_weaknesses": recurring,
        "improvements": improvements,
    }
