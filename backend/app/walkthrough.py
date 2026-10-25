"""Spoken results walkthrough.

Built ONLY from the saved PerformanceReport, so everything the assistant says
matches the results screen and radar chart. The LLM writes the conversational
wording; verdicts, scores, and feedback points always come from the report.
A deterministic template is used in demo mode or if the LLM fails.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .llm import LLMService
from .models import Walkthrough, WalkthroughQuestion

# The report's qualitative level decides the verdict; nothing else does.
_LEVEL_TO_CORRECTNESS = {
    "Strong": "correct",
    "Developing": "partly_correct",
    "Needs Improvement": "incorrect",
    "Not attempted": "incorrect",
}
_VERDICT_WORDS = {
    "correct": "correct",
    "partly_correct": "partly correct",
    "incorrect": "not quite right",
}

_MIN_WORDS = 25
_MAX_WORDS = 160


def correctness_for(level: str) -> str:
    return _LEVEL_TO_CORRECTNESS.get(level, "partly_correct")


def _words(text: str, limit: int) -> str:
    parts = text.split()
    if len(parts) <= limit:
        return text.strip()
    return " ".join(parts[:limit]).rstrip(",;:") + "…"


def _sentence(text: str) -> str:
    """Make a fragment safe to drop into speech: trimmed, no markdown, ends with a period."""
    t = re.sub(r"[*_#`>|]+", "", text or "").strip()
    t = re.sub(r"\s+", " ", t)
    if t and t[-1] not in ".!?…":
        t += "."
    return t


def _lower_first(text: str) -> str:
    # Keep "I", "I'd", "I'm"... and acronyms as written.
    first = text.split(" ", 1)[0] if text else ""
    if not text or re.match(r"^I(\b|')", first) or (len(first) > 1 and first.isupper()):
        return text
    return text[:1].lower() + text[1:]


def round_facts(rr: dict) -> dict[str, Any]:
    level = rr.get("performance_level") or "Developing"
    correctness = correctness_for(level)
    return {
        "round_number": rr.get("round_number"),
        "question": rr.get("question", ""),
        "candidate_answer": rr.get("response", ""),
        "clarifications_the_candidate_asked": rr.get("clarifications") or [],
        "verdict_word": _VERDICT_WORDS[correctness],
        "results_screen_label": level,
        "what_went_well": rr.get("what_went_well", ""),
        "what_was_missed": rr.get("what_was_missed", ""),
        "stronger_approach": rr.get("stronger_approach", ""),
        "why_it_mattered": rr.get("why_it_mattered", ""),
    }


def _focus_points(report: dict) -> list[str]:
    points = [p.get("recommendation", "") for p in report.get("practice_recommendations") or []]
    points += list(report.get("improvements") or [])
    seen: list[str] = []
    for p in points:
        p = (p or "").strip()
        if p and p not in seen:
            seen.append(p)
    return seen[:3]


# ------------------------------ template ---------------------------------- #
def _template_intro(report: dict, counts: dict[str, int]) -> str:
    score = report.get("overall_score", 0)
    mx = report.get("max_score", 100)
    if not report.get("round_reports"):
        return (
            f"You scored {score} out of {mx}. This session ended before any answers were "
            "submitted, so there's nothing to go through question by question yet."
        )
    if score >= 75:
        cheer = "That's a strong result, and your reasoning really came through."
    elif score >= 50:
        cheer = "That's a solid foundation, and there's a clear path to an even stronger score."
    else:
        cheer = "Finishing every question takes focus, and now we know exactly what to build on."
    tally = (
        f"You had {counts['correct']} correct, {counts['partly_correct']} partly correct, "
        f"and {counts['incorrect']} that weren't quite there yet."
    )
    return f"You scored {score} out of {mx}. {cheer} {tally} Let's go through them one at a time."


def _template_question(rr: dict, index: int) -> str:
    f = round_facts(rr)
    reminder = _words(_sentence(f["question"]), 22)
    answer = (f["candidate_answer"] or "").strip()
    if not answer or answer.startswith("(no answer"):
        answered = "You didn't get an answer in on this one."
    else:
        answered = f"You said {_lower_first(_words(_sentence(answer), 28))}"
    clar = f["clarifications_the_candidate_asked"]
    clarified = ""
    if clar:
        q = _words(_sentence(str(clar[0].get("question", ""))), 14)
        clarified = f" Along the way you asked, {_lower_first(q)}"
    verdict = {
        "correct": "That was correct.",
        "partly correct": "That was partly correct.",
        "not quite right": "That one was not quite right.",
    }[f["verdict_word"]]
    parts = [f"Question {index}. This one asked: {reminder}", answered + clarified, verdict]
    if f["what_went_well"]:
        parts.append(f"What you did well: {_lower_first(_sentence(f['what_went_well']))}")
    if f["what_was_missed"]:
        parts.append(f"What was missing: {_lower_first(_sentence(f['what_was_missed']))}")
    if f["stronger_approach"]:
        parts.append(f"A stronger approach: {_lower_first(_sentence(f['stronger_approach']))}")
    if f["why_it_mattered"]:
        parts.append(f"That matters because {_lower_first(_sentence(f['why_it_mattered']))}")
    return " ".join(p for p in parts if p)


def _template_wrap_up(focus: list[str]) -> str:
    if focus:
        ordinals = ["First", "Next", "And finally"]
        tips = " ".join(
            f"{ordinals[i] if len(focus) > 1 else 'The big one'}, {_lower_first(_sentence(p))}"
            for i, p in enumerate(focus)
        )
        body = f"Here's what to work on next. {tips}"
    else:
        body = "Keep practicing with the same structure you used today."
    return f"{body} You're building real interview skill with every session. Here are your full results."


# ------------------------------ builder ----------------------------------- #
def build_walkthrough(report: dict, llm: Optional[LLMService], use_llm: bool) -> Walkthrough:
    rounds = report.get("round_reports") or []
    counts = {"correct": 0, "partly_correct": 0, "incorrect": 0}
    for rr in rounds:
        counts[correctness_for(rr.get("performance_level") or "")] += 1

    focus = _focus_points(report)
    template_questions = {
        rr.get("round_number"): _template_question(rr, i + 1) for i, rr in enumerate(rounds)
    }

    intro = _template_intro(report, counts)
    wrap_up = _template_wrap_up(focus)
    spoken = dict(template_questions)
    generated_by = "template"

    if use_llm and llm is not None and rounds:
        facts = {
            "overall_score": report.get("overall_score"),
            "max_score": report.get("max_score", 100),
            "verdict_counts": counts,
            "summary_on_results_screen": report.get("summary", ""),
            "focus_points_to_use": focus,
            "rounds": [round_facts(rr) for rr in rounds],
        }
        try:
            data = llm.walkthrough_script(facts)
            got = {
                int(q.get("round_number")): str(q.get("spoken", "")).strip()
                for q in data.get("questions", [])
                if q.get("round_number") is not None
            }
            for rn in spoken:
                text = got.get(rn, "")
                # Keep the LLM's wording only when it's a sensible length.
                if _MIN_WORDS <= len(text.split()) <= _MAX_WORDS:
                    spoken[rn] = text
            if str(data.get("intro", "")).strip():
                intro = str(data["intro"]).strip()
            llm_wrap = str(data.get("wrap_up", "")).strip()
            if llm_wrap:
                if "here are your full results" not in llm_wrap.lower():
                    llm_wrap = f"{llm_wrap} Here are your full results."
                wrap_up = llm_wrap
            generated_by = "llm"
        except Exception:
            pass  # template already in place

    questions = [
        WalkthroughQuestion(
            round_number=rr.get("round_number"),
            correctness=correctness_for(rr.get("performance_level") or ""),
            performance_level=rr.get("performance_level") or "Developing",
            question=rr.get("question", ""),
            spoken=spoken[rr.get("round_number")],
        )
        for rr in rounds
    ]
    return Walkthrough(
        generated_by=generated_by,
        overall_score=report.get("overall_score", 0),
        max_score=report.get("max_score", 100),
        intro=intro,
        questions=questions,
        wrap_up=wrap_up,
        focus_points=focus,
    )


def answer_followup(
    report: dict, round_number: int, question: str, llm: Optional[LLMService], use_llm: bool
) -> str:
    rr = next(
        (r for r in report.get("round_reports") or [] if r.get("round_number") == round_number),
        None,
    )
    if rr is None:
        return "I don't have results for that question, but feel free to ask about another one."
    facts = round_facts(rr)
    if use_llm and llm is not None:
        try:
            answer = llm.walkthrough_followup(facts, question)
            if answer:
                return answer
        except Exception:
            pass
    better = _sentence(facts["stronger_approach"]) or "Lead with your decision, then explain why."
    why = _sentence(facts["why_it_mattered"])
    return f"Good question. The key idea here is this: {better} {why}".strip()
