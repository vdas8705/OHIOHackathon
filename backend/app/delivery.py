"""Session-level summary of voice delivery (pace, fillers, hedging, pauses).

Coaching only: this never changes any score. Metrics are measured in the
browser from speech recognition and attached to each answer.
"""
from __future__ import annotations

from typing import Optional

from .models import DeliveryMetrics

PACE_SLOW = 110  # words per minute
PACE_FAST = 170


def pace_label(wpm: Optional[int]) -> str:
    if wpm is None:
        return "not enough speech to measure"
    if wpm < PACE_SLOW:
        return "a little slow"
    if wpm > PACE_FAST:
        return "a little fast"
    return "conversational"


def _merge(dicts: list[dict[str, int]]) -> list[dict]:
    totals: dict[str, int] = {}
    for d in dicts:
        for k, v in d.items():
            totals[k] = totals.get(k, 0) + v
    return [{"phrase": k, "count": v} for k, v in sorted(totals.items(), key=lambda kv: -kv[1])][:3]


def summarize(per_round: list[Optional[DeliveryMetrics]]) -> Optional[dict]:
    spoken = [m for m in per_round if m is not None and m.voice_words > 0]
    if not spoken:
        return None
    words = sum(m.voice_words for m in spoken)
    seconds = sum(m.speaking_seconds for m in spoken)
    wpm = round(words / (seconds / 60)) if seconds >= 5 and words >= 10 else None
    fillers = sum(m.filler_count for m in spoken)
    hedges = sum(m.hedge_count for m in spoken)
    pauses = sum(m.long_pauses for m in spoken)

    per100 = lambda n: (n / words) * 100 if words else 0.0
    tips: list[str] = []
    if per100(fillers) > 3:
        tips.append("Swap filler words for a short, silent pause. It sounds more confident.")
    if per100(hedges) > 2:
        tips.append("Commit to your recommendation: try \"I recommend\" instead of \"I think maybe\".")
    if wpm is not None and wpm > PACE_FAST:
        tips.append("Slow down slightly so key decisions land. Aim for about 130 to 160 words a minute.")
    elif wpm is not None and wpm < PACE_SLOW:
        tips.append("Pick up the pace a little. Outline your answer first so the words come easier.")
    if pauses >= 3:
        tips.append("Pausing to think is fine. Say \"let me think about that for a second\" so it feels intentional.")
    if not tips:
        tips.append("Your delivery was clear and steady. Keep it up.")

    return {
        "answers_with_voice": len(spoken),
        "total_words": words,
        "average_wpm": wpm,
        "pace_label": pace_label(wpm),
        "filler_count": fillers,
        "top_fillers": _merge([m.fillers for m in spoken]),
        "hedge_count": hedges,
        "top_hedges": _merge([m.hedges for m in spoken]),
        "long_pauses": pauses,
        "tips": tips[:3],
    }
