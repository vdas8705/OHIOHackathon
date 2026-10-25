""""What if" decision map.

Shows the path the candidate actually took through the scenario, round by
round, next to the branch a different answer would have opened. Built only
from the saved PerformanceReport (actual consequences, verdicts, stronger
approaches, and the scenario's own alternate outcomes), so it never
contradicts the results screen. The LLM only tightens the wording; a
deterministic template is used in demo mode or if the LLM fails.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .llm import LLMService
from .walkthrough import correctness_for

_MAX_SHORT = 28   # words for "your choice" / "what if" approach
_MAX_LONG = 45    # words for outcomes


def _clip(text: str, limit: int) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    words = t.split(" ")
    if len(words) <= limit:
        return t
    return " ".join(words[:limit]).rstrip(",;:") + "…"


def _first_sentence(text: str) -> str:
    m = re.match(r"(.+?[.!?])(\s|$)", (text or "").strip())
    return m.group(1) if m else (text or "").strip()


def _template_round(rr: dict) -> dict[str, Any]:
    level = rr.get("performance_level") or "Developing"
    correctness = correctness_for(level)
    alts = rr.get("alternative_outcomes") or {}
    answer = (rr.get("response") or "").strip()
    your_choice = (
        "You didn't submit an answer."
        if not answer or answer.startswith("(no answer")
        else _clip(answer, _MAX_SHORT)
    )
    what_happened = _clip(rr.get("consequence") or rr.get("why_it_mattered") or "", _MAX_LONG)
    if correctness == "correct":
        what_if = {
            "label": "If you'd rushed it",
            "approach": "Answering quickly, without the structure and checks you used.",
            "outcome": _clip(alts.get("weak") or "The plan would have been harder to trust.", _MAX_LONG),
        }
    else:
        what_if = {
            "label": "With a stronger answer",
            "approach": _clip(rr.get("stronger_approach") or "A clear decision, backed by reasoning and risks.", _MAX_SHORT),
            "outcome": _clip(alts.get("strong") or rr.get("why_it_mattered") or "", _MAX_LONG),
        }
    return {
        "round_number": rr.get("round_number"),
        "question": _clip(_first_sentence(rr.get("question", "")), 24),
        "correctness": correctness,
        "performance_level": level,
        "your_choice": your_choice,
        "what_happened": what_happened,
        "environment_after": rr.get("environment_after"),
        "what_if": what_if,
    }


def build_decision_map(report: dict, llm: Optional[LLMService], use_llm: bool) -> dict:
    rounds_src = report.get("round_reports") or []
    rounds = [_template_round(rr) for rr in rounds_src]
    last_src = rounds_src[-1] if rounds_src else {}
    your_ending = rounds[-1]["what_happened"] if rounds else "The session ended before any answers were submitted."
    best_ending = _clip(
        (last_src.get("alternative_outcomes") or {}).get("strong")
        or "Every decision lands cleanly, and the team trusts your plan.",
        _MAX_LONG,
    )
    generated_by = "template"

    if use_llm and llm is not None and rounds:
        facts = {
            "rounds": [
                {
                    "round_number": r["round_number"],
                    "question": rr.get("question", ""),
                    "candidate_answer": rr.get("response", ""),
                    "verdict": r["correctness"],
                    "what_actually_happened": rr.get("consequence", ""),
                    "stronger_approach": rr.get("stronger_approach", ""),
                    "scenario_outcome_for_strong_answer": (rr.get("alternative_outcomes") or {}).get("strong", ""),
                    "scenario_outcome_for_weak_answer": (rr.get("alternative_outcomes") or {}).get("weak", ""),
                    "what_if_direction": "weaker" if r["correctness"] == "correct" else "stronger",
                }
                for r, rr in zip(rounds, rounds_src)
            ]
        }
        try:
            data = llm.decision_map(facts)
            by_round = {int(x.get("round_number")): x for x in data.get("rounds", []) if x.get("round_number") is not None}
            for r in rounds:
                got = by_round.get(r["round_number"])
                if not got:
                    continue
                for key, limit in (("your_choice", _MAX_SHORT), ("what_happened", _MAX_LONG)):
                    val = str(got.get(key, "")).strip()
                    if 3 <= len(val.split()) <= limit + 10:
                        r[key] = _clip(val, limit)
                for key, limit in (("what_if_approach", _MAX_SHORT), ("what_if_outcome", _MAX_LONG)):
                    val = str(got.get(key, "")).strip()
                    if 3 <= len(val.split()) <= limit + 10:
                        r["what_if"][key.replace("what_if_", "")] = _clip(val, limit)
            for key in ("your_ending", "best_ending"):
                val = str(data.get(key, "")).strip()
                if 3 <= len(val.split()) <= _MAX_LONG + 10:
                    if key == "your_ending":
                        your_ending = _clip(val, _MAX_LONG)
                    else:
                        best_ending = _clip(val, _MAX_LONG)
            generated_by = "llm"
        except Exception:
            pass  # template already in place

    return {
        "version": 1,
        "generated_by": generated_by,
        "rounds": rounds,
        "your_ending": your_ending,
        "best_ending": best_ending,
    }
